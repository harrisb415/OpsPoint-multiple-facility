// Found by the permission audit (scripts/perm-audit): the bulk report save
// (POST /api/data) rewrote the whole report — it deleted every log line missing
// from the list sent and overwrote statuses, issues and comments on
// reports.create alone. So a browser holding a stale copy wiped lines others
// had added just by closing the shift. Also here: roster comments' own PATCH
// field, UA lines never being deleted, sealed reports, and the master group
// list taking clinical.groups. Runs on either driver.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_bulksave_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW = 'BulkSave!Passw0rd9';
const TODAY = new Date().toLocaleDateString('en-CA');
const agents = {};
let rid;

async function makeUser(username, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,0)`,
    [username, username, 'pa', hash, salt, JSON.stringify(perms)]);
  const agent = request.agent(app);
  expect((await agent.post('/api/login').send({ username, password: PW })).status).toBe(200);
  return agent;
}
const report = async () => (await agents.admin.get('/api/data')).body.reports.find(r => r.id === 1);
const lineIds = async () => (await db.query('SELECT id FROM log_entries WHERE report_id=1 ORDER BY id')).map(e => e.id);
async function addLine(text) {
  const r = await agents.admin.patch('/api/data').send({ reportId: 1, log_entry: { time: '9:00 AM', text } });
  return r.body.log_entry_id;
}

beforeAll(async () => {
  await ready;
  agents.admin = await makeUser('bs_admin', db.PERMISSIONS);
  agents.creator = await makeUser('bs_creator', ['reports.create', 'reports.close']);   // no status.edit / issues.edit / log.*
  agents.staff = await makeUser('bs_staff', ['status.edit']);
  agents.uaDeleter = await makeUser('bs_uadel', ['ua.delete']);
  agents.clinician = await makeUser('bs_clin', ['groups.view', 'clinical.groups']);
  const c = await agents.admin.post('/api/clients').send({ name: 'Bulk Resident', room: '301' });
  rid = c.body.id || (c.body.client && c.body.client.id);
  const rep = { id: 1, report_date: TODAY, shift: 'Day Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
  expect((await agents.admin.post('/api/data').send({ reports: [rep], active_report_id: 1 })).status).toBe(200);
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('bulk report save', () => {
  test('a stale copy no longer deletes lines added since it was loaded', async () => {
    const stale = await report();                       // loaded before the new line
    const added = await addLine('Added by someone else');
    const r = await agents.admin.post('/api/data').send({ reports: [{ ...stale, mod_name: 'Saved from a stale copy' }] });
    expect(r.status).toBe(200);
    expect(await lineIds()).toContain(added);
    expect((await report()).mod_name).toBe('Saved from a stale copy');
  });

  test('a report sent without any log list keeps its log', async () => {
    const before = await lineIds();
    const { log_entries, ...rest } = await report();
    expect((await agents.admin.post('/api/data').send({ reports: [rest] })).status).toBe(200);
    expect(await lineIds()).toEqual(before);
  });

  test('reports.create alone cannot change statuses, comments, issues or med notes through it', async () => {
    await agents.admin.patch('/api/data').send({ reportId: 1, statuses: { [rid]: 'building' }, issues: ['Kept issue'] });
    const cur = await report();
    const r = await agents.creator.post('/api/data').send({ reports: [{ ...cur,
      statuses: { [rid]: 'hospital' }, comments: { [rid]: 'sneaky' }, issues: [], med_notes: ['sneaky'], log_entries: [] }] });
    expect(r.status).toBe(200);
    const after = await report();
    expect(after.statuses[rid]).toBe('building');
    expect(after.comments[rid]).toBeUndefined();
    expect(after.issues).toEqual(['Kept issue']);
    expect(after.med_notes).toEqual([]);
    expect((await lineIds()).length).toBeGreaterThan(0);
  });

  test('closing the shift still freezes statuses, even without status.edit', async () => {
    const cur = await report();
    const r = await agents.creator.post('/api/data').send({ reports: [{ ...cur, is_closed: true, statuses: { [rid]: 'pass' }, roster_snapshot: [] }], active_report_id: null });
    expect(r.status).toBe(200);
    const closed = (await db.query1('SELECT is_closed, statuses FROM reports WHERE id=1'));
    expect(!!closed.is_closed).toBe(true);
    expect(JSON.parse(closed.statuses)[rid]).toBe('pass');
    // Reopen a fresh report for the rest of the file.
    const rep2 = { id: 2, report_date: TODAY, shift: 'Swing Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
    expect((await agents.admin.post('/api/data').send({ reports: [rep2], active_report_id: 2 })).status).toBe(200);
  });
});

describe('roster comments', () => {
  test('save per resident with status.edit, and not without it', async () => {
    expect((await agents.staff.patch('/api/data').send({ reportId: 2, comments: { [rid]: 'At work until 5' } })).status).toBe(200);
    const r2 = (await agents.admin.get('/api/data')).body.reports.find(r => r.id === 2);
    expect(r2.comments[rid]).toBe('At work until 5');
    expect((await agents.creator.patch('/api/data').send({ reportId: 2, comments: { [rid]: 'x' } })).status).toBe(403);
  });
});

describe('log lines', () => {
  let normal, uaLine;
  beforeAll(async () => {
    normal = (await agents.admin.patch('/api/data').send({ reportId: 2, log_entry: { time: '10:00 AM', text: 'Ordinary line' } })).body.log_entry_id;
    uaLine = (await agents.admin.patch('/api/data').send({ reportId: 2, log_entry: { time: '10:05 AM', text: 'Bulk Resident (Rm. 301) — UA: All NEG — by X [Random, Observed]' } })).body.log_entry_id;
  });

  test('nobody deletes a UA line, not even with log.delete; other lines need log.delete', async () => {
    expect((await agents.uaDeleter.delete(`/api/log/${normal}`)).status).toBe(403);
    expect((await agents.admin.delete(`/api/log/${uaLine}`)).status).toBe(403);
    expect(await db.query1('SELECT id FROM log_entries WHERE id=?', [uaLine])).toBeTruthy();
  });

  test('nobody deletes a line from a sealed report', async () => {
    const sealed = (await db.query1('SELECT id FROM log_entries WHERE report_id=1 ORDER BY id LIMIT 1')).id;
    expect((await agents.admin.delete(`/api/log/${sealed}`)).status).toBe(403);
    expect((await agents.admin.delete(`/api/log/${normal}`)).status).toBe(200);
  });
});

describe('groups', () => {
  test('clinical.groups can add a group name, as the Groups tab offers', async () => {
    expect((await agents.clinician.put('/api/master-groups').send({ groups: ['Morning Group', 'Relapse Prevention'] })).status).toBe(200);
  });
});
