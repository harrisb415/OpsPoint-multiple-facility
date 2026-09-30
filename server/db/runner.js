'use strict';
/**
 * Postgres migrations, applied by OpsPoint itself: the files in migrations/pg/
 * (NNN_name.sql) in order, each once, each recorded in schema_migrations as
 * version 'pg/NNN_name' with a checksum. SQLite needs none of this: its schema
 * is built by the code at every start (server/db/migrate.js).
 *
 * When: at start (OPSPOINT_MIGRATE=start, the default), or as a deploy step
 * (`node server/cli/opspoint.js migrate`) with OPSPOINT_MIGRATE=off, in which
 * case the server refuses to start while a file is missing. A Postgres
 * advisory lock keeps two starting instances from migrating at once.
 *
 * Files whose name contains "central" are HQ's (its own database); the rest
 * are the facility's. Each runs in one transaction with its ledger row, so a
 * failure leaves nothing half-applied; a file's own BEGIN;/COMMIT; lines are
 * dropped for that.
 *
 * Three starting points:
 *   an empty schema        every file, in order (a fresh install)
 *   tables, nothing noted  an install migrated by hand before this runner
 *                          existed: when its schema matches the code (schema
 *                          parity), every file is noted as applied without
 *                          running; otherwise it stops and says what is missing
 *   files noted            the ones not yet noted
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', '..', 'migrations', 'pg');
const LOCK_KEY = 71630213;                     // pg_advisory_lock key for "OpsPoint migrations"

class MigrationError extends Error {
  constructor(message) { super(message); this.name = 'MigrationError'; this.code = 'EX_CONFIG'; }
}

// The files for one app, in order: [{ version, name, file, sql, checksum }].
function filesFor(app, dir = DIR) {
  const isCentral = (f) => /central/i.test(f);
  return fs.readdirSync(dir)
    .filter((f) => /^\d{3}_[A-Za-z0-9_]+\.sql$/.test(f) && (app === 'central' ? isCentral(f) : !isCentral(f)))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      return {
        version: 'pg/' + f.replace(/\.sql$/, ''), name: f, file: path.join(dir, f),
        // One transaction per file, ours: its own BEGIN;/COMMIT; lines go.
        sql: text.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, ''),
        checksum: crypto.createHash('sha256').update(text).digest('hex'),
      };
    });
}

async function ledgerExists(client) {
  const r = await client.query("SELECT to_regclass(current_schema() || '.schema_migrations') AS t");
  return !!r.rows[0].t;
}
async function ensureLedger(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
}
async function recorded(client) {
  if (!await ledgerExists(client)) return new Map();
  const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'schema_migrations'");
  const hasSum = cols.rows.some((c) => c.column_name === 'checksum');
  const r = await client.query(`SELECT version, ${hasSum ? 'checksum' : 'NULL AS checksum'} FROM schema_migrations WHERE version LIKE 'pg/%'`);
  return new Map(r.rows.map((x) => [x.version, x.checksum]));
}
async function tableCount(client) {
  const r = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'");
  return r.rows[0].n;
}

/**
 * Where a database stands, without changing it: { files, pending, changed,
 * adoptable, fresh }. `changed` = recorded files whose content has changed.
 */
async function status({ pool, app = 'facility', dir = DIR }) {
  const files = filesFor(app, dir);
  const client = await pool.connect();
  try {
    const done = await recorded(client);
    const fresh = done.size === 0 && await tableCount(client) === 0;
    return {
      files,
      fresh,
      unrecorded: done.size === 0 && !fresh,      // migrated by hand: adopt at the next start
      pending: files.filter((f) => !done.has(f.version)),
      changed: files.filter((f) => done.has(f.version) && done.get(f.version) && done.get(f.version) !== f.checksum),
    };
  } finally { client.release(); }
}

/**
 * Bring the database up to date. `parity()` answers the adoption question for
 * a hand-migrated install: resolves { errors: [...] }. Resolves { applied,
 * adopted, fresh }; throws a MigrationError that names the file and the reason.
 */
async function migrate({ pool, app = 'facility', dir = DIR, parity, log = () => {} }) {
  const files = filesFor(app, dir);
  const client = await pool.connect();
  const applied = [], adopted = [];
  let fresh = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      let done = await recorded(client);
      if (done.size === 0) {
        if (await tableCount(client) === 0) {
          fresh = true;
        } else {
          const p = parity ? await parity() : { errors: ['no way to compare the schema with the code'] };
          if (p.errors && p.errors.length) {
            throw new MigrationError(`The database has tables but no record of which migrations made them, and it doesn't match the code (${p.errors.slice(0, 3).join('; ')}${p.errors.length > 3 ? '; …' : ''}): apply the missing migrations/pg files by hand once, then start OpsPoint again.`);
          }
          await ensureLedger(client);
          for (const f of files) {
            await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [f.version, f.checksum]);
            adopted.push(f.name);
          }
          log(`noted ${adopted.length} migrations already in the database (${files[0] ? files[0].name : ''}…${files.length ? files[files.length - 1].name : ''})`);
          done = await recorded(client);
        }
      }
      for (const f of files) {
        if (done.has(f.version)) continue;
        const t0 = Date.now();
        try {
          await client.query('BEGIN');
          await client.query(f.sql);
          await ensureLedger(client);          // the first file on a fresh install creates it
          await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2) ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum', [f.version, f.checksum]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw new MigrationError(`Migration ${f.name} failed and was rolled back: ${String(e.message).split('\n')[0]}.`);
        }
        applied.push(f.name);
        log(`applied ${f.name} (${Date.now() - t0} ms)`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally { client.release(); }
  return { applied, adopted, fresh };
}

/**
 * What the servers call as they start, once the connection is open. Postgres
 * only. OPSPOINT_MIGRATE=start applies what is missing; off only checks, and
 * a missing file stops the start with a MigrationError (exit code 78).
 */
// The adoption question for a hand-migrated database: does its schema have
// everything the code expects? (server/health/schemaParity.js)
function parityFor(app, pool) {
  return async () => {
    const sp = require('../health/schemaParity');
    const conn = { query: async (sql) => (await pool.query(sql)).rows };
    return sp.compare(app, sp.codeSchema(app), await sp.pgSchemaVia(conn));
  };
}

async function startup({ app = 'facility', settings = require('../settings'), log = (m) => console.log(`  DB: ${m}`), pool: given = null } = {}) {
  const connection = require('./connection');
  if (!given && !connection.isPg) return null;
  const pool = given || connection.getDb();
  const parity = parityFor(app, pool);
  if (settings.get('OPSPOINT_MIGRATE') === 'start') return migrate({ pool, app, parity, log });
  const st = await status({ pool, app });
  if (st.pending.length && !st.unrecorded) {
    throw new MigrationError(`The database is missing ${st.pending.length} migration(s) (${st.pending.map((f) => f.name).join(', ')}): run \`node server/cli/opspoint.js migrate${app === 'central' ? ' --app central' : ''}\` first, or set OPSPOINT_MIGRATE=start.`);
  }
  return { applied: [], adopted: [], fresh: false };
}

module.exports = { migrate, status, startup, parityFor, filesFor, MigrationError, LOCK_KEY, DIR };
