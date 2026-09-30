// Postgres migrations applied by OpsPoint itself (roadmap phase 4,
// server/db/runner.js): a fresh database gets every file, an upgrade the ones
// it lacks, a hand-migrated one is adopted when its schema matches the code,
// a failing file rolls back whole, and two instances starting together apply
// each file once. The file handling runs everywhere; the database parts run
// on Postgres (scripts/pg-audit.sh), each in a throwaway schema of the
// scratch database.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const runner = require('../server/db/runner');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_migrations_'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('the files', () => {
  test('facility and HQ each get their own, in order, named pg/NNN_name', () => {
    const facility = runner.filesFor('facility').map((f) => f.version);
    const central = runner.filesFor('central').map((f) => f.version);
    expect(facility[0]).toBe('pg/001_facility_schema');
    expect(central).toEqual(['pg/002_central_schema', 'pg/006_central_facility_update_columns']);
    expect(facility.some((v) => /central/.test(v))).toBe(false);
    expect([...facility].sort()).toEqual(facility);
    expect(facility).toContain('pg/013_app_instances');
  });

  test('a file\'s own BEGIN;/COMMIT; go (the runner wraps each in its transaction); plpgsql BEGIN stays', () => {
    const dir = path.join(tmp, 'strip');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '001_x.sql'), 'BEGIN;\nCREATE TABLE a (id int);\nDO $$\nBEGIN\n  PERFORM 1;\nEND $$;\ncommit ;\n');
    const [f] = runner.filesFor('facility', dir);
    expect(f.sql).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(f.sql).not.toMatch(/^\s*commit\s*;/im);
    expect(f.sql).toMatch(/^BEGIN$/m);                          // the DO block's
  });

  test('the checksum is the same on a Windows (CRLF) and a Linux (LF) checkout', () => {
    const a = path.join(tmp, 'lf'), b = path.join(tmp, 'crlf');
    fs.mkdirSync(a); fs.mkdirSync(b);
    const text = '-- note\nCREATE TABLE t (id int);\n';
    fs.writeFileSync(path.join(a, '005_t.sql'), text);
    fs.writeFileSync(path.join(b, '005_t.sql'), text.replace(/\n/g, '\r\n'));
    expect(runner.filesFor('facility', a)[0].checksum).toBe(runner.filesFor('facility', b)[0].checksum);
  });

  test('only NNN_name.sql files count', () => {
    const dir = path.join(tmp, 'names');
    fs.mkdirSync(dir);
    for (const n of ['001_ok.sql', '02_short.sql', 'notes.md', '003_ok.sql.bak', '004_also_ok.sql']) fs.writeFileSync(path.join(dir, n), 'SELECT 1;');
    expect(runner.filesFor('facility', dir).map((f) => f.name)).toEqual(['001_ok.sql', '004_also_ok.sql']);
  });
});

// ── On Postgres ─────────────────────────────────────────────────────────────
const onPg = (process.env.OPSPOINT_DB_DRIVER || '').toLowerCase() === 'pg' && !!process.env.DATABASE_URL;
const pgTest = onPg ? test : test.skip;
const pools = [];
const schemas = [];

// A pool whose sessions work in their own new schema of the scratch database.
async function scratchPool() {
  const { Pool } = require('pg');
  const settings = require('../server/settings');
  const mode = settings.get('PGSSLMODE');
  const ssl = mode === 'disable' ? false : { rejectUnauthorized: mode !== 'require' };
  const schema = `mig_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const u = new URL(process.env.DATABASE_URL);
  u.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: u.toString(), ssl, max: 4 });
  pools.push(pool); schemas.push(schema);
  return pool;
}
async function rows(pool, sql) { return (await pool.query(sql)).rows; }

afterAll(async () => {
  for (const p of pools) await p.end().catch(() => {});
  if (onPg && schemas.length) {
    const { Pool } = require('pg');
    const settings = require('../server/settings');
    const ssl = settings.get('PGSSLMODE') === 'disable' ? false : { rejectUnauthorized: settings.get('PGSSLMODE') !== 'require' };
    const admin = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 1 });
    for (const s of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => {});
    await admin.end();
  }
});

// A copy of the facility's files plus some of the test's own.
function dirWith(extra = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'dir_'));
  for (const f of runner.filesFor('facility')) fs.copyFileSync(f.file, path.join(dir, f.name));
  for (const [name, sql] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

pgTest('a fresh database gets every file, recorded; a second run does nothing', async () => {
  const pool = await scratchPool();
  const files = runner.filesFor('facility');
  const r = await runner.migrate({ pool, app: 'facility' });
  expect(r).toMatchObject({ fresh: true, adopted: [] });
  expect(r.applied).toEqual(files.map((f) => f.name));
  const ledger = await rows(pool, "SELECT version, checksum FROM schema_migrations WHERE version LIKE 'pg/%' ORDER BY version");
  expect(ledger.map((x) => x.version)).toEqual(files.map((f) => f.version));
  expect(ledger.every((x) => /^[0-9a-f]{64}$/.test(x.checksum))).toBe(true);
  expect((await rows(pool, "SELECT to_regclass('app_instances') AS t"))[0].t).toBe('app_instances');
  expect(await runner.migrate({ pool, app: 'facility' })).toEqual({ applied: [], adopted: [], fresh: false });
  expect((await runner.status({ pool, app: 'facility' })).pending).toEqual([]);
});

pgTest('an upgrade applies only the new file', async () => {
  const pool = await scratchPool();
  await runner.migrate({ pool, app: 'facility' });
  const dir = dirWith({ '900_extra_table.sql': 'BEGIN;\nCREATE TABLE IF NOT EXISTS mig_extra (id integer PRIMARY KEY);\nCOMMIT;\n' });
  const st = await runner.status({ pool, app: 'facility', dir });
  expect(st.pending.map((f) => f.name)).toEqual(['900_extra_table.sql']);
  const r = await runner.migrate({ pool, app: 'facility', dir });
  expect(r.applied).toEqual(['900_extra_table.sql']);
  expect((await rows(pool, "SELECT to_regclass('mig_extra') AS t"))[0].t).toBe('mig_extra');
});

pgTest('a failing file rolls back whole, says which file, and is tried again next time', async () => {
  const pool = await scratchPool();
  await runner.migrate({ pool, app: 'facility' });
  const dir = dirWith({ '901_half_good.sql': 'CREATE TABLE mig_half (id int);\nSELECT no_such_function();\n' });
  await expect(runner.migrate({ pool, app: 'facility', dir })).rejects.toThrow(/^Migration 901_half_good\.sql failed and was rolled back: function no_such_function\(\) does not exist\.$/);
  expect((await rows(pool, "SELECT to_regclass('mig_half') AS t"))[0].t).toBeNull();
  expect((await runner.status({ pool, app: 'facility', dir })).pending.map((f) => f.name)).toEqual(['901_half_good.sql']);
  const e = await runner.migrate({ pool, app: 'facility', dir }).catch((x) => x);
  expect(e).toBeInstanceOf(runner.MigrationError);
  expect(e.code).toBe('EX_CONFIG');
});

pgTest('a file changed after it was applied is reported, never run again', async () => {
  const pool = await scratchPool();
  await runner.migrate({ pool, app: 'facility' });
  const dir = dirWith();
  fs.appendFileSync(path.join(dir, '013_app_instances.sql'), '\n-- edited later\n');
  const st = await runner.status({ pool, app: 'facility', dir });
  expect(st.pending).toEqual([]);
  expect(st.changed.map((f) => f.name)).toEqual(['013_app_instances.sql']);
  expect((await runner.migrate({ pool, app: 'facility', dir })).applied).toEqual([]);
});

pgTest('a hand-migrated database is adopted when its schema matches the code, refused when it does not', async () => {
  const pool = await scratchPool();
  await runner.migrate({ pool, app: 'facility' });
  await pool.query("DELETE FROM schema_migrations WHERE version LIKE 'pg/%'");   // as web-hestia was: migrated by psql
  expect((await runner.status({ pool, app: 'facility' })).unrecorded).toBe(true);
  await expect(runner.migrate({ pool, app: 'facility', parity: async () => ({ errors: ['facility: clients.photo missing in Postgres'] }) }))
    .rejects.toThrow(/^The database has tables but no record of which migrations made them, and it doesn't match the code \(facility: clients\.photo missing in Postgres\)/);
  const r = await runner.migrate({ pool, app: 'facility', parity: runner.parityFor('facility', pool) });
  expect(r.applied).toEqual([]);
  expect(r.adopted).toEqual(runner.filesFor('facility').map((f) => f.name));
  expect((await runner.status({ pool, app: 'facility' })).pending).toEqual([]);
});

pgTest('two instances starting at once apply each file once', async () => {
  const pool = await scratchPool();
  const [a, b] = await Promise.all([runner.migrate({ pool, app: 'facility' }), runner.migrate({ pool, app: 'facility' })]);
  expect(a.applied.length + b.applied.length).toBe(runner.filesFor('facility').length);
  const n = (await rows(pool, "SELECT count(*)::int AS n FROM schema_migrations WHERE version LIKE 'pg/%'"))[0].n;
  expect(n).toBe(runner.filesFor('facility').length);
});

pgTest('OPSPOINT_MIGRATE=off refuses to start with a missing file, naming it; start applies it', async () => {
  const pool = await scratchPool();
  const off = { get: (n) => (n === 'OPSPOINT_MIGRATE' ? 'off' : null) };
  const on = { get: (n) => (n === 'OPSPOINT_MIGRATE' ? 'start' : null) };
  await expect(runner.startup({ app: 'facility', settings: off, pool, log: () => {} }))   // a fresh database: the deploy step comes first
    .rejects.toThrow(/^The database is missing \d+ migration\(s\) \(001_facility_schema\.sql, 003_fix_sync_outbox\.sql, /);
  const logged = [];
  await runner.startup({ app: 'facility', settings: on, pool, log: (m) => logged.push(m) });
  expect(logged[0]).toMatch(/^applied 001_facility_schema\.sql \(\d+ ms\)$/);
  await pool.query("DELETE FROM schema_migrations WHERE version = 'pg/013_app_instances'");
  await expect(runner.startup({ app: 'facility', settings: off, pool, log: () => {} }))
    .rejects.toThrow('The database is missing 1 migration(s) (013_app_instances.sql): run `node server/cli/opspoint.js migrate` first, or set OPSPOINT_MIGRATE=start.');
  await runner.startup({ app: 'facility', settings: on, pool, log: () => {} });     // re-runs 013: it is idempotent
  expect((await runner.status({ pool, app: 'facility' })).pending).toEqual([]);
});
