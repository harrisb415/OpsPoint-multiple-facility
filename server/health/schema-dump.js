'use strict';
/**
 * Child process for schemaParity.js: boot one app (facility or central) on a
 * throwaway SQLite database, print its tables and columns as JSON after the
 * marker @@SCHEMA, then delete the database. The code builds the SQLite schema
 * itself, so this is what the code expects any database to have.
 *
 *   node server/health/schema-dump.js facility|central
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const which = process.argv[2];
if (which !== 'facility' && which !== 'central') {
  process.stderr.write('usage: node server/health/schema-dump.js facility|central\n');
  process.exit(2);
}

const REPO = path.resolve(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opsparity-'));
// SQLite in a scratch folder, whatever this process was handed.
Object.assign(process.env, {
  OPSPOINT_DATA: tmp, OPSPOINT_DB: path.join(tmp, 'f.db'), CENTRAL_DATA: tmp,
  OPSPOINT_DB_DRIVER: 'sqlite', OPSPOINT_CONFIG: 'none',
});
for (const k of ['DATABASE_URL', 'CENTRAL_DATABASE_URL', 'OPSPOINT_PROFILE']) delete process.env[k];

(async () => {
  let q;
  const log = console.log;
  console.log = () => {};          // boot banners and the scratch database's first-run passwords
  if (which === 'facility') {
    const { db, ready } = require(path.join(REPO, 'server.js'));
    await ready;
    q = (s) => db.query(s);
  } else {
    const cdb = require(path.join(REPO, 'central', 'db.js'));
    await cdb.init(path.join(tmp, 'central.db'));
    const conn = require(path.join(REPO, 'server', 'db', 'connection.js'));
    q = (s) => conn.query(s);
  }
  console.log = log;
  const out = {};
  for (const { name } of await q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) {
    out[name] = (await q(`PRAGMA table_info(${name})`)).map((c) => ({ name: c.name, notnull: !!c.notnull, dflt: c.dflt_value, pk: !!c.pk }));
  }
  process.stdout.write('@@SCHEMA' + JSON.stringify(out));
  try { require(path.join(REPO, 'server', 'db', 'connection.js')).close(); } catch (e) { /* already closed */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* the OS temp cleaner will */ }
  process.exit(0);
})().catch((e) => {
  process.stderr.write(String((e && e.stack) || e) + '\n');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
  process.exit(1);
});
