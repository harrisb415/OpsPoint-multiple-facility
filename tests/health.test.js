// The health check (roadmap phase 2): every check says what it found in plain
// words, /healthz says pass or fail and nothing more, Admin gets the detail,
// and only an unreachable database is critical. Runs against a throwaway
// database on either driver (scripts/pg-audit.sh runs it on Postgres); the
// update source uses a stub, never the network.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_health_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');
const conn = require('../server/db/connection');
const settings = require('../server/settings');
const health = require('../server/health');
const instances = require('../server/health/instances');
const jobs = require('../server/lib/jobs');
const webpush = require('../server/lib/webpush');
const { nowLocal } = require('../server/lib/time');

const PW = 'Health!Passw0rd9';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_healthdirs_'));
const photos = path.join(scratch, 'photos');
fs.mkdirSync(photos);
fs.writeFileSync(path.join(scratch, 'secret.key'), 'x'.repeat(64));
const CONFIG = { BASE: path.join(__dirname, '..'), DATA_DIR: scratch, PHOTOS_DIR: photos, DB_PATH: TMP_DB, SECRET_FILE: path.join(scratch, 'secret.key') };
const STUB_UPDATES = { probe: async () => ({ current: '2.7.0', latest: '2.7.0', signed: true }) };
const onPg = conn.isPg;
const sqliteOnly = onPg ? test.skip : test;

function doctor(over = {}) {
  return health.createDoctor({ conn, settings, config: CONFIG, updater: STUB_UPDATES, ...over });
}
async function check(id, over) {
  const r = await doctor(over).run({ only: [id] });
  return r.results[0];
}
// A made-up server's heartbeat row.
async function heartbeat({ id = crypto.randomUUID(), seenAgoMs = 0, jobsSnapshot = {}, host = 'test-host', pid = 1 } = {}) {
  const seen = new Date(Date.now() - seenAgoMs).toISOString();
  await conn.run('INSERT INTO app_instances (instance_id, app, hostname, pid, version, started_at, last_seen, jobs) VALUES (?,?,?,?,?,?,?,?)',
    [id, 'facility', host, pid, '2.7.0', seen, seen, JSON.stringify(jobsSnapshot)]);
  return id;
}

let admin;
beforeAll(async () => {
  await ready;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,0)`,
    ['hc_admin', 'Health Admin', 'admin', hash, salt, JSON.stringify(db.PERMISSIONS)]);
  await db.run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,0)`,
    ['hc_plain', 'Plain', 'pa', hash, salt, JSON.stringify(['admin.users'])]);
  admin = request.agent(app);
  expect((await admin.post('/api/login').send({ username: 'hc_admin', password: PW })).status).toBe(200);
});

beforeEach(async () => { await conn.run('DELETE FROM app_instances'); });

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('each check says what it found', () => {
  test('a working install: time zone, database, migrations, storage and secrets pass', async () => {
    const r = await doctor().run({ only: ['timezone', 'database', 'migrations', 'storage', 'secrets'] });
    for (const x of r.results) expect(x).toMatchObject({ status: 'pass', critical: false });
    expect(r.results.find(x => x.id === 'database').says).toMatch(onPg
      ? /^Postgres \(.+\) answers in \d+ ms; every table and column this version uses exists\.$/
      : /^SQLite \(.+\) answers in \d+ ms/);
    if (onPg) expect(r.results.find(x => x.id === 'timezone').says).toMatch(/the database session agrees\.$/);
    expect(r.results.find(x => x.id === 'storage').says).toContain(photos);
    expect(fs.readdirSync(photos)).toEqual([]);            // the test file is gone again
    expect(r.ok).toBe(true);
  });

  test('every result has words, and a fix whenever it fails', async () => {
    const r = await doctor().run();
    expect(r.results.map(x => x.id)).toEqual(['timezone', 'database', 'migrations', 'storage', 'secrets', 'dbkey', 'backups', 'jobs', 'disk', 'certificate', 'push', 'updates', 'instances']);
    for (const x of r.results) {
      expect(['pass', 'warn', 'fail', 'skip']).toContain(x.status);
      expect(x.says).toMatch(/\.$/);
      if (x.status === 'fail') expect(x.fix).toBeTruthy();
    }
  });

  test('file storage that is missing or unwritable fails', async () => {
    expect((await check('storage', { config: { ...CONFIG, PHOTOS_DIR: path.join(scratch, 'nope') } })).says).toMatch(/doesn't exist\.$/);
    const notADir = path.join(scratch, 'a-file');
    fs.writeFileSync(notADir, 'x');
    const r = await check('storage', { config: { ...CONFIG, PHOTOS_DIR: notADir } });
    expect(r.status).toBe('fail');
  });

  test('no session key at all fails', async () => {
    const r = await check('secrets', { config: { ...CONFIG, SECRET_FILE: path.join(scratch, 'missing.key') } });
    expect(r).toMatchObject({ status: 'fail' });
    expect(r.says).toMatch(/^There is no session key/);
  });
});

describe('only an unreachable database is critical', () => {
  const dead = { isPg: false, query: () => Promise.reject(new Error('disk I/O error')), query1: () => Promise.reject(new Error('disk I/O error')), run: () => Promise.reject(new Error('disk I/O error')) };

  test('the database check fails critically and says why', async () => {
    const r = await doctor({ conn: dead }).run({ only: ['database'] });
    expect(r.results[0]).toMatchObject({ status: 'fail', critical: true, says: "Can't reach the database: disk I/O error." });
    expect(r.ok).toBe(false);
  });

  test('/healthz-style output: pass or fail per check, no words, 503 only on critical', async () => {
    const down = await doctor({ conn: dead }).healthz();
    expect(down.ok).toBe(false);
    expect(down.checks.database).toBe('fail');
    const up = await doctor().healthz();
    expect(up.ok).toBe(true);                               // backups and the key may fail; still serving
    for (const v of Object.values(up.checks)) expect(['pass', 'fail']).toContain(v);
    expect(Object.keys(up)).toEqual(['ok', 'checks']);
  });
});

describe('encryption key', () => {
  test('is not part of a Postgres install', async () => {
    if (onPg) expect(await check('dbkey')).toMatchObject({ status: 'skip' });
  });

  sqliteOnly('unconfirmed fails with the confirm action; a confirmation of this key passes; a new key needs a new one', async () => {
    await db.setSetting('dbkey_backup_confirmed', '');
    let r = await check('dbkey');
    expect(r).toMatchObject({ status: 'fail', action: 'dbkey-confirm' });
    expect(r.says).toMatch(/^Nobody has confirmed the key is stored somewhere else/);
    const key = fs.readFileSync(require('../server/db/dbcrypt').keyPathFor(TMP_DB), 'utf8').trim();
    const fp = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    await db.setSetting('dbkey_backup_confirmed', { fp, at: '2026-09-29 10:00:00', by: 'Pat' });
    expect(await check('dbkey')).toMatchObject({ status: 'pass', says: 'Stored somewhere else: confirmed by Pat on 2026-09-29 10:00:00.' });
    await db.setSetting('dbkey_backup_confirmed', { fp: '0000000000000000', at: '2026-01-01 09:00:00', by: 'Pat' });
    expect((await check('dbkey')).says).toMatch(/^The key changed after it was confirmed on 2026-01-01 09:00:00/);
  });
});

describe('backups', () => {
  const at = (hoursAgo) => {
    const d = new Date(Date.now() - hoursAgo * 3600000), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const record = (action, hoursAgo, detail = '') => db.run(
    `INSERT INTO audit_log (ts,actor_id,actor_name,ip,action,target_type,target_id,target_label,detail) VALUES (?,?,?,?,?,?,?,?,?)`,
    [at(hoursAgo), null, 'system', '127.0.0.1', action, 'database', '', '', detail]);
  beforeEach(async () => { await db.run("DELETE FROM audit_log WHERE action IN ('backup.create','backup.failed')"); });

  test('none recorded fails', async () => {
    expect(await check('backups')).toMatchObject({ status: 'fail', says: 'No backup has been recorded yet.' });
  });

  test('recent passes (on SQLite a warning while it sits on the database\'s drive); old or failed since fails', async () => {
    await record('backup.create', 3);
    await db.setSetting('backup_same_volume_ack', false);
    expect((await check('backups')).status).toBe(onPg ? 'pass' : 'warn');  // SQLite: the scratch folder shares the drive
    await db.setSetting('backup_same_volume_ack', true);
    expect(await check('backups')).toMatchObject({ status: 'pass', says: 'Last backup 3 hours ago.' });
    await record('backup.failed', 2, JSON.stringify({ error: 'disk full' }));   // recorded after the success
    expect(await check('backups')).toMatchObject({ status: 'fail', says: 'The last backup failed 2 hours ago: disk full.' });
    await db.run("DELETE FROM audit_log WHERE action IN ('backup.create','backup.failed')");
    await record('backup.create', 30);
    expect((await check('backups')).says).toMatch(/^The last backup was 30 hours ago/);
  });

  test('a Postgres-style ISO time is read too', () => {
    expect(health._auditMs('2026-09-29T09:30:00.000Z')).toBe(Date.parse('2026-09-29T09:30:00.000Z'));
    expect(health._auditMs('2026-09-29 09:30:00')).toBe(new Date(2026, 8, 29, 9, 30, 0).getTime());
  });
});

describe('background jobs and instances, from the heartbeat table', () => {
  const minute = 60000;
  test('no server reporting in fails both', async () => {
    expect((await check('jobs')).says).toBe('No running OpsPoint server has reported in for over two minutes.');
    expect((await check('instances')).status).toBe('fail');
  });

  test('on-time jobs pass; a stalled one is named; a new one gets its grace period', async () => {
    const now = Date.now();
    await heartbeat({ jobsSnapshot: {
      'hq-sync': { label: 'HQ sync', everyMs: 20000, registeredAt: now - 10 * minute, lastRun: now - 5000 },
      'push-scheduler': { label: 'Push alert scheduler', everyMs: 60000, registeredAt: now - 30000, lastRun: null },
    } });
    expect(await check('jobs')).toMatchObject({ status: 'pass', says: 'All 2 ran on time: hq sync, push alert scheduler.' });
    await conn.run('DELETE FROM app_instances');
    await heartbeat({ jobsSnapshot: { 'hq-sync': { label: 'HQ sync', everyMs: 20000, registeredAt: now - 60 * minute, lastRun: now - 10 * minute } } });
    expect((await check('jobs')).says).toBe('Stalled: HQ sync (last ran 10 minutes ago; runs every 20 seconds).');
  });

  test('one server passes; two warn on-premises and fail on a managed platform', async () => {
    await heartbeat({ host: 'a', pid: 11 });
    expect((await check('instances')).says).toBe('One server running (a, process 11, v2.7.0).');
    await heartbeat({ host: 'b', pid: 12 });
    expect((await check('instances')).status).toBe('warn');
    const managed = settings.createSettings({ env: { OPSPOINT_PROFILE: 'aws' }, readFile: () => { const e = new Error(); e.code = 'ENOENT'; throw e; } });
    const r = await check('instances', { settings: { ...settings, profile: () => managed.profile() } });
    expect(r.status).toBe('fail');
    expect(r.says).toMatch(/^2 servers are running/);
  });

  test('a row nobody updated for three minutes no longer counts', async () => {
    await heartbeat({ seenAgoMs: 3 * minute });
    expect((await check('instances')).status).toBe('fail');
  });

  test('the heartbeat writes, lists and cleans up after a dead process on this machine', async () => {
    jobs.register('lock-sweep', 3600000, 'Clinical record lock');
    await instances.write(conn, { version: '9.9.9' });
    let list = await instances.list(conn);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: instances.INSTANCE_ID, self: true, live: true, version: '9.9.9', pid: process.pid });
    expect(list[0].jobs['lock-sweep']).toMatchObject({ label: 'Clinical record lock', everyMs: 3600000 });
    await instances.write(conn, { version: '9.9.10' });                     // an update, not a second row
    expect(await instances.list(conn)).toHaveLength(1);
    await heartbeat({ host: os.hostname(), pid: 2147483000 });             // a process that doesn't exist
    await heartbeat({ host: 'other-machine', pid: 2147483000 });          // can't tell from here: kept
    await instances.cleanup(conn);
    list = await instances.list(conn);
    expect(list.map(i => i.hostname).sort()).toEqual([os.hostname(), 'other-machine'].sort());
    expect(list.find(i => i.hostname === os.hostname()).self).toBe(true);
  });
});

describe('certificate, push keys, update source', () => {
  test('no certificate is skipped; one expiring within 14 days fails; a year passes', async () => {
    expect((await check('certificate')).status).toBe('skip');
    const selfsigned = require('selfsigned');
    const make = async (days) => {
      const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, notAfterDate: new Date(Date.now() + days * 86400000) });
      fs.writeFileSync(path.join(scratch, 'cert.pem'), pems.cert);
    };
    await make(5);
    expect((await check('certificate')).says).toMatch(/^The certificate expires in [45] days/);
    await make(365);
    expect((await check('certificate')).says).toMatch(/^Valid for 36[45] more days/);
    fs.unlinkSync(path.join(scratch, 'cert.pem'));
  });

  test('push keys: missing is a warning, a mismatched pair fails, a good pair passes', async () => {
    // As if no VAPID_* were set (web-hestia's environment has a pair): keys come from the data folder.
    const noEnvKeys = { ...settings, get: (n) => (n.startsWith('VAPID_') ? null : settings.get(n)) };
    const check = async (id) => (await doctor({ settings: noEnvKeys }).run({ only: [id] })).results[0];
    expect((await check('push')).status).toBe('warn');                    // no vapid.json in the scratch folder
    const a = webpush.generateKeys(), b = webpush.generateKeys();
    fs.writeFileSync(path.join(scratch, 'vapid.json'), JSON.stringify({ publicKey: a.publicKey, privateKey: b.privateKey }));
    expect((await check('push')).status).toBe('fail');
    fs.writeFileSync(path.join(scratch, 'vapid.json'), JSON.stringify(a));
    expect(await check('push')).toMatchObject({ status: 'pass', says: 'Keys valid (from the data folder); 0 phones subscribed.' });
  });

  test('update source: reachable and signed passes; unsigned or unreachable fails', async () => {
    expect(await check('updates')).toMatchObject({ status: 'pass', says: 'Release list reachable and signed; the newest is v2.7.0, which this is.' });
    expect((await check('updates', { updater: { probe: async () => ({ current: '2.7.0', latest: '2.8.0', signed: false }) } })).status).toBe('fail');
    const r = await check('updates', { updater: { probe: async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); } } });
    expect(r.says).toBe("Can't check for updates: getaddrinfo ENOTFOUND github.com.");
  });
});

describe('over HTTP', () => {
  test('GET /healthz needs no sign-in and says pass or fail per check only', async () => {
    const r = await request(app).get('/healthz');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.ok).toBe(true);
    expect(Object.keys(r.body)).toEqual(['ok', 'checks']);
    for (const v of Object.values(r.body.checks)) expect(['pass', 'fail']).toContain(v);
  });

  test('the detail is for admin.system only', async () => {
    expect((await request(app).get('/api/system/health')).status).toBe(401);
    const plain = request.agent(app);
    expect((await plain.post('/api/login').send({ username: 'hc_plain', password: PW })).status).toBe(200);
    expect((await plain.get('/api/system/health')).status).toBe(403);
    expect((await plain.post('/api/system/health/run').send({})).status).toBe(403);
    const r = await admin.get('/api/system/health');
    expect(r.status).toBe(200);
    expect(r.body.results.find(x => x.id === 'database')).toMatchObject({ status: 'pass', label: 'Database' });
  });

  test('confirming the key is refused on Postgres, which has none', async () => {
    if (!onPg) return;
    const r = await admin.post('/api/system/health/dbkey-confirmed').send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('There is no database key on Postgres.');
  });

  sqliteOnly('confirming the key is audited and turns the check green', async () => {
    await db.setSetting('dbkey_backup_confirmed', '');
    const r = await admin.post('/api/system/health/dbkey-confirmed').send({});
    expect(r.status).toBe(200);
    expect(r.body.results.find(x => x.id === 'dbkey')).toMatchObject({ status: 'pass' });
    const row = await db.query1("SELECT actor_name, detail FROM audit_log WHERE action='dbkey.backup_confirmed' ORDER BY id DESC LIMIT 1");
    expect(row.actor_name).toBe('Health Admin');
    expect(row.detail).not.toMatch(/[0-9a-f]{16}/);                       // no key material, not even a fingerprint
  });
});

describe('the updater asks the health check first', () => {
  test('a failing preflight stops the update before anything is fetched', async () => {
    const { createUpdater } = require('../updater');
    let fetched = false;
    const up = createUpdater({
      baseDir: path.join(__dirname, '..'), dataDir: scratch, dbPath: TMP_DB,
      db: { getSetting: async () => { fetched = true; return ''; }, auditLog: async () => {} },
      broadcast: () => {}, restart: () => {},
      preflight: async () => ({ ok: false, reason: 'Not updating: Disk space: 3% free.' }),
    });
    await expect(up.apply('test')).rejects.toThrow('Not updating: Disk space: 3% free.');
    expect(up.status().progress).toMatchObject({ phase: 'error', error: 'Not updating: Disk space: 3% free.' });
    expect(fetched).toBe(false);
  });
});

describe('the command line', () => {
  test('`doctor` on a data folder with no database says so, exits 1, and creates nothing', () => {
    const { spawnSync } = require('child_process');
    const empty = path.join(scratch, 'empty');
    const env = { ...process.env, OPSPOINT_CONFIG: 'none', OPSPOINT_DATA: empty, OPSPOINT_DB: path.join(empty, 'opspoint.db') };
    delete env.DATABASE_URL; env.OPSPOINT_DB_DRIVER = 'sqlite';
    const r = spawnSync(process.execPath, ['server/cli/opspoint.js', 'doctor', '--json'], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8', timeout: 120000 });
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.results.find(x => x.id === 'database').says).toMatch(/there is no database at .* yet/);
    expect(fs.existsSync(empty)).toBe(false);
  });
});

test('nowLocal is what SQLite audit rows carry (sanity for the backups check)', () => {
  expect(nowLocal()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});
