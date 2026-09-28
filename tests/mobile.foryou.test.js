// Mobile step 4 back end: the "For you" list (groups present only with the
// permission that acts on them, emptied by the existing actions), and quick
// unlock with a PIN (setup rules, the httpOnly device cookie, unlock with its
// lockout, and every way it ends). Runs on either driver.
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_foryou_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');
const { loginRateClear } = require('../server/middleware/rateLimit');

const PW = 'ForYou!Passw0rd9';
const TODAY = new Date().toLocaleDateString('en-CA');
const SOON = new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-CA');
const agents = {};
const ids = {};

function clearRate() { for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) loginRateClear(ip); }

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
const groups = (todo) => Object.keys(todo).sort();

beforeAll(async () => {
  await ready;
  agents.admin = await makeUser('fy_admin', 'FY Admin', db.PERMISSIONS);
  agents.pa = await makeUser('fy_pa', 'FY PA', db.ROLE_PRESETS.pa);
  agents.sup = await makeUser('fy_sup', 'FY Sup', db.ROLE_PRESETS.supervisor);
  agents.cm = await makeUser('fy_cm', 'FY CM', db.ROLE_PRESETS.case_manager);
  const a = agents.admin;
  for (const [room, name] of [['201', 'Alex Rivera'], ['202', 'Jordan Lee'], ['203', 'Sam Patel'], ['204', 'Morgan Diaz']]) {
    const r = await a.post('/api/clients').send({ name, room });
    ids[room] = r.body.id || (r.body.client && r.body.client.id);
  }
  const report = { id: 1, report_date: TODAY, shift: 'Day Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
  expect((await a.post('/api/data').send({ reports: [report], active_report_id: 1 })).status).toBe(200);

  // Jordan due back within the hour; Sam leaving on an approved pass today.
  expect((await a.post('/api/passes').send({ client_id: ids['202'], room: '202', name: 'Jordan Lee', departure: new Date(Date.now() - 86400000).toISOString(), return_date: new Date(Date.now() + 3600000).toISOString(), status: 'Out' })).status).toBe(200);
  const leave = new Date(); leave.setHours(23, 0, 0, 0);
  expect((await a.post('/api/passes').send({ client_id: ids['203'], room: '203', name: 'Sam Patel', departure: leave.toISOString(), return_date: new Date(leave.getTime() + 86400000).toISOString(), status: 'Approved' })).status).toBe(200);

  expect((await a.post('/api/ua-requests').send({ client_id: ids['201'], client_name: 'Alex Rivera', room: '201' })).status).toBe(200);
  for (let i = 0; i < 2; i++) expect((await a.post('/api/mail').send({ clients: [{ client_id: ids['201'], notes: '', mail_type: 'letter' }] })).status).toBe(200);
  const mail = (await a.get('/api/mail')).body;
  expect((await a.put(`/api/mail/${mail[0].id}/approve`).send({})).status).toBe(200);

  // Chores: Alex owes one, Morgan already signed, Jordan is away on the pass.
  for (const room of ['201', '202', '204']) expect((await a.patch(`/api/clients/${ids[room]}/chore`).send({ chore: 'Dishes', chore_time: 'PM' })).status).toBe(200);
  expect((await a.put('/api/chore-log').send({ client_id: ids['204'], log_date: TODAY, initials: 'MD' })).status).toBe(200);

  // An infraction to review (Alex) and one with a consequence to carry out (Morgan).
  expect((await a.post('/api/violations').send({ client_id: ids['201'], client_name: 'Alex Rivera', room: '201', violation_date: TODAY, description: 'Late to group' })).status).toBe(200);
  expect((await a.post('/api/violations').send({ client_id: ids['204'], client_name: 'Morgan Diaz', room: '204', violation_date: TODAY, description: 'Noise' })).status).toBe(200);
  const v = (await a.get('/api/violations')).body;
  const list = Array.isArray(v) ? v : (v.violations || v.rows || []);
  const morgan = list.find(x => x.client_id === ids['204']);
  expect((await a.put(`/api/violations/${morgan.id}/review`).send({ action: 'assign', consequence: 'Extra kitchen duty' })).status).toBe(200);

  expect((await a.post('/api/milestones').send({ client_id: ids['201'], phase: 'phase1', objective: '30 days clean', target_date: SOON, notes: '' })).status).toBe(200);
  expect((await a.post('/api/incidents').send({ client_id: ids['201'], incident_date: TODAY, incident_time: '', narrative: 'SECRET NARRATIVE', severity: 'low', incident_type: 'Behavior', corrective_action: '', notifications_required: [] })).status).toBe(200);
  expect((await a.post('/api/consent-records').send({ client_id: ids['201'], recipient_name: 'County Probation', recipient_org: '', purpose: 'Court', information_type: 'all', effective_date: TODAY, expiration_date: SOON, signature_on_file: true })).status).toBe(200);
  expect((await a.post('/api/clinical/treatment-plans').send({ client_id: ids['201'], plan_date: TODAY, target_date: '', review_date: SOON, presenting_problem: 'x', goals: [], strengths: '', barriers: '', status: 'active' })).status).toBe(200);
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('"For you" list', () => {
  test('each role gets the groups it can act on, and only those', async () => {
    const pa = (await agents.pa.get('/api/m/snapshot')).body.todo;
    expect(groups(pa)).toEqual(['chores', 'consequences', 'mail_deliver', 'pass_due', 'pass_leaving', 'ua']);
    const sup = (await agents.sup.get('/api/m/snapshot')).body.todo;
    expect(groups(sup)).toEqual(['chores', 'consequences', 'incidents', 'infractions', 'mail_deliver', 'pass_due', 'pass_leaving', 'plan_reviews', 'ua']);
    const cm = (await agents.cm.get('/api/m/snapshot')).body.todo;
    expect(groups(cm)).toEqual(['consents', 'mail_approve', 'milestones', 'pass_due', 'pass_leaving', 'plan_reviews']);
  });

  test('the items are the right ones', async () => {
    const pa = (await agents.pa.get('/api/m/snapshot')).body.todo;
    expect(pa.ua.map(u => u.client_name)).toEqual(['Alex Rivera']);
    expect(pa.pass_due.map(p => p.name)).toEqual(['Jordan Lee']);
    expect(pa.pass_leaving.map(p => p.name)).toEqual(['Sam Patel']);
    expect(pa.mail_deliver).toHaveLength(1);
    expect(pa.chores.map(c => c.name)).toEqual(['Alex Rivera']);   // Morgan signed, Jordan away
    expect(pa.consequences).toEqual([expect.objectContaining({ client_name: 'Morgan Diaz', consequence: 'Extra kitchen duty', can_complete: false })]);
    const sup = (await agents.sup.get('/api/m/snapshot')).body.todo;
    expect(sup.infractions.map(v => v.description)).toEqual(['Late to group']);
    expect(sup.consequences[0].can_complete).toBe(true);
    expect(sup.incidents).toEqual([expect.objectContaining({ client_name: 'Alex Rivera', severity: 'low' })]);
    expect(JSON.stringify(sup)).not.toMatch(/SECRET/);   // incident headline only
    const cm = (await agents.cm.get('/api/m/snapshot')).body.todo;
    expect(cm.mail_approve).toHaveLength(1);
    expect(cm.milestones.map(m => m.objective)).toEqual(['30 days clean']);
    expect(cm.consents).toEqual([expect.objectContaining({ client_name: 'Alex Rivera', recipient_name: 'County Probation', expiration_date: SOON })]);
    expect(cm.plan_reviews).toEqual([expect.objectContaining({ client_name: 'Alex Rivera', review_date: SOON })]);
  });

  test('the existing actions clear them', async () => {
    const before = (await agents.sup.get('/api/m/snapshot')).body.todo;
    expect((await agents.pa.post(`/api/ua-requests/${before.ua[0].id}/acknowledge`).send({})).status).toBe(200);
    expect((await agents.pa.put(`/api/passes/${before.pass_due[0].id}`).send({ status: 'Returned' })).status).toBe(200);
    expect((await agents.pa.put(`/api/passes/${before.pass_leaving[0].id}`).send({ status: 'Out' })).status).toBe(200);
    expect((await agents.pa.put(`/api/mail/${before.mail_deliver[0].id}/deliver`).send({})).status).toBe(200);
    expect((await agents.pa.put('/api/chore-log').send({ client_id: before.chores[0].client_id, log_date: TODAY, initials: 'FP' })).status).toBe(200);
    expect((await agents.sup.put(`/api/violations/${before.infractions[0].id}/review`).send({ action: 'waive' })).status).toBe(200);
    expect((await agents.sup.put(`/api/violations/${before.consequences[0].id}/complete`).send({})).status).toBe(200);
    const cmBefore = (await agents.cm.get('/api/m/snapshot')).body.todo;
    expect((await agents.cm.put(`/api/milestones/${cmBefore.milestones[0].id}/signoff`).send({})).status).toBe(200);

    const sup = (await agents.sup.get('/api/m/snapshot')).body.todo;
    for (const k of ['ua', 'pass_due', 'mail_deliver', 'infractions', 'consequences']) expect([k, sup[k]]).toEqual([k, []]);
    // Sam checked out: leaves "leaving" (and is not due back for a day).
    expect(sup.pass_leaving).toEqual([]);
    // Jordan returned, so his chore is due again and nobody has signed it.
    expect(sup.chores.map(c => c.name)).toEqual(['Jordan Lee']);
    expect((await agents.cm.get('/api/m/snapshot')).body.todo.milestones).toEqual([]);
  });
});

describe('quick unlock with a PIN', () => {
  let phone;   // an agent that holds the device cookie
  const PIN = '482915';

  beforeAll(async () => {
    clearRate();
    phone = request.agent(app);
    expect((await phone.post('/api/login').send({ username: 'fy_pa', password: PW })).status).toBe(200);
  });

  test('setting a PIN: six digits, no patterns, and it needs mobile access', async () => {
    for (const bad of ['1234', '12345a', '111111', '123456', '654321', '121212', '147147']) {
      const r = await phone.post('/api/auth/pin/setup').send({ pin: bad });
      expect([bad, r.status]).toEqual([bad, 400]);
    }
    const none = await makeUser('fy_none', 'FY None', ['log.add']);
    expect((await none.post('/api/auth/pin/setup').send({ pin: PIN })).status).toBe(403);
    expect((await request(app).post('/api/auth/pin/setup').send({ pin: PIN })).status).toBe(401);
  });

  test('a good PIN sets an httpOnly, SameSite=Strict cookie scoped to the PIN routes', async () => {
    const r = await phone.post('/api/auth/pin/setup').send({ pin: PIN });
    expect(r.status).toBe(200);
    const cookie = (r.headers['set-cookie'] || []).find(c => c.startsWith('opspoint_pin='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/pin/i);
    expect((await phone.get('/api/auth/pin/status')).body).toEqual({ available: true, name: 'FY PA', mine: true });
    expect((await request(app).get('/api/auth/pin/status')).body).toEqual({ available: false });
    // someone else signed in on this phone: the PIN is there, but not theirs
    await phone.post('/logout');
    expect((await phone.post('/api/login').send({ username: 'fy_none', password: PW })).status).toBe(200);
    expect((await phone.get('/api/auth/pin/status')).body).toEqual({ available: true, name: 'FY PA', mine: false });
  });

  test('after signing out, the PIN signs the phone back in; a wrong one says how many tries are left', async () => {
    clearRate();
    await phone.post('/logout');
    expect((await phone.get('/api/me')).status).toBe(401);
    const wrong = await phone.post('/api/auth/pin/unlock').send({ pin: '000001' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('Wrong PIN. 4 tries left.');
    const ok = await phone.post('/api/auth/pin/unlock').send({ pin: PIN });
    expect(ok.body).toEqual({ ok: true, mustChangePw: false });
    const me = await phone.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('fy_pa');
    const row = await db.query1("SELECT actor_name FROM audit_log WHERE action='auth.pin_login' ORDER BY id DESC LIMIT 1");
    expect(row.actor_name).toBe('FY PA');
  });

  test('the PIN alone is useless without the phone, and a foreign Origin is refused', async () => {
    clearRate();
    expect((await request(app).post('/api/auth/pin/unlock').send({ pin: PIN })).body.gone).toBe(true);
    expect((await phone.post('/api/auth/pin/unlock').set('Origin', 'https://evil.example').send({ pin: PIN })).status).toBe(403);
  });

  test('five wrong PINs switch quick unlock off', async () => {
    clearRate();
    await phone.post('/logout');
    for (let i = 1; i <= 4; i++) expect((await phone.post('/api/auth/pin/unlock').send({ pin: '000002' })).body.left).toBe(5 - i);
    const fifth = await phone.post('/api/auth/pin/unlock').send({ pin: '000002' });
    expect(fifth.body).toMatchObject({ gone: true });
    expect((await phone.get('/api/auth/pin/status')).body.available).toBe(false);
    clearRate();
    expect((await phone.post('/api/auth/pin/unlock').send({ pin: PIN })).body.gone).toBe(true);
  });

  test('it ends with a password change, with signing out on purpose, and after 30 days unused', async () => {
    clearRate();
    expect((await phone.post('/api/login').send({ username: 'fy_pa', password: PW })).status).toBe(200);
    expect((await phone.post('/api/auth/pin/setup').send({ pin: PIN })).status).toBe(200);
    expect((await phone.post('/api/users/me/password').send({ currentPassword: PW, newPassword: 'ForYou!Passw0rd8' })).status).toBe(200);
    expect((await phone.get('/api/auth/pin/status')).body.available).toBe(false);

    expect((await phone.post('/api/auth/pin/setup').send({ pin: PIN })).status).toBe(200);
    const off = await phone.delete('/api/auth/pin');
    expect(off.body).toEqual({ ok: true, removed: true });
    expect((await phone.get('/api/auth/pin/status')).body.available).toBe(false);

    expect((await phone.post('/api/auth/pin/setup').send({ pin: PIN })).status).toBe(200);
    await db.run('UPDATE device_pins SET expires_at=?', [new Date(Date.now() - 1000).toISOString()]);
    expect((await phone.get('/api/auth/pin/status')).body.available).toBe(false);
  });

  test('losing mobile access ends it too', async () => {
    clearRate();
    expect((await phone.post('/api/auth/pin/setup').send({ pin: PIN })).status).toBe(200);
    await phone.post('/logout');
    const u = await db.query1("SELECT id, permissions FROM users WHERE username='fy_pa'");
    await db.run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(JSON.parse(u.permissions).filter(p => p !== 'mobile.access')), u.id]);
    expect((await phone.post('/api/auth/pin/unlock').send({ pin: PIN })).body.gone).toBe(true);
  });
});
