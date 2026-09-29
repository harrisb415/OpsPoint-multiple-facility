// Deleting takes a reason, and the audit log keeps who, when, why and what
// was removed: a log line, a mail record, a whole shift report (only in its
// first 24 hours, never the open shift). Incident reports and infractions are
// never deleted — they are voided with a reason and stay on file (incidents in
// the audit log only; they are clinical). incidents.delete / violations.delete
// became the void permissions for whoever held them. Runs on either driver.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_reasons_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW = 'Reasons!Passw0rd9';
const TODAY = new Date().toLocaleDateString('en-CA');
const agents = {};
let res;

async function makeUser(username, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,0)`,
    [username, `${username} name`, 'pa', hash, salt, JSON.stringify(perms)]);
  const agent = request.agent(app);
  expect((await agent.post('/api/login').send({ username, password: PW })).status).toBe(200);
  return agent;
}
const lastAudit = async (action) => {
  const row = await db.query1('SELECT * FROM audit_log WHERE action=? ORDER BY id DESC LIMIT 1', [action]);
  return row ? { ...row, detail: JSON.parse(row.detail || '{}') } : null;
};
const blankReport = (id, extra = {}) => ({ id, report_date: TODAY, shift: 'Day Shift', mod_name: 'Robin', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [], ...extra });

beforeAll(async () => {
  await ready;
  agents.admin = await makeUser('rs_admin', db.PERMISSIONS);
  agents.pa    = await makeUser('rs_pa', db.ROLE_PRESETS.pa);
  const c = await agents.admin.post('/api/clients').send({ name: 'Reason Resident', room: '601' });
  res = { id: c.body.id || (c.body.client && c.body.client.id), name: 'Reason Resident', room: '601' };
  expect((await agents.admin.post('/api/data').send({ reports: [blankReport(1)], active_report_id: 1 })).status).toBe(200);
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('permissions', () => {
  test('incidents.void and violations.void replace the delete permissions, for the same holders', async () => {
    expect(db.PERMISSIONS).toEqual(expect.arrayContaining(['incidents.void', 'violations.void']));
    expect(db.PERMISSIONS).not.toContain('incidents.delete');
    expect(db.PERMISSIONS).not.toContain('violations.delete');
    expect(db.ROLE_PRESETS.admin).toEqual(expect.arrayContaining(['incidents.void', 'violations.void']));
    expect(db.ROLE_PRESETS.supervisor).not.toContain('incidents.void');

    // A custom group and account from before the change keep the ability.
    await db.run('INSERT INTO groups (key,label,permissions,is_protected) VALUES (?,?,?,0)',
      ['rs_custom', 'Custom', JSON.stringify(['groups.view', 'incidents.delete', 'violations.delete'])]);
    await db.run('UPDATE users SET permissions=? WHERE username=?', [JSON.stringify(['groups.view', 'violations.delete']), 'rs_pa']);
    await db._renamePermissions();
    const g = JSON.parse((await db.query1('SELECT permissions FROM groups WHERE key=?', ['rs_custom'])).permissions);
    expect(g).toEqual(['groups.view', 'incidents.void', 'violations.void']);
    const u = JSON.parse((await db.query1('SELECT permissions FROM users WHERE username=?', ['rs_pa'])).permissions);
    expect(u).toEqual(['groups.view', 'violations.void']);
    await db.run('UPDATE users SET permissions=? WHERE username=?', [JSON.stringify(db.ROLE_PRESETS.pa), 'rs_pa']);
  });
});

describe('deleting a log line', () => {
  test('needs a reason; the audit log keeps what it said', async () => {
    const id = (await agents.admin.patch('/api/data').send({ reportId: 1, log_entry: { time: '9:05 AM', text: 'Written on the wrong report' } })).body.log_entry_id;
    expect((await agents.admin.delete(`/api/log/${id}`)).status).toBe(400);
    expect((await agents.admin.delete(`/api/log/${id}`).send({ reason: '   ' })).status).toBe(400);
    expect((await agents.admin.delete(`/api/log/${id}`).send({ reason: 'Belongs on the swing shift' })).status).toBe(200);
    const a = await lastAudit('log.delete');
    expect(a).toMatchObject({ actor_name: 'rs_admin name', target_id: String(id) });
    expect(a.detail).toMatchObject({ reason: 'Belongs on the swing shift', time: '9:05 AM', text: 'Written on the wrong report', report: `Day Shift ${TODAY}` });
  });
});

describe('deleting a mail record', () => {
  test('needs a reason; the audit log keeps the record', async () => {
    expect((await agents.admin.post('/api/mail').send({ clients: [{ client_id: res.id, mail_type: 'letter', notes: 'From county' }] })).status).toBe(200);
    const m = (await db.query1('SELECT id FROM mail_log WHERE client_id=? ORDER BY id DESC LIMIT 1', [res.id])).id;
    expect((await agents.admin.delete(`/api/mail/${m}`)).status).toBe(400);
    expect((await agents.admin.delete(`/api/mail/${m}`).send({ reason: 'Logged twice' })).status).toBe(200);
    const a = await lastAudit('mail.delete');
    expect(a.actor_name).toBe('rs_admin name');
    expect(a.detail).toMatchObject({ reason: 'Logged twice', resident: 'Reason Resident', room: '601', mail_type: 'letter', status: 'pending', notes: 'From county' });
  });
});

describe('deleting a shift report', () => {
  test('needs a reason; the audit log keeps what the report said', async () => {
    expect((await agents.admin.post('/api/data').send({ reports: [blankReport(2, { shift: 'Swing Shift' })] })).status).toBe(200);
    await db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)', [2, '3:10 PM', 'Started on the wrong shift']);
    expect((await agents.admin.delete('/api/reports/2')).status).toBe(400);
    expect((await agents.admin.delete('/api/reports/2').send({ reason: 'Duplicate of the day shift' })).status).toBe(200);
    expect(await db.query1('SELECT id FROM reports WHERE id=2')).toBeFalsy();
    const a = await lastAudit('report.delete');
    expect(a.actor_name).toBe('rs_admin name');
    expect(a.detail).toMatchObject({ reason: 'Duplicate of the day shift', shift: 'Swing Shift', report_date: TODAY, mod: 'Robin', line_count: 1, lines: ['3:10 PM Started on the wrong shift'] });
  });

  test('never the shift that is open now', async () => {
    expect((await agents.admin.delete('/api/reports/1').send({ reason: 'x' })).status).toBe(409);
  });

  test('only in the first 24 hours; after that it is permanent', async () => {
    expect((await agents.admin.post('/api/data').send({ reports: [blankReport(3, { is_closed: true, roster_snapshot: [] })] })).status).toBe(200);
    await db.run('UPDATE reports SET created_at=? WHERE id=3', [new Date(Date.now() - 25 * 3600000).toISOString()]);
    const r = await agents.admin.delete('/api/reports/3').send({ reason: 'Too late' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/24 hours/);
    // Old rows stamped by SQLite's datetime('now') (UTC, no zone) read right too.
    await db.run('UPDATE reports SET created_at=? WHERE id=3', [new Date(Date.now() - 2 * 3600000).toISOString().replace('T', ' ').slice(0, 19)]);
    expect((await agents.admin.delete('/api/reports/3').send({ reason: 'Still in time' })).status).toBe(200);
  });
});

describe('infractions are voided, never deleted', () => {
  let vid;
  beforeAll(async () => {
    const v = await agents.admin.post('/api/violations').send({ client_id: res.id, client_name: res.name, room: res.room, violation_date: TODAY, description: 'Out after curfew', staff_name: 'Sam' });
    vid = v.body.id;
  });

  test('violations.void and a reason; the record stays, marked void', async () => {
    expect((await agents.pa.post(`/api/violations/${vid}/void`).send({ reason: 'x' })).status).toBe(403);
    expect((await agents.admin.post(`/api/violations/${vid}/void`).send({})).status).toBe(400);
    expect((await agents.admin.post(`/api/violations/${vid}/void`).send({ reason: 'Wrong resident' })).status).toBe(200);
    const row = await db.query1('SELECT * FROM violations WHERE id=?', [vid]);
    expect(row).toMatchObject({ status: 'voided', voided_by_name: 'rs_admin name', void_reason: 'Wrong resident', description: 'Out after curfew' });
    expect(row.voided_at).toBeTruthy();
    expect((await agents.admin.post(`/api/violations/${vid}/void`).send({ reason: 'again' })).status).toBe(409);
    expect((await agents.admin.delete(`/api/violations/${vid}`)).status).toBe(404);   // the route is gone
    const a = await lastAudit('violation.void');
    expect(a.detail).toMatchObject({ reason: 'Wrong resident', description: 'Out after curfew', staff: 'Sam', status_before: 'pending' });
  });

  test('a voided infraction is out of the counts and the review queue', async () => {
    const pending = await db.query('SELECT id FROM violations WHERE status=?', ['pending']);
    expect(pending.map(p => p.id)).not.toContain(vid);
    expect((await agents.admin.put(`/api/violations/${vid}/review`).send({ action: 'waive' })).status).toBe(400);
  });
});

describe('incident reports are voided, never deleted', () => {
  let iid;
  beforeAll(async () => {
    const i = await agents.admin.post('/api/incidents').send({ client_id: res.id, incident_date: TODAY, narrative: 'Argument in the hallway', severity: 'low' });
    iid = i.body.record.id;
  });

  test('incidents.void and a reason; audit log only — nothing in the shift log', async () => {
    const lines = async () => (await db.query('SELECT id FROM log_entries')).length;
    const before = await lines();
    expect((await agents.pa.post(`/api/incidents/${iid}/void`).send({ reason: 'x' })).status).toBe(403);
    expect((await agents.admin.post(`/api/incidents/${iid}/void`).send({ reason: '' })).status).toBe(400);
    expect((await agents.admin.post(`/api/incidents/${iid}/void`).send({ reason: 'Filed for the wrong resident' })).status).toBe(200);
    const row = await db.query1('SELECT * FROM incidents WHERE id=?', [iid]);
    expect(row).toMatchObject({ status: 'voided', voided_by_name: 'rs_admin name', void_reason: 'Filed for the wrong resident', narrative: 'Argument in the hallway' });
    expect(await lines()).toBe(before);
    const a = await lastAudit('incident.void');
    expect(a.detail).toMatchObject({ reason: 'Filed for the wrong resident', severity: 'low', status_before: 'open' });
    expect((await agents.admin.delete(`/api/incidents/${iid}`)).status).toBe(404);   // the route is gone
  });

  test('a voided report is kept as it was: no edits, no review', async () => {
    expect((await agents.admin.put(`/api/incidents/${iid}`).send({ narrative: 'changed' })).status).toBe(409);
    expect((await agents.admin.put(`/api/incidents/${iid}/review`).send({ status: 'reviewed' })).status).toBe(409);
    expect((await agents.admin.post(`/api/incidents/${iid}/void`).send({ reason: 'again' })).status).toBe(409);
  });

  test('voiding works after the 24-hour edit lock too', async () => {
    const i = await agents.admin.post('/api/incidents').send({ client_id: res.id, incident_date: TODAY, narrative: 'Older one', severity: 'medium' });
    const id = i.body.record.id;
    await db.run('UPDATE incidents SET locked_at=? WHERE id=?', [new Date().toISOString(), id]);
    expect((await agents.admin.put(`/api/incidents/${id}`).send({ narrative: 'edit' })).status).toBe(403);   // locked
    expect((await agents.admin.post(`/api/incidents/${id}/void`).send({ reason: 'Duplicate report' })).status).toBe(200);
  });
});
