// UA results are never deleted: a mistake is voided, with a reason, by someone
// holding ua.void, and stays on file (record and shift-log line) marked void.
// The photo of the cup goes on once, by anyone who records UAs, and is never
// replaced. Medical notes on the shift report are for everyone; intake details
// stay with clinical staff, and a non-clinical edit can't wipe them.
// Runs on either driver.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_uavoid_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW = 'UaVoid!Passw0rd9';
const TODAY = new Date().toLocaleDateString('en-CA');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const agents = {};
let res;

async function makeUser(username, role, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,0)`,
    [username, username, role, hash, salt, JSON.stringify(perms)]);
  const agent = request.agent(app);
  expect((await agent.post('/api/login').send({ username, password: PW })).status).toBe(200);
  return agent;
}
async function conduct(result = 'fail', over = {}) {
  const r = await agents.admin.post('/api/ua-records').send({
    client_id: res.id, client_name: 'Void Resident', room: '401', tested_at: new Date().toISOString(),
    collection_method: 'observed', reason: 'random', result, panel_results: { THC: result === 'fail' ? 'pos' : 'neg' },
    witnessed_by_name: 'Pat', notes: '', log_time: '9:40 AM', ...over });
  expect(r.status).toBe(200);
  return { id: r.body.record.id, line: r.body.log_entry_id };
}
const line = (id) => db.query1('SELECT * FROM log_entries WHERE id=?', [id]);
const record = (id) => db.query1('SELECT * FROM ua_records WHERE id=?', [id]);

beforeAll(async () => {
  await ready;
  agents.admin = await makeUser('uv_admin', 'admin', db.PERMISSIONS);
  agents.sup   = await makeUser('uv_sup', 'supervisor', db.ROLE_PRESETS.supervisor);
  agents.pa    = await makeUser('uv_pa', 'pa', db.ROLE_PRESETS.pa);
  agents.plain = await makeUser('uv_plain', 'pa', ['issues.edit', 'residents.edit']);   // no clinical permission, no ua.record
  const c = await agents.admin.post('/api/clients').send({ name: 'Void Resident', room: '401' });
  res = { id: c.body.id || (c.body.client && c.body.client.id) };
  const rep = { id: 1, report_date: TODAY, shift: 'Day Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
  expect((await agents.admin.post('/api/data').send({ reports: [rep], active_report_id: 1 })).status).toBe(200);
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('permissions', () => {
  test('ua.void is a supervisor and admin permission; ua.delete is gone', () => {
    expect(db.PERMISSIONS).toContain('ua.void');
    expect(db.PERMISSIONS).not.toContain('ua.delete');
    expect(db.ROLE_PRESETS.supervisor).toContain('ua.void');
    expect(db.ROLE_PRESETS.admin).toContain('ua.void');
    expect(db.ROLE_PRESETS.pa).not.toContain('ua.void');
    expect(db.ROLE_PRESETS.case_manager).not.toContain('ua.void');
  });
});

describe('voiding a UA result', () => {
  test('needs ua.void and a reason; voids the record and its shift-log line, which both stay', async () => {
    const u = await conduct('fail');
    expect((await agents.pa.post(`/api/ua-records/${u.id}/void`).send({ reason: 'x' })).status).toBe(403);
    expect((await agents.sup.post(`/api/ua-records/${u.id}/void`).send({ reason: '  ' })).status).toBe(400);
    const r = await agents.sup.post(`/api/ua-records/${u.id}/void`).send({ reason: 'Entered for the wrong resident' });
    expect(r.status).toBe(200);
    const rec = await record(u.id);
    expect(rec).toMatchObject({ voided_by_name: 'uv_sup', void_reason: 'Entered for the wrong resident' });
    expect(rec.voided_at).toBeTruthy();
    const le = await line(u.line);
    expect(le).toMatchObject({ void_reason: 'Entered for the wrong resident' });
    expect(le.text).toMatch(/— UA:/);                       // the words stay as written
    expect((await agents.sup.post(`/api/ua-records/${u.id}/void`).send({ reason: 'again' })).status).toBe(409);
    expect((await agents.admin.patch(`/api/ua-records/${u.id}`).send({ notes: 'changed' })).status).toBe(409);
  });

  test('from the Report tab, voiding the line voids its record too', async () => {
    const u = await conduct('pass');
    expect((await agents.sup.post(`/api/log/${u.line}/void`).send({ reason: 'Duplicate entry' })).status).toBe(200);
    expect((await record(u.id)).void_reason).toBe('Duplicate entry');
    expect((await line(u.line)).voided_at).toBeTruthy();
    const ordinary = (await agents.admin.patch('/api/data').send({ reportId: 1, log_entry: { time: '9:50 AM', text: 'Quiet hour' } })).body.log_entry_id;
    expect((await agents.sup.post(`/api/log/${ordinary}/void`).send({ reason: 'x' })).status).toBe(400);
  });

  test('nobody deletes one — not the line, not the record', async () => {
    const u = await conduct('fail');
    expect((await agents.admin.delete(`/api/log/${u.line}`)).status).toBe(403);
    expect((await agents.admin.delete(`/api/ua-records/${u.id}`)).status).toBe(404);   // the route is gone
    expect(await line(u.line)).toBeTruthy();
    expect(await record(u.id)).toBeTruthy();
  });

  test('the resident card\'s last UA skips voided results', async () => {
    const c = await agents.admin.post('/api/clients').send({ name: 'Card Resident', room: '402' });
    const cid = c.body.id || (c.body.client && c.body.client.id);
    const mine = { client_id: cid, client_name: 'Card Resident', room: '402' };
    const older = await conduct('pass', { ...mine, tested_at: new Date(Date.now() - 3600000).toISOString() });
    const newer = await conduct('fail', mine);
    await agents.sup.post(`/api/ua-records/${newer.id}/void`).send({ reason: 'Wrong cup' });
    const card = (await agents.admin.get(`/api/m/residents/${cid}`)).body;
    expect(card.ua.last.result).toBe('pass');
    expect(older.id).toBeTruthy();
  });

  test('a report with UA results on it cannot be deleted', async () => {
    const d = (await agents.admin.get('/api/data')).body;
    const r1 = d.reports.find(r => r.id === 1);
    expect((await agents.admin.post('/api/data').send({ reports: [{ ...r1, is_closed: true, roster_snapshot: [] }], active_report_id: null })).status).toBe(200);
    expect((await agents.admin.delete('/api/reports/1')).status).toBe(409);
    const empty = { id: 2, report_date: TODAY, shift: 'Swing Shift', mod_name: '', is_closed: true, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
    expect((await agents.admin.post('/api/data').send({ reports: [empty] })).status).toBe(200);
    expect((await agents.admin.delete('/api/reports/2').send({ reason: 'Started by mistake' })).status).toBe(200);
    const open = { ...empty, id: 3, is_closed: false };
    expect((await agents.admin.post('/api/data').send({ reports: [open], active_report_id: 3 })).status).toBe(200);
  });
});

describe('the photo of the cup', () => {
  test('anyone who records UAs attaches it, once; only on UA lines', async () => {
    const u = await conduct('fail');
    expect((await agents.plain.post(`/api/log/${u.line}/photo`).send({ photo: PNG })).status).toBe(403);   // no ua.record
    expect((await agents.pa.post(`/api/log/${u.line}/photo`).send({ photo: PNG })).status).toBe(200);
    expect((await agents.admin.post(`/api/log/${u.line}/photo`).send({ photo: PNG })).status).toBe(409);   // never replaced
    const ordinary = (await agents.admin.patch('/api/data').send({ reportId: 3, log_entry: { time: '10:00 AM', text: 'Room check' } })).body.log_entry_id;
    expect((await agents.pa.post(`/api/log/${ordinary}/photo`).send({ photo: PNG })).status).toBe(400);
  });
});

describe('medical notes and intake details', () => {
  test('medical notes on the shift report are for everyone', async () => {
    await agents.admin.patch('/api/data').send({ reportId: 3, med_notes: ['Rm 401 diabetic — snack at 9 PM'] });
    const d = (await agents.plain.get('/api/data')).body;
    expect(d.reports.find(r => r.id === 3).med_notes).toEqual(['Rm 401 diabetic — snack at 9 PM']);
  });

  test('intake details stay with clinical staff, and a non-clinical edit leaves them alone', async () => {
    expect((await agents.admin.put(`/api/clients/${res.id}`).send({ intake_notes: 'Referred by county', referral_source: 'County' })).status).toBe(200);
    const mine = (await agents.plain.get('/api/data')).body.clients.find(c => c.id === res.id);
    expect(mine.intake_notes).toBe('');
    // Their edit form sends the blanks they were shown.
    expect((await agents.plain.put(`/api/clients/${res.id}`).send({ name: 'Void Resident', phone: '555-0100', intake_notes: '', referral_source: '' })).status).toBe(200);
    const stored = await db.query1('SELECT intake_notes, referral_source, phone FROM clients WHERE id=?', [res.id]);
    expect(stored).toMatchObject({ intake_notes: 'Referred by county', referral_source: 'County', phone: '555-0100' });
  });
});
