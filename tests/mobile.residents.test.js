// Mobile step 3 back end: the snapshot's pending-UA list and announcements,
// the resident card (sections scoped by permission, clinical headlines only,
// every view access-logged), and the announcement push alert. Runs on either
// driver (scripts/pg-audit.sh runs it on Postgres).
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_residents_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;
const webpush = require('../server/lib/webpush');
{
  const k = webpush.generateKeys();
  process.env.VAPID_PUBLIC_KEY = k.publicKey;
  process.env.VAPID_PRIVATE_KEY = k.privateKey;
}

const request = require('supertest');
const { app, db, ready } = require('../server');
const push = require('../server/modules/push/service');

const PW = 'Residents!Passw0rd9';
const TODAY = new Date().toLocaleDateString('en-CA');
const LATER = new Date(Date.now() + 10 * 86400000).toLocaleDateString('en-CA');
const agents = {};
const ids = {};
let sent = [];

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function fakeSubscription() {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomBytes(8).toString('hex')}`, keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) } };
}
async function settle() { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 10)); }

async function makeUser(username, displayName, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    [username, displayName, 'pa', hash, salt, JSON.stringify(perms)]);
  const agent = request.agent(app);
  expect((await agent.post('/api/login').send({ username, password: PW })).status).toBe(200);
  return agent;
}

// Deep search for keys that must never reach a phone.
function findKeys(obj, banned, found = []) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (banned.includes(k)) found.push(k);
      findKeys(v, banned, found);
    }
  }
  return found;
}

beforeAll(async () => {
  await ready;
  push._setSender(async (sub, message) => { sent.push({ endpoint: sub.endpoint, message }); return { ok: true, status: 201 }; });
  agents.admin = await makeUser('res_admin', 'Res Admin', db.PERMISSIONS);
  agents.pa = await makeUser('res_pa', 'Res PA', db.ROLE_PRESETS.pa);
  agents.cm = await makeUser('res_cm', 'Res CM', db.ROLE_PRESETS.case_manager);
  agents.none = await makeUser('res_none', 'Res None', ['log.add']);
  const a = agents.admin;

  for (const [room, name] of [['201', 'Alex Rivera'], ['202', 'Jordan Lee'], ['203', 'Sam Patel']]) {
    const r = await a.post('/api/clients').send({ name, room, intake_date: TODAY, case_manager: 'Res CM' });
    expect(r.status).toBe(200);
    ids[room] = r.body.id || (r.body.client && r.body.client.id);
  }
  const report = { id: 1, report_date: TODAY, shift: 'Night Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
  expect((await a.post('/api/data').send({ reports: [report], active_report_id: 1 })).status).toBe(200);

  // Jordan away on a pass; a UA requested for Sam.
  expect((await a.post('/api/passes').send({ client_id: ids['202'], room: '202', name: 'Jordan Lee', departure: new Date().toISOString(), return_date: new Date(Date.now() + 86400000).toISOString(), status: 'Out' })).status).toBe(200);
  expect((await a.post('/api/ua-requests').send({ client_id: ids['203'], client_name: 'Sam Patel', room: '203' })).status).toBe(200);

  // Alex: a UA result, an open infraction, mail in both states, a chore signed off today.
  expect((await a.post('/api/ua-records').send({
    client_id: ids['201'], client_name: 'Alex Rivera', room: '201', tested_at: new Date().toISOString(),
    collection_method: 'observed', reason: 'random', result: 'pass', panel_results: { THC: 'neg' }, witnessed_by_name: 'Res Admin', notes: '', chain_of_custody: '',
  })).status).toBe(200);
  expect((await a.post('/api/violations').send({ client_id: ids['201'], client_name: 'Alex Rivera', room: '201', violation_date: TODAY, description: 'Late to group' })).status).toBe(200);
  for (let i = 0; i < 2; i++) expect((await a.post('/api/mail').send({ clients: [{ client_id: ids['201'], notes: '', mail_type: 'letter' }] })).status).toBe(200);
  const mail = (await a.get('/api/mail')).body.filter(m => m.client_id === ids['201']);
  expect((await a.put(`/api/mail/${mail[0].id}/approve`).send({})).status).toBe(200);
  expect((await a.patch(`/api/clients/${ids['201']}/chore`).send({ chore: 'Dishes', chore_time: 'PM' })).status).toBe(200);
  expect((await a.put('/api/chore-log').send({ client_id: ids['201'], log_date: TODAY, initials: 'JO' })).status).toBe(200);

  // Clinical records for Alex, one of them signed.
  expect((await a.post('/api/clinical/treatment-plans').send({ client_id: ids['201'], plan_date: TODAY, target_date: LATER, review_date: LATER, presenting_problem: 'SECRET PROBLEM', goals: [{ text: 'SECRET GOAL' }], strengths: '', barriers: '', status: 'active' })).status).toBe(200);
  const note = await a.post('/api/clinical/notes').send({ client_id: ids['201'], note_type: 'progress', note_date: TODAY, content: 'SECRET NOTE' });
  expect(note.status).toBe(200);
  const noteId = note.body.id || (note.body.record && note.body.record.id);
  expect((await a.patch(`/api/clinical/notes/${noteId}/sign`).send({})).status).toBe(200);
  expect((await a.post('/api/clinical/assessments').send({ client_id: ids['201'], assessment_type: 'mental_status', assessment_date: TODAY, content: { q: 'SECRET ANSWER' }, score: 7, score_label: 'Mild' })).status).toBe(200);
  expect((await a.post('/api/milestones').send({ client_id: ids['201'], phase: 'phase1', objective: '30 days clean', target_date: LATER, notes: '' })).status).toBe(200);

  expect((await a.post('/api/broadcasts').send({ message: 'Fire drill tomorrow at 10' })).status).toBe(200);
});

afterAll(() => {
  push._setSender(null);
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('snapshot additions', () => {
  test('pending UA requests by resident', async () => {
    const r = await agents.pa.get('/api/m/snapshot');
    expect(r.body.ua_pending).toEqual([ids['203']]);
  });

  test('announcements only for broadcast.receive', async () => {
    const cm = await agents.cm.get('/api/m/snapshot');
    expect(cm.body.announcements).toHaveLength(1);
    expect(cm.body.announcements[0]).toMatchObject({ sender_name: 'Res Admin', message: 'Fire drill tomorrow at 10' });
    const pa = await agents.pa.get('/api/m/snapshot');
    expect(pa.body.announcements).toEqual([]);
  });
});

describe('resident card', () => {
  test('everyday sections for any mobile account', async () => {
    const r = await agents.pa.get(`/api/m/residents/${ids['201']}`);
    expect(r.status).toBe(200);
    expect(r.body.resident).toMatchObject({ id: ids['201'], room: '201', name: 'Alex Rivera', case_manager: 'Res CM' });
    expect(r.body.pass).toBeNull();
    expect(r.body.chore).toMatchObject({ name: 'Dishes', time: 'PM', signed_by: 'JO', due_today: true });
    expect(r.body.mail).toEqual({ awaiting_approval: 1, to_deliver: 1 });
    expect(r.body.ua).toMatchObject({ pending_request: false, last: { result: 'pass', collection_method: 'observed' } });
    expect(r.body.infractions).toEqual({ open: 1 });
    expect(r.body.clinical).toBeNull();   // the PA preset holds no clinical permission
  });

  test('clinical headlines for clinical staff, never the content', async () => {
    const r = await agents.cm.get(`/api/m/residents/${ids['201']}`);
    expect(r.status).toBe(200);
    const cl = r.body.clinical;
    expect(cl.treatment).toMatchObject({ status: 'active', review_date: LATER });
    expect(cl.last_note).toMatchObject({ note_type: 'progress', signed_by_name: 'Res Admin' });
    expect(cl.last_note.signed_at).toBeTruthy();
    expect(cl.last_assessment).toMatchObject({ assessment_type: 'mental_status', score_label: 'Mild' });
    expect(cl.next_milestone).toMatchObject({ objective: '30 days clean', target_date: LATER });
    expect(findKeys(r.body, ['content', 'goals', 'presenting_problem', 'strengths', 'barriers', 'panel_results', 'notes'])).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(/SECRET/);
  });

  test('pass and pending UA show on the residents they belong to', async () => {
    const jordan = await agents.pa.get(`/api/m/residents/${ids['202']}`);
    expect(jordan.body.pass).toMatchObject({ status: 'Out' });
    expect(jordan.body.pass.return_date).toBeTruthy();
    const sam = await agents.pa.get(`/api/m/residents/${ids['203']}`);
    expect(sam.body.ua.pending_request).toBe(true);
  });

  test('every view is written to the access log', async () => {
    await agents.cm.get(`/api/m/residents/${ids['201']}`);
    const row = await db.query1(
      "SELECT actor_name, target_type, target_id, target_label, detail FROM audit_log WHERE action='record.read' AND target_type='clients' ORDER BY id DESC LIMIT 1");
    expect(row).toMatchObject({ actor_name: 'Res CM', target_type: 'clients', target_label: 'Resident card (mobile): Alex Rivera' });
    expect(Number(row.target_id)).toBe(ids['201']);
    expect(String(row.detail)).toMatch(/treatment_plans/);
  });

  test('unknown resident is a 404; no mobile access is a 403', async () => {
    expect((await agents.pa.get('/api/m/residents/99999')).status).toBe(404);
    expect((await agents.pa.get('/api/m/residents/abc')).status).toBe(404);
    expect((await agents.none.get(`/api/m/residents/${ids['201']}`)).status).toBe(403);
  });
});

describe('announcement alert', () => {
  test('goes to broadcast.receive holders, not the sender, and carries no message text', async () => {
    const devices = {};
    for (const who of ['admin', 'pa', 'cm']) {
      devices[who] = fakeSubscription();
      expect((await agents[who].post('/api/push/subscribe').send({ subscription: devices[who] })).status).toBe(200);
    }
    sent = [];
    expect((await agents.admin.post('/api/broadcasts').send({ message: 'Room 203 needs a check at 2 AM' })).status).toBe(200);
    await settle();
    expect(sent.map(s => s.endpoint)).toEqual([devices.cm.endpoint]);
    expect(sent[0].message).toMatchObject({ url: '/m/announcements', tag: 'broadcast', body: 'New announcement from Res Admin. Open OpsPoint to read it.' });
  });
});
