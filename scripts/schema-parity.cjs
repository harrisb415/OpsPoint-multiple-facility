#!/usr/bin/env node
'use strict';
/**
 * schema-parity.cjs — does the Postgres schema have everything SQLite has?
 *
 * The SQLite schema is built by code (CREATE TABLE in server/db/migrate.js plus
 * additive ALTERs in COLUMN_MIGRATIONS, db.js and central/db.js _migrate()); the
 * Postgres one by hand-written files in migrations/pg/. Nothing kept them in
 * step: central's facilities.upd_* columns lived only on the SQLite side, and
 * the HQ facility list failed on Postgres for weeks before anyone opened it.
 *
 * This boots both apps on throwaway SQLite databases, reads the resulting
 * columns, and compares them with a live Postgres schema. Exit 1 on a table or
 * column that is missing from Postgres; nullability/default differences are
 * printed as warnings (a NOT NULL column with no default that SQLite left
 * nullable is where '' and missing fields turn into 500s).
 *
 *   DATABASE_URL=… CENTRAL_DATABASE_URL=… node scripts/schema-parity.cjs
 *
 * Point it at a scratch database with migrations/pg applied to check the
 * migration FILES (scripts/pg-audit.sh does), or at production to check what
 * is actually deployed.
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');

// Child mode: boot one app on SQLite, print its schema as JSON, exit.
if (process.argv[2] === '--dump') {
  const which = process.argv[3];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opsparity-'));
  process.env.OPSPOINT_DATA = tmp;
  process.env.OPSPOINT_DB = path.join(tmp, 'f.db');
  process.env.CENTRAL_DATA = tmp;
  (async () => {
    let q;
    if (which === 'facility') {
      const { db, ready } = require(path.join(REPO, 'server.js'));
      await ready; q = (s) => db.query(s);
    } else {
      const cdb = require(path.join(REPO, 'central', 'db.js'));
      await cdb.init(path.join(tmp, 'central.db'));
      const conn = require(path.join(REPO, 'server', 'db', 'connection.js'));
      q = (s) => conn.query(s);
    }
    const out = {};
    for (const { name } of await q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) {
      out[name] = (await q(`PRAGMA table_info(${name})`)).map(c => ({ name: c.name, notnull: !!c.notnull, dflt: c.dflt_value, pk: !!c.pk }));
    }
    process.stdout.write('@@SCHEMA' + JSON.stringify(out));
    process.exit(0);
  })().catch(e => { console.error(e); process.exit(1); });
  return;
}

function sqliteSchema(which) {
  // A clean environment: the child must run SQLite no matter what the parent's
  // driver settings are, so the pg variables (and the driver guard's evidence)
  // are stripped.
  const env = { ...process.env, OPSPOINT_DB_DRIVER: 'sqlite', OPSPOINT_CONFIG: 'none' };
  delete env.DATABASE_URL; delete env.CENTRAL_DATABASE_URL; delete env.OPSPOINT_PROFILE;
  const out = execFileSync(process.execPath, [__filename, '--dump', which], { env, maxBuffer: 32 << 20 }).toString();
  return JSON.parse(out.slice(out.indexOf('@@SCHEMA') + 8));
}

async function pgSchema(url) {
  const { Client } = require('pg');
  // The same TLS rule as the app's driver (server/db/drivers/pg.js).
  const settings = require('../server/settings');
  const mode = settings.get('PGSSLMODE'), ca = settings.get('PGSSLROOTCERT');
  const ssl = mode === 'disable' ? false
    : { rejectUnauthorized: mode !== 'require', ca: ca ? fs.readFileSync(ca, 'utf8') : undefined };
  const c = new Client({ connectionString: url, ssl });
  await c.connect();
  const { rows } = await c.query(`
    SELECT c.table_name, c.column_name, c.is_nullable = 'NO' AS notnull, c.column_default AS dflt, c.is_identity = 'YES' AS identity
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = current_schema()`);
  await c.end();
  const out = {};
  for (const r of rows) (out[r.table_name] ||= []).push({ name: r.column_name, notnull: r.notnull, dflt: r.dflt, identity: r.identity });
  return out;
}

function compare(label, S, P) {
  const errors = [], warnings = [];
  for (const t of Object.keys(S)) {
    if (!P[t]) { errors.push(`${label}: table ${t} missing in Postgres`); continue; }
    const pc = Object.fromEntries(P[t].map(c => [c.name, c]));
    for (const s of S[t]) {
      const p = pc[s.name];
      if (!p) { errors.push(`${label}: ${t}.${s.name} missing in Postgres`); continue; }
      if (p.notnull && !s.notnull && !s.pk && !p.identity && p.dflt == null) warnings.push(`${label}: ${t}.${s.name} is NOT NULL in Postgres with no default (nullable in SQLite)`);
    }
  }
  return { errors, warnings };
}

(async () => {
  // From the environment or the settings file, like the apps themselves.
  const settings = require('../server/settings');
  const targets = [['facility', settings.forApp('facility').get('DATABASE_URL')],
                   ['central', settings.forApp('central').get('CENTRAL_DATABASE_URL')]];
  let failed = false;
  for (const [which, url] of targets) {
    if (!url) { console.log(`${which}: skipped (no ${which === 'facility' ? 'DATABASE_URL' : 'CENTRAL_DATABASE_URL'})`); continue; }
    const { errors, warnings } = compare(which, sqliteSchema(which), await pgSchema(url));
    for (const w of warnings) console.log('  warn ', w);
    for (const e of errors) console.log('  FAIL ', e);
    console.log(`${which}: ${errors.length ? errors.length + ' missing' : 'OK'}${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
    if (errors.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(2); });
