'use strict';
/**
 * Does a Postgres schema have everything the code expects?
 *
 * The code builds the SQLite schema itself (server/db/migrate.js plus additive
 * ALTERs in db.js and central/db.js); Postgres gets its schema from the files
 * in migrations/pg/. Nothing else keeps them in step: central's
 * facilities.upd_* columns lived only on the SQLite side, and the HQ facility
 * list failed on Postgres for weeks before anyone opened it.
 *
 * codeSchema() boots an app on a throwaway SQLite database in a child process
 * (schema-dump.js) and reads its columns; pgSchema() reads a live Postgres
 * schema; compare() lists what is missing. Used by the health check (the
 * facility, through the app's own connection) and by scripts/schema-parity.cjs.
 * It lives under server/ so the in-app updater ships it.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const DUMP = path.join(__dirname, 'schema-dump.js');

// What the code expects: table -> [{ name, notnull, dflt, pk }].
function codeSchema(which) {
  const env = { ...process.env, OPSPOINT_DB_DRIVER: 'sqlite', OPSPOINT_CONFIG: 'none' };
  for (const k of ['DATABASE_URL', 'CENTRAL_DATABASE_URL', 'OPSPOINT_PROFILE', 'OPSPOINT_DATA', 'OPSPOINT_DB', 'CENTRAL_DATA', 'OPSPOINT_BOOTSTRAP']) delete env[k];
  const out = execFileSync(process.execPath, [DUMP, which], { env, maxBuffer: 32 << 20, timeout: 120000, windowsHide: true }).toString();
  const at = out.indexOf('@@SCHEMA');
  if (at < 0) throw new Error('the schema dump printed nothing');
  return JSON.parse(out.slice(at + 8));
}

const PG_COLUMNS_SQL = `
  SELECT c.table_name, c.column_name, c.is_nullable = 'NO' AS notnull, c.column_default AS dflt, c.is_identity = 'YES' AS identity
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema = current_schema()`;

function shapePg(rows) {
  const out = {};
  for (const r of rows) (out[r.table_name] ||= []).push({ name: r.column_name, notnull: !!r.notnull, dflt: r.dflt, identity: !!r.identity });
  return out;
}

// A live schema through something with query(sql) — the app's own connection.
async function pgSchemaVia(conn) {
  return shapePg(await conn.query(PG_COLUMNS_SQL));
}

// A live schema over a new connection, with the same TLS rule as the app's
// driver (server/db/drivers/pg.js).
async function pgSchema(url) {
  const fs = require('fs');
  const { Client } = require('pg');
  const settings = require('../settings');
  const mode = settings.get('PGSSLMODE'), ca = settings.get('PGSSLROOTCERT');
  const ssl = mode === 'disable' ? false
    : { rejectUnauthorized: mode !== 'require', ca: ca ? fs.readFileSync(ca, 'utf8') : undefined };
  const c = new Client({ connectionString: url, ssl });
  await c.connect();
  try { return shapePg((await c.query(PG_COLUMNS_SQL)).rows); }
  finally { await c.end(); }
}

// errors: what Postgres lacks. warnings: NOT NULL in Postgres with no default
// where SQLite allows null — where '' and missing fields turn into 500s.
function compare(label, S, P) {
  const errors = [], warnings = [];
  for (const t of Object.keys(S)) {
    if (!P[t]) { errors.push(`${label}: table ${t} missing in Postgres`); continue; }
    const pc = Object.fromEntries(P[t].map((c) => [c.name, c]));
    for (const s of S[t]) {
      const p = pc[s.name];
      if (!p) { errors.push(`${label}: ${t}.${s.name} missing in Postgres`); continue; }
      if (p.notnull && !s.notnull && !s.pk && !p.identity && p.dflt == null) {
        warnings.push(`${label}: ${t}.${s.name} is NOT NULL in Postgres with no default (nullable in SQLite)`);
      }
    }
  }
  return { errors, warnings };
}

module.exports = { codeSchema, pgSchema, pgSchemaVia, compare };
