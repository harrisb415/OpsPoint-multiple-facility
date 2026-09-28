// Mobile app back end: the data snapshot, wellness rounds kept on the server,
// push subscriptions and who each alert reaches, the timed-alert scheduler,
// and the /m page. Runs on either driver (scripts/pg-audit.sh runs it on
// Postgres); network delivery is swapped for a recorder.
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_rounds_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;
const webpush = require('../server/lib/webpush');
{
  // Keys from the environment, so no vapid.json lands in a real data directory.
  const k = webpush.generateKeys();
  process.env.VAPID_PUBLIC_KEY = k.publicKey;
  process.env.VAPID_PRIVATE_KEY = k.privateKey;
}

const request = require('supertest');
const { app, db, ready } = require('../server');
const config = require('../server/config');
const push = require('../server/modules/push/service');
const scheduler = require('../server/modules/push/scheduler');

const PW = 'Rounds!Passw0rd9';
const TODAY = new Date().toLocaleDateString('en-CA');
const agents = {};
const ids = {};
let sent = [];
let failFor = new Set();

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function fakeSubscription() {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomBytes(8).toString('hex')}`,
    keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) },
  };
}
async function settle() {   // notify() is fire-and-forget from the routes
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 10));
}

async function makeUser(username, displayName, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    [username, displayName, 'pa', hash, salt, JSON.stringify(perms)]);
  const agent = request.agent(app);
  const r = await agent.post('/api/login').send({ username, password: PW });
  expect(r.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  await ready;
  push._setSender(async (sub, message) => {
    sent.push({ endpoint: sub.endpoint, message });
    return failFor.has(sub.endpoint) ? { ok: false, status: 410 } : { ok: true, status: 201 };
  });
  agents.admin = await makeUser('rnd_admin', 'Rounds Admin', db.PERMISSIONS);
  agents.sup = await makeUser('rnd_sup', 'Rounds Sup', db.ROLE_PRESETS.supervisor);
  agents.cm = await makeUser('rnd_cm', 'Rounds CM', db.ROLE_PRESETS.case_manager);

  for (const [room, name] of [['201', 'Alex Rivera'], ['202', 'Jordan Lee'], ['203', 'Sam Patel'], ['204', 'Morgan Diaz'], ['205', 'Casey Nguyen']]) {
    const r = await agents.admin.post('/api/clients').send({ name, room });
    expect(r.status).toBe(200);
    ids[room] = r.body.id || (r.body.client && r.body.client.id);
  }
  const report = { id: 1, report_date: TODAY, shift: 'Night Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
  expect((await agents.admin.post('/api/data').send({ reports: [report], active_report_id: 1 })).status).toBe(200);
  // Morgan is away on a pass for the whole file (back in two days).
  const back = new Date(Date.now() + 2 * 86400000).toISOString();
  expect((await agents.admin.post('/api/passes').send({ client_id: ids['204'], room: '204', name: 'Morgan Diaz', departure: new Date().toISOString(), return_date: back, status: 'Out' })).status).toBe(200);
});

afterAll(() => {
  push._setSender(null);
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('snapshot', () => {
  test('carries the roster, the open report and passes, and no photos', async () => {
    const r = await agents.admin.get('/api/m/snapshot');
    expect(r.status).toBe(200);
    expect(r.body.residents.map(x => x.room)).toEqual(['201', '202', '203', '204', '205']);
    expect(Object.keys(r.body.residents[0]).sort()).toEqual(['id', 'name', 'room']);
    expect(r.body.report).toMatchObject({ id: 1, is_closed: false, shift: 'Night Shift' });
    expect(r.body.passes.map(p => p.client_id)).toEqual([ids['204']]);
    expect(r.body.round).toBeNull();
    expect(JSON.stringify(r.body)).not.toMatch(/data:image/);
  });
});

describe('wellness rounds', () => {
  let roundId;

  test('starting a round; a second phone joins the same one', async () => {
    const a = await agents.admin.post('/api/rounds').send({});
    expect(a.status).toBe(200);
    expect(a.body.joined).toBe(false);
    roundId = a.body.round.id;
    const b = await agents.sup.post('/api/rounds').send({});
    expect(b.body).toMatchObject({ joined: true, round: { id: roundId } });
  });

  test('marks: seen, not located, cleared; bad input refused', async () => {
    const put = (agent, room, body) => agent.put(`/api/rounds/${roundId}/marks/${ids[room] || room}`).send(body);
    expect((await put(agents.admin, '201', { mark: 'ok' })).status).toBe(200);
    expect((await put(agents.admin, '202', { mark: 'missing' })).status).toBe(200);
    expect((await put(agents.admin, '203', { mark: 'ok' })).status).toBe(200);
    expect((await put(agents.admin, '203', { mark: null })).status).toBe(200);
    expect((await put(agents.sup, '205', { mark: 'ok' })).status).toBe(200);
    expect((await put(agents.admin, '201', { mark: 'maybe' })).status).toBe(400);
    expect((await put(agents.admin, '201', {})).status).toBe(400);
    expect((await put(agents.admin, '99999', { mark: 'ok' })).status).toBe(404);

    const cur = await agents.cm.get('/api/rounds/current');
    expect(cur.status).toBe(200);
    const marks = Object.fromEntries(cur.body.round.marks.map(m => [m.client_id, `${m.mark}/${m.by}`]));
    expect(marks).toEqual({ [ids['201']]: 'ok/Rounds Admin', [ids['202']]: 'missing/Rounds Admin', [ids['205']]: 'ok/Rounds Sup' });
  });

  test('an account without log.add can watch the round but not record it', async () => {
    expect((await agents.cm.post('/api/rounds').send({})).status).toBe(403);
    expect((await agents.cm.put(`/api/rounds/${roundId}/marks/${ids['201']}`).send({ mark: 'ok' })).status).toBe(403);
    expect((await agents.cm.post(`/api/rounds/${roundId}/finish`).send({})).status).toBe(403);
  });

  test('finishing writes the shift-log line: away counts, skipped residents are named', async () => {
    const r = await agents.admin.post(`/api/rounds/${roundId}/finish`).send({ notes: 'Quiet night' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 5, missing: 1, unchecked: 1 });
    expect(r.body.logEntry.text).toBe(
      'Wellness check conducted by Rounds Admin and Rounds Sup. 3 of 5 clients accounted for. ' +
      'Not located: Rm. 202 Jordan Lee. Not checked: Rm. 203 Sam Patel. Notes: Quiet night');
    expect(r.body.logEntry.time).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);

    const snap = await agents.admin.get('/api/m/snapshot');
    expect(snap.body.report.log_entries.map(e => e.text)).toContain(r.body.logEntry.text);
    expect(snap.body.round).toBeNull();
    expect(snap.body.last_round).toMatchObject({ id: roundId, status: 'finished', missing: 1 });

    expect((await agents.admin.post(`/api/rounds/${roundId}/finish`).send({})).status).toBe(409);
    expect((await agents.admin.put(`/api/rounds/${roundId}/marks/${ids['201']}`).send({ mark: 'ok' })).status).toBe(409);
  });

  test('a resident not located gets a "found" follow-up in the log, once', async () => {
    const r = await agents.admin.post(`/api/rounds/${roundId}/marks/${ids['202']}/found`).send({ note: 'In the laundry room' });
    expect(r.status).toBe(200);
    expect(r.body.logEntry.text).toMatch(/^Rm\. 202 Jordan Lee located at \d{1,2}:\d{2} (AM|PM), reported by Rounds Admin\. Notes: In the laundry room$/);
    expect((await agents.admin.post(`/api/rounds/${roundId}/marks/${ids['202']}/found`).send({})).status).toBe(409);
    expect((await agents.admin.post(`/api/rounds/${roundId}/marks/${ids['201']}/found`).send({})).status).toBe(404);
  });
});

describe('push alerts', () => {
  const devices = {};

  test('config lists only the alerts each account may get', async () => {
    const admin = await agents.admin.get('/api/push/config');
    expect(admin.body).toMatchObject({ enabled: true, publicKey: process.env.VAPID_PUBLIC_KEY });
    expect(admin.body.types.map(t => t.key).sort()).toEqual(['consequence', 'due', 'missing', 'pass_ext', 'pass_late', 'ua', 'walk']);
    const cm = await agents.cm.get('/api/push/config');
    expect(cm.body.types.map(t => t.key)).toEqual(['pass_ext']);
  });

  test('subscribing accepts real push services only', async () => {
    const bad = fakeSubscription();
    expect((await agents.admin.post('/api/push/subscribe').send({ subscription: { ...bad, endpoint: 'http://127.0.0.1/x' } })).status).toBe(400);
    expect((await agents.admin.post('/api/push/subscribe').send({ subscription: { ...bad, endpoint: 'https://push.evil.example/x' } })).status).toBe(400);
    expect((await agents.admin.post('/api/push/subscribe').send({ subscription: { ...bad, keys: { p256dh: 'abc', auth: 'def' } } })).status).toBe(400);
    for (const who of ['admin', 'sup', 'cm']) {
      devices[who] = fakeSubscription();
      const r = await agents[who].post('/api/push/subscribe').send({ subscription: devices[who] });
      expect(r.status).toBe(200);
    }
    expect((await agents.sup.post('/api/push/device').send({ endpoint: devices.sup.endpoint })).body).toEqual({ subscribed: true, prefs: {} });
    // Someone else's phone reads as not subscribed and can't be changed.
    expect((await agents.sup.post('/api/push/device').send({ endpoint: devices.admin.endpoint })).body.subscribed).toBe(false);
    expect((await agents.sup.put('/api/push/prefs').send({ endpoint: devices.admin.endpoint, prefs: { ua: false } })).status).toBe(404);
  });

  test('a not-located round alerts who may get it, minus the finisher and anyone who switched it off', async () => {
    const start = await agents.admin.post('/api/rounds').send({});
    await agents.admin.put(`/api/rounds/${start.body.round.id}/marks/${ids['201']}`).send({ mark: 'missing' });
    sent = [];
    expect((await agents.admin.post(`/api/rounds/${start.body.round.id}/finish`).send({})).status).toBe(200);
    await settle();
    expect(sent.map(s => s.endpoint)).toEqual([devices.sup.endpoint]);
    expect(sent[0].message).toMatchObject({ title: 'OpsPoint', url: '/m/rounds', tag: 'missing' });
    expect(sent[0].message.body).toMatch(/^A resident was not located on the \d{1,2}:\d{2} (AM|PM) wellness round\.$/);
    expect(sent[0].message.body).not.toMatch(/Rivera|201/);

    const p = await agents.sup.put('/api/push/prefs').send({ endpoint: devices.sup.endpoint, prefs: { missing: false, bogus: true } });
    expect(p.body.prefs).toEqual({ missing: false });
    const again = await agents.admin.post('/api/rounds').send({});
    await agents.admin.put(`/api/rounds/${again.body.round.id}/marks/${ids['201']}`).send({ mark: 'missing' });
    sent = [];
    await agents.admin.post(`/api/rounds/${again.body.round.id}/finish`).send({});
    await settle();
    expect(sent).toEqual([]);
  });

  test('existing events alert too: a UA request, with no name in the text', async () => {
    sent = [];
    expect((await agents.sup.post('/api/ua-requests').send({ client_id: ids['201'], client_name: 'Alex Rivera', room: '201' })).status).toBe(200);
    await settle();
    // Admin holds ua.acknowledge; the requester (sup) is left out.
    expect(sent.map(s => s.endpoint)).toEqual([devices.admin.endpoint]);
    expect(sent[0].message.body).toBe('UA requested. Open OpsPoint to see who.');
  });

  test('test alert, a dead subscription dropped, and switching off', async () => {
    sent = [];
    expect((await agents.admin.post('/api/push/test').send({ endpoint: devices.admin.endpoint })).status).toBe(200);
    expect(sent).toHaveLength(1);

    failFor = new Set([devices.cm.endpoint]);
    await push.notify('pass_ext', { body: 'A pass was extended.' });
    failFor = new Set();
    expect((await agents.cm.post('/api/push/device').send({ endpoint: devices.cm.endpoint })).body.subscribed).toBe(false);

    const off = await agents.admin.delete('/api/push/subscribe').send({ endpoint: devices.admin.endpoint });
    expect(off.body).toMatchObject({ ok: true, removed: true });
    expect((await agents.admin.delete('/api/push/subscribe').send({ endpoint: devices.admin.endpoint })).body.removed).toBe(false);
  });
});

describe('timed alerts (scheduler)', () => {
  function at(h, m) { const d = new Date(); d.setHours(h, m, 0, 0); return d; }

  beforeAll(async () => {
    await db.setSetting('wellness_schedule', ['22:00']);
    await db.setSetting('walk_schedule', []);
    const report = { id: 2, report_date: TODAY, shift: 'Night Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
    expect((await agents.admin.post('/api/data').send({ reports: [report], active_report_id: 2 })).status).toBe(200);
  });

  test('due soon, then overdue, then satisfied: each alerted once', async () => {
    sent = [];
    const soon = await scheduler.tick(at(21, 52));
    expect(soon).toEqual([`due:soon:${TODAY}T22:00`]);
    expect(sent.map(s => s.message.body)).toEqual(['Wellness check due at 10:00 PM.']);
    expect(await scheduler.tick(at(21, 53))).toEqual([]);

    sent = [];
    expect(await scheduler.tick(at(22, 5))).toEqual([`due:late:${TODAY}T22:00`]);
    expect(sent.map(s => s.message.body)).toEqual(['Wellness check overdue since 10:00 PM.']);

    await db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)', [2, '10:06 PM', 'Wellness check conducted by Rounds Sup. All 5 clients accounted for.']);
    sent = [];
    expect(await scheduler.tick(at(22, 10))).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('a resident late back from a pass, alerted once, with no name', async () => {
    const now = at(22, 30);
    const r = await agents.admin.post('/api/passes').send({
      client_id: ids['205'], room: '205', name: 'Casey Nguyen', departure: new Date(now - 86400000).toISOString(),
      return_date: new Date(now - 30 * 60000).toISOString(), status: 'Out',
    });
    expect(r.status).toBe(200);
    sent = [];
    const fired = await scheduler.tick(now);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatch(/^pass:\d+:/);
    expect(sent.map(s => s.message.body)).toEqual(['A resident is late back from a pass.']);
    expect(await scheduler.tick(new Date(now.getTime() + 60000))).toEqual([]);
  });
});

describe('the /m page', () => {
  const built = fs.existsSync(path.join(config.REACT_DIST, 'index.html'));

  (built ? test : test.skip)('carries the install tags', async () => {
    const r = await agents.admin.get('/m/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<link rel="manifest" href="/m.webmanifest">');
    expect(r.text).toContain('viewport-fit=cover');
  });

  test('sends a signed-out visitor to log in and back', async () => {
    const r = await request(app).get('/m/rounds');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/login?next=%2Fm%2Frounds');
  });

  test('the security policy lets the service worker register', async () => {
    // worker-src once allowed only blob:, which blocks /m-sw.js outright.
    // An API route, not a page: without a client build a page errors, and
    // Express's error response replaces the policy with its own.
    const r = await request(app).get('/api/me');
    expect(r.status).toBe(401);
    expect(r.headers['content-security-policy']).toMatch(/worker-src 'self'/);
  });
});
