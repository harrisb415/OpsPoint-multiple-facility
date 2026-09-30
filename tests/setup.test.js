// First-run setup (roadmap phase 6): a new install prints a one-time setup
// code instead of passwords; the code creates the first admin in the browser,
// the steps save as they go, the finish needs the compliance tick and runs the
// health check, and /setup is gone for good afterwards. Plus invite links (the
// staff step) and the database key download. On whichever driver the process
// is configured for; everything stays in the throwaway database it creates.
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP_DB = path.join(os.tmpdir(), `opspoint_setup_${Date.now()}.db`);
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_setup_data_'));
process.env.OPSPOINT_DB = TMP_DB;
process.env.OPSPOINT_DATA = TMP_DATA;
process.env.OPSPOINT_UPDATES = 'platform';     // the finish's health check stays off the network

const request = require('supertest');
const { app, db, ready } = require('../server');
const setup = require('../server/modules/setup/service');
const conn = require('../server/db/connection');
const { loginRateClear } = require('../server/middleware/rateLimit');

const PW = 'Setup!Passw0rd9';
const onPg = conn.isPg;
let admin, printed;

beforeAll(async () => {
  await ready;
  printed = await setup.atStart();
});
// The code, invites and sign-ins share the login limit (10 per IP per 15
// minutes), which this file's own requests would use up.
beforeEach(() => { for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) loginRateClear(ip); });
afterAll(() => {
  ['', '-shm', '-wal'].forEach((s) => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const audits = async (action) => db.query(`SELECT * FROM audit_log WHERE action=? ORDER BY id`, [action]);
const users = async () => Number((await db.query1('SELECT COUNT(*) AS n FROM users')).n);

describe('a new install', () => {
  test('has no accounts and a one-time code; the first visit lands on /setup', async () => {
    expect(await users()).toBe(0);
    expect(printed.code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(Date.parse(printed.expiresAt) - Date.now()).toBeGreaterThan(23.9 * 3600 * 1000);
    const st = await request(app).get('/api/setup/status');
    expect(st.body).toEqual({ state: 'code', expired: false, codeHours: 24 });
    for (const p of ['/', '/login']) {
      const r = await request(app).get(p);
      expect(r.status).toBe(302);
      expect(r.headers.location).toBe('/setup');
    }
    expect((await setup.atStart()).existing).toBe(true);      // a restart keeps the printed code
  });

  test('`setup-code` makes a new code; the old one stops working', async () => {
    const env = { ...process.env, OPSPOINT_CONFIG: 'none', OPSPOINT_DB: TMP_DB, OPSPOINT_DATA: TMP_DATA };
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'server', 'cli', 'opspoint.js'), 'setup-code'], { env, encoding: 'utf8', timeout: 60000 });
    expect(r.status).toBe(0);
    const m = /Setup code: ([2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4})/.exec(r.stdout);
    expect(m).toBeTruthy();
    expect(r.stdout).toMatch(/^Open https?:\/\/localhost:\d+\/setup/);
    const old = await request(app).post('/api/setup/account').send({ code: printed.code, username: 'first', password: PW });
    expect(old.status).toBe(403);
    printed = { code: m[1] };
  });

  test('a wrong or expired code is refused and recorded; a weak password spends nothing', async () => {
    let r = await request(app).post('/api/setup/account').send({ code: 'AAAA-AAAA', username: 'first', password: PW });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/^That isn't the setup code/);
    expect((await audits('setup.code_refused')).length).toBeGreaterThanOrEqual(2);
    r = await request(app).post('/api/setup/account').send({ code: printed.code, username: 'first', password: 'short' });
    expect(r.status).toBe(400);
    r = await request(app).post('/api/setup/account').send({ code: printed.code, username: 'x', password: PW });
    expect(r.status).toBe(400);
    expect(await users()).toBe(0);
    // Expired: the same code, a day later.
    const st = await db.getSetting('setup');
    await db.setSetting('setup', { ...st, code_expires: new Date(Date.now() - 1000).toISOString() });
    r = await request(app).post('/api/setup/account').send({ code: printed.code, username: 'first', password: PW });
    expect(r.status).toBe(410);
    expect(r.body.error).toMatch(/setup-code/);
    expect((await request(app).get('/api/setup/status')).body.expired).toBe(true);
    await db.setSetting('setup', st);
  });

  test('the right code (any case, with or without the dash) makes the first admin, signed in', async () => {
    admin = request.agent(app);
    const r = await admin.post('/api/setup/account').send({ code: printed.code.toLowerCase().replace('-', ' '), displayName: 'Robin Admin', username: 'robin', password: PW });
    expect(r.status).toBe(200);
    const me = await admin.get('/api/me');
    expect(me.body).toMatchObject({ username: 'robin', displayName: 'Robin Admin', role: 'admin', mustChangePw: false });
    expect(me.body.permissions).toEqual(expect.arrayContaining(['admin.users', 'admin.settings', 'admin.system']));
    const u = await db.query1('SELECT is_protected, must_change_pw FROM users WHERE username=?', ['robin']);
    expect(u).toMatchObject({ is_protected: 1, must_change_pw: 0 });
    expect((await audits('setup.account')).length).toBe(1);
    // Once: the code is spent.
    const again = await request(app).post('/api/setup/account').send({ code: printed.code, username: 'second', password: PW });
    expect(again.status).toBe(409);
    const st = await db.getSetting('setup');
    expect(st.code_hash).toBeUndefined();
  });
});

describe('the wizard', () => {
  test('anyone learns only the state; the admin gets the steps for this install', async () => {
    expect((await request(app).get('/api/setup/status')).body).toEqual({ state: 'wizard', signIn: true });
    const r = await admin.get('/api/setup/status');
    expect(r.body.state).toBe('wizard');
    expect(r.body.steps.map((s) => s.id)).toEqual(['account', 'facility', 'shifts', 'rooms', 'care', 'features', 'staff', 'security', 'phone', 'hq', 'review']);
    expect(r.body.steps[0]).toMatchObject({ id: 'account', state: 'done' });
    expect(r.body.security).toMatchObject({ database: onPg ? 'pg' : 'sqlite', compliance: 'offsite', https: 'certificate', signIn: 'local', updates: null });
    expect(r.body.timeZone.name).toBeTruthy();
    expect((await request(app).get('/')).status).toBe(302);      // no longer to /setup: to the sign-in
    expect((await request(app).get('/')).headers.location).toBe('/login');
  });

  test('steps are marked done or skipped, and recorded', async () => {
    let r = await admin.put('/api/setup/steps/facility').send({ state: 'done' });
    expect(r.status).toBe(200);
    expect(r.body.status.steps.find((s) => s.id === 'facility').state).toBe('done');
    r = await admin.put('/api/setup/steps/phone').send({ state: 'skipped' });
    expect(r.status).toBe(200);
    expect((await admin.put('/api/setup/steps/account').send({ state: 'done' })).status).toBe(400);
    expect((await admin.put('/api/setup/steps/nope').send({ state: 'done' })).status).toBe(400);
    expect((await admin.put('/api/setup/steps/care').send({ state: 'maybe' })).status).toBe(400);
    const rows = await audits('setup.step');
    expect(rows.map((x) => JSON.parse(x.detail).step)).toEqual(['facility', 'phone']);
  });

  test('rooms and residents in one call; rooms that exist are left alone', async () => {
    let r = await admin.post('/api/setup/rooms').send({ rooms: [{ room: '201' }, { room: '202', name: 'Pat Setup' }, { room: '' }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ added: ['201', '202'], existing: [], problems: ['Row 3: a room number of 1 to 20 characters.'] });
    r = await admin.post('/api/setup/rooms').send({ rooms: [{ room: '201' }, { room: '203' }] });
    expect(r.body).toMatchObject({ added: ['203'], existing: ['201'] });
    const rooms = await db.query("SELECT room, name FROM clients WHERE is_active=1 ORDER BY room");
    expect(rooms.map((x) => [x.room, x.name])).toEqual([['201', 'VACANT'], ['202', 'Pat Setup'], ['203', 'VACANT']]);
  });

  test('the backup folder must be a writable absolute path; automatic update checks switch', async () => {
    expect((await admin.put('/api/setup/backup-dir').send({ dir: 'relative/path' })).status).toBe(400);
    const dir = path.join(TMP_DATA, 'elsewhere');
    const r = await admin.put('/api/setup/backup-dir').send({ dir });
    // The same-drive warning compares with the SQLite file; Postgres has none here.
    expect(r.body).toMatchObject({ ok: true, dir, sameDrive: !onPg });
    expect(await db.getSetting('backup_dir')).toBe(dir);
    expect((await admin.put('/api/setup/updates').send({ auto: false })).body).toEqual({ ok: true, auto: false });
    expect(await db.getSetting('update_auto_check')).toBe(false);
  });

  test('finishing needs the compliance tick, runs the health check, and closes setup for good', async () => {
    let r = await admin.post('/api/setup/finish').send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/backups are copied somewhere outside the building/);
    expect((await admin.post('/api/setup/finish').send({ compliance: 'baa' })).status).toBe(400);
    r = await admin.post('/api/setup/finish').send({ compliance: 'offsite' });
    expect(r.status).toBe(200);
    expect(r.body.health.results.map((x) => x.id)).toContain('database');
    const st = await db.getSetting('setup');
    expect(st.finished_at).toBeTruthy();
    expect(st.steps).toMatchObject({ account: 'done', facility: 'done', phone: 'skipped', shifts: 'skipped', review: 'done' });
    expect(st.compliance).toMatchObject({ kind: 'offsite', by: 'Robin Admin' });
    expect((await audits('setup.finish')).length).toBe(1);
    expect((await request(app).get('/api/setup/status')).body).toEqual({ state: 'done' });
    expect((await admin.put('/api/setup/steps/care').send({ state: 'done' })).status).toBe(409);
    expect((await admin.post('/api/setup/rooms').send({ rooms: [{ room: '9' }] })).status).toBe(409);
    expect((await request(app).post('/api/setup/account').send({ code: printed.code, username: 'late', password: PW })).status).toBe(409);
  });
});

describe('invite links', () => {
  let link, token, userId;
  const tokenOf = (l) => l.split('/invite/')[1];

  test('a new account can be invited instead of given a password', async () => {
    const r = await admin.post('/api/users').send({ username: 'casey', displayName: 'Casey Staff', role: 'pa', invite: true });
    expect(r.status).toBe(200);
    // On the server's own loopback, the link carries its LAN address instead:
    // a phone can't open "127.0.0.1".
    expect(r.body.invite.link).toMatch(/^http:\/\/[^/]+\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(new URL(r.body.invite.link).hostname).not.toBe('127.0.0.1');
    link = r.body.invite.link; token = tokenOf(link); userId = r.body.id;
    const list = (await admin.get('/api/users')).body;
    expect(list.find((u) => u.username === 'casey').invitePendingUntil).toBe(r.body.invite.expiresAt);
    const stored = await db.query1('SELECT token_hash FROM user_invites WHERE user_id=?', [userId]);
    expect(stored.token_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect((await audits('user.invite')).length).toBe(1);
    // Nobody knows the account's password until the link is used.
    expect((await request(app).post('/api/login').send({ username: 'casey', password: PW })).status).toBe(401);
  });

  test('the link says who it is for, sets their own password once, and signs them in', async () => {
    const info = await request(app).get(`/api/invites/${token}`);
    expect(info.body).toMatchObject({ username: 'casey', displayName: 'Casey Staff' });
    const staff = request.agent(app);
    expect((await staff.post(`/api/invites/${token}`).send({ password: 'weak' })).status).toBe(400);
    const r = await staff.post(`/api/invites/${token}`).send({ password: PW });
    expect(r.status).toBe(200);
    expect((await staff.get('/api/me')).body).toMatchObject({ username: 'casey', mustChangePw: false });
    expect((await request(app).post('/api/login').send({ username: 'casey', password: PW })).status).toBe(200);
    expect((await audits('user.invite_accepted')).length).toBe(1);
    expect((await request(app).get(`/api/invites/${token}`)).status).toBe(410);
    expect((await request(app).post(`/api/invites/${token}`).send({ password: PW })).status).toBe(410);
    expect((await admin.get('/api/users')).body.find((u) => u.username === 'casey').invitePendingUntil).toBeNull();
  });

  test('a new link replaces the old one; an expired or made-up one opens nothing', async () => {
    const r1 = await admin.post('/api/users').send({ username: 'drew', displayName: 'Drew', role: 'pa', invite: true });
    const first = tokenOf(r1.body.invite.link);
    const r2 = await admin.post(`/api/users/${r1.body.id}/invite`).send({});
    expect(r2.status).toBe(200);
    const second = tokenOf(r2.body.link);
    expect((await request(app).get(`/api/invites/${first}`)).status).toBe(410);
    expect((await request(app).get(`/api/invites/${second}`)).status).toBe(200);
    await db.run('UPDATE user_invites SET expires_at=? WHERE user_id=?', [new Date(Date.now() - 1000).toISOString(), r1.body.id]);
    expect((await request(app).get(`/api/invites/${second}`)).status).toBe(410);
    expect((await request(app).get('/api/invites/not-a-real-token-at-all-123')).status).toBe(410);
    expect((await request(app).post('/api/users/99999/invite').send({})).status).toBe(401);   // no session
    expect((await admin.post('/api/users/99999/invite').send({})).status).toBe(404);
  });
});

describe('links another device opens', () => {
  const { lanAddress, reachableOrigin } = require('../server/lib/net');
  const ifs = {
    wifi: [{ family: 'IPv4', internal: false, address: '169.254.83.107' }, { family: 'IPv6', internal: false, address: 'fe80::1' }],
    eth: [{ family: 'IPv4', internal: false, address: '192.168.1.40' }],
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  };
  const req = (host, protocol = 'http') => ({ protocol, get: () => host });
  test('keep the address the request used, unless it is loopback: then the LAN address', () => {
    expect(lanAddress(ifs)).toBe('192.168.1.40');                            // never the self-assigned 169.254
    expect(reachableOrigin(req('opspoint.sunrise.org', 'https'), ifs)).toBe('https://opspoint.sunrise.org');
    expect(reachableOrigin(req('10.0.0.5:3000'), ifs)).toBe('http://10.0.0.5:3000');
    expect(reachableOrigin(req('localhost:3100'), ifs)).toBe('http://192.168.1.40:3100');
    expect(reachableOrigin(req('[::1]:3000'), ifs)).toBe('http://192.168.1.40:3000');
    expect(lanAddress({ lo: ifs.lo })).toBe('localhost');
  });
});

describe('after setup', () => {
  test('the checklist lists what is left, and can be dismissed', async () => {
    const r = await admin.get('/api/setup/checklist');
    expect(r.body.show).toBe(true);
    const ids = r.body.items.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['invites', 'phone', 'shifts']));
    expect(ids).not.toContain('backups');                       // a folder was chosen
    expect(r.body.items.find((x) => x.id === 'invites').text).toBe("1 staff hasn't accepted an invite.");
    expect((await admin.post('/api/setup/checklist/dismiss').send({})).status).toBe(200);
    expect((await admin.get('/api/setup/checklist')).body).toEqual({ show: false, items: [] });
  });

  (onPg ? test.skip : test)('the database key downloads for admin.system only, and is recorded', async () => {
    const r = await admin.get('/api/system/dbkey');
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toBe('attachment; filename="opspoint.dbkey"');
    expect(r.text).toBe(fs.readFileSync(require('../server/db/dbcrypt').keyPathFor(TMP_DB), 'utf8').trim());
    expect((await audits('dbkey.download')).length).toBe(1);
    const staff = request.agent(app);
    await staff.post('/api/login').send({ username: 'casey', password: PW });
    expect((await staff.get('/api/system/dbkey')).status).toBe(403);
  });

  test('an install that had accounts before setup existed is closed for good', async () => {
    await db.run("DELETE FROM settings WHERE key='setup'");
    setup._reset();
    expect(await setup.atStart()).toBeNull();
    expect(await db.getSetting('setup')).toMatchObject({ legacy: true });
    expect((await request(app).get('/api/setup/status')).body).toEqual({ state: 'done' });
    expect((await admin.get('/api/setup/checklist')).body.show).toBe(false);
  });
});
