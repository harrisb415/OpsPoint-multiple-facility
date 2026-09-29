// API tour — every facility module's real flows, end to end, on whichever
// driver the process is configured for.
//
// The rest of the suite runs on SQLite, which is exactly why Postgres-only
// failures kept reaching production: '' written to a date column, a value a
// CHECK constraint refuses, a column one schema has and the other doesn't.
// Reads are the easy part; these bugs live in WRITES. So this drives the API
// the way the screens do — create, edit (with optional fields left blank, as
// forms send them), change status, sign, delete — as a fully privileged user.
//
// It does not stop at the first failure. Each module collects every call that
// came back 5xx (or with a status it should never return) and asserts the list
// is empty, so one run lists everything broken.
//
// To run it against Postgres, point OPSPOINT_DB_DRIVER=pg / DATABASE_URL at a
// scratch database holding migrations/pg/001,003,004,005 (see the pg audit
// runner). Everything it writes stays in the temp database it creates.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_tour_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW    = 'Tour!Passw0rd9';
const TODAY = new Date().toLocaleDateString('en-CA');
const LATER = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA');
const PNG   = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let agent;
const ctx = {};
let problems = [];

// One request. Anything 5xx is a problem; so is a status outside `ok` when
// the caller says which statuses are acceptable.
async function call(method, url, body, ok) {
  let r;
  try { r = await agent[method](url).send(body); }
  catch (e) { problems.push(`${method.toUpperCase()} ${url} -> threw ${e.message}`); return { status: 0, body: {} }; }
  const bad = r.status >= 500 || (ok && !ok.includes(r.status));
  if (bad) problems.push(`${method.toUpperCase()} ${url} -> ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  return r;
}
const get  = (u, ok)    => call('get', u, undefined, ok);
const post = (u, b, ok) => call('post', u, b, ok);
const put  = (u, b, ok) => call('put', u, b, ok);
const patch = (u, b, ok) => call('patch', u, b, ok);
const del  = (u, ok)    => call('delete', u, undefined, ok);
const drain = () => { const p = problems; problems = []; return p; };
const idOf = (r, ...keys) => { for (const k of keys) { const v = k.split('.').reduce((o, p) => o && o[p], r.body); if (v != null) return v; } return undefined; };

beforeAll(async () => {
  await ready;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    ['touradmin', 'Tour Admin', 'admin', hash, salt, JSON.stringify(db.PERMISSIONS)]);
  agent = request.agent(app);
  const r = await agent.post('/api/login').send({ username: 'touradmin', password: PW });
  expect(r.status).toBe(200);
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('API tour', () => {
  test('facility settings and rooms', async () => {
    await get('/api/facility/settings');
    await put('/api/facility/settings', {
      facility_name: 'Tour House', wellness_interval_mins: 90, walk_interval_mins: 180,
      walk_areas: ['Kitchen', 'Yard'], ua_panel: ['THC', 'COC'],
      shift_day_start: '07:00', shift_swing_start: '15:00', shift_grave_start: '23:00',
      ui_visibility: { tabs: {}, buttons: {} },
    }, [200]);
    await get('/api/facility/ehr-config');
    await put('/api/facility/ehr-config', { program_tracks: ['Tour Track'] });
    const vacant = await post('/api/facility/rooms', { room: '201' }, [200]);
    ctx.vacantRoomId = idOf(vacant, 'client.id');
    const named = await post('/api/facility/rooms', { room: '202', name: 'Room Resident' }, [200]);
    ctx.roomResidentId = idOf(named, 'client.id');
    await put(`/api/facility/rooms/${ctx.vacantRoomId}`, { room: '201A', special_label: '' }, [200]);
    await get('/api/facility/rooms', [200]);
    await get('/api/facility/rooms/vacant', [200]);
    await post('/api/facility/reorder', { order: [ctx.roomResidentId, ctx.vacantRoomId] }, [200]);
    expect(drain()).toEqual([]);
  });

  test('clients — intake and edits with blank optional fields', async () => {
    const c = await post('/api/clients', {
      name: 'Pat Tour', room: '203', intake_date: '', case_manager: '', phone: '',
      program_track: '', referral_source: '', emergency_contacts: [], intake_notes: '',
    }, [200]);
    ctx.clientId = idOf(c, 'id', 'client.id');
    const c2 = await post('/api/clients', { name: 'Sam Tour', room: '204', intake_date: TODAY }, [200]);
    ctx.client2Id = idOf(c2, 'id', 'client.id');
    expect(ctx.clientId).toBeTruthy();
    await put(`/api/clients/${ctx.clientId}`, { phone: '555-0100', intake_date: '', discharge_date: '' }, [200]);
    await put(`/api/clients/${ctx.clientId}`, { intake_date: TODAY, case_manager: 'Case M' }, [200]);
    await get(`/api/clients/${ctx.clientId}/profile`, [200]);
    await call('patch', `/api/clients/${ctx.clientId}/chore`, { chore: 'Dishes', chore_time: 'AM', chore_days: [1, 3], chore_day_shifts: { 1: 'AM' } }, [200]);
    expect(drain()).toEqual([]);
  });

  // POST /api/data used to take a resident list and delete everyone missing
  // from it. It must refuse the list — even from this all-permissions user —
  // and leave the roster exactly as it was.
  test('POST /api/data refuses a resident list and deletes nobody', async () => {
    const roster = async () => ((await get('/api/data', [200])).body.clients || []).map(c => c.id).sort((a, b) => a - b);
    const before = await roster();
    expect(before).toEqual(expect.arrayContaining([ctx.clientId, ctx.client2Id]));
    await post('/api/data', { clients: [{ id: ctx.clientId, room: '203', name: 'Pat Tour' }] }, [400]);
    expect(await roster()).toEqual(before);
    expect(drain()).toEqual([]);
  });

  test('shift report — create, patch, log photo, delete a log entry', async () => {
    const report = {
      id: 1, report_date: TODAY, shift: 'Day Shift', mod_name: 'Tour', is_closed: false,
      statuses: {}, comments: {}, last_ua: {}, last_room_search: {},
      issues: ['Tour issue'], med_notes: [], log_entries: [{ time: '9:00 AM', text: 'Tour start' }],
    };
    await post('/api/data', { reports: [report], active_report_id: 1 }, [200]);
    await patch('/api/data', {
      reportId: 1, statuses: { [ctx.clientId]: 'out' }, log_entry: { time: '9:05 AM', text: 'Patched entry' },
      shiftData: { report_date: TODAY, shift: 'Day Shift', mod_name: 'Tour Two' },
      issues: ['a'], med_notes: ['m'], last_ua: { [ctx.clientId]: 'Sep 27, 2026' }, last_room_search: { [ctx.clientId]: 'Sep 27' },
    }, [200]);
    await patch('/api/data', { reportId: 1, shiftData: { report_date: '', mod_name: 'Blank date' } }, [200, 400]);
    // The cup photo goes on a UA line; ordinary lines can be deleted, UA lines never.
    await patch('/api/data', { reportId: 1, log_entry: { time: '9:06 AM', text: 'Pat Tour (Rm. 203) — UA: All NEG — by Tour [Random, Observed]' } }, [200]);
    const data = await get('/api/data', [200]);
    const rpt = (data.body.reports || []).find(r => r.id === 1);
    expect(rpt).toBeTruthy();
    const entries = rpt ? rpt.log_entries : [];
    const photoTarget = entries.find(e => /— UA:/.test(e.text));
    if (photoTarget) {
      await post(`/api/log/${photoTarget.id}/photo`, { photo: PNG }, [200]);
      await get(`/api/log/${photoTarget.id}/photo`, [200]);
      await del(`/api/log/${photoTarget.id}`, [403]);
    }
    const plain = entries.find(e => !/— UA:/.test(e.text));
    if (plain) await del(`/api/log/${plain.id}`, [200]);
    expect(drain()).toEqual([]);
  });

  test('staff directory and categories', async () => {
    const s = await post('/api/staff', { name: 'Staff Tour', category: 'Other', phone: '', phone2: '', notes: '' }, [200]);
    const sid = idOf(s, 'id', 'staff.id');
    await get('/api/staff', [200]);
    if (sid) await put(`/api/staff/${sid}`, { phone: '555-0101', notes: 'n' }, [200]);
    await get('/api/staff/categories', [200]);
    await put('/api/staff/categories', { categories: ['Director', 'Other'] }, [200]);
    if (sid) await del(`/api/staff/${sid}`, [200]);
    expect(drain()).toEqual([]);
  });

  test('chores — master list and log', async () => {
    await get('/api/master-chores', [200]);
    await put('/api/master-chores', { chores: ['Dishes', 'Trash'] }, [200]);
    await put('/api/chore-log', { client_id: ctx.clientId, log_date: TODAY, initials: 'PT' }, [200]);
    await put('/api/chore-log', { client_id: ctx.clientId, log_date: TODAY, initials: 'PX' }, [200]);
    await get(`/api/chore-log?date=${TODAY}`, [200]);
    await get(`/api/chore-log?from=${TODAY}&to=${LATER}`, [200]);
    expect(drain()).toEqual([]);
  });

  test('passes — blank times, lifecycle, extension, notice', async () => {
    const p = await post('/api/passes', { client_id: ctx.clientId, name: 'Pat Tour', room: '203', departure: '', return_date: '', status: 'Approved' }, [200]);
    const pid = idOf(p, 'pass.id', 'id');
    const p2 = await post('/api/passes', {
      client_id: ctx.client2Id, name: 'Sam Tour', room: '204',
      departure: new Date().toISOString(), return_date: new Date(Date.now() + 86400000).toISOString(), status: 'Out',
    }, [200]);
    const pid2 = idOf(p2, 'pass.id', 'id');
    if (pid) {
      await put(`/api/passes/${pid}`, { status: 'Out' }, [200]);
      await put(`/api/passes/${pid}`, { status: 'Extended', return_date: new Date(Date.now() + 2 * 86400000).toISOString(), tz: 'America/Los_Angeles' }, [200]);
      await put(`/api/passes/${pid}`, { notes: 'note', ua_notes: '', departure: new Date().toISOString() }, [200]);
      await put(`/api/passes/${pid}`, { status: 'Returned' }, [200]);
    }
    await get('/api/passes', [200]);
    await get('/api/pass-notice', [200]);
    await put('/api/pass-notice', { notice: 'Tour notice' }, [200]);
    if (pid2) await del(`/api/passes/${pid2}`, [200]);
    expect(drain()).toEqual([]);
  });

  test('UA — requests, draws, records', async () => {
    const r1 = await post('/api/ua-requests', { client_id: ctx.clientId, client_name: 'Pat Tour', room: '203' }, [200]);
    const rid = idOf(r1, 'request.id', 'id');
    const r2 = await post('/api/ua-requests', { is_interview: true, interview_name: 'Walk-in' }, [200]);
    const rid2 = idOf(r2, 'request.id', 'id');
    await get('/api/ua-requests', [200]);
    if (rid) await post(`/api/ua-requests/${rid}/acknowledge`, {}, [200]);
    if (rid2) await del(`/api/ua-requests/${rid2}`, [200]);
    await post('/api/ua-draws', { residents: [{ id: ctx.clientId, name: 'Pat Tour', room: '203' }] }, [200]);
    await get(`/api/ua-draws?since=${TODAY}`, [200]);
    await get('/api/ua-draws/recent-clients?days=30', [200]);
    await get('/api/ua-log', [200]);
    const rec = await post('/api/ua-records', {
      client_id: ctx.clientId, client_name: 'Pat Tour', room: '203', tested_at: new Date().toISOString(),
      collection_method: 'observed', reason: 'random', result: 'pass', panel_results: { THC: 'neg' },
      witnessed_by_name: 'Tour', notes: '', chain_of_custody: '',
    }, [200]);
    const uid = idOf(rec, 'record.id', 'id');
    await post('/api/ua-records', { is_interview: true, client_id: 0, client_name: 'Walk-in', tested_at: new Date().toISOString(), result: 'fail', panel_results: { COC: 'pos' } }, [200]);
    await get('/api/ua-records', [200]);
    if (uid) {
      await get(`/api/ua-records/${uid}`, [200]);
      await patch(`/api/ua-records/${uid}`, { result: 'fail', notes: 'edited', panel_results: { THC: 'pos' } }, [200]);
      await post(`/api/ua-records/${uid}/void`, { reason: 'tour' }, [200]);   // never deleted
    }
    expect(drain()).toEqual([]);
  });

  test('mail — log, approve, deliver, delete', async () => {
    await post('/api/mail', { clients: [{ client_id: ctx.clientId, notes: '', mail_type: 'letter' }], log_time: '9:10 AM' }, [200]);
    await post('/api/mail', { client_id: ctx.client2Id, client_name: 'Sam Tour', room: '204', notes: 'pkg' }, [200]);
    const list = await get('/api/mail', [200]);
    const rows = Array.isArray(list.body) ? list.body : [];
    if (rows[0]) {
      await put(`/api/mail/${rows[0].id}/approve`, {}, [200]);
      await put(`/api/mail/${rows[0].id}/deliver`, {}, [200]);
    }
    if (rows[1]) await del(`/api/mail/${rows[1].id}`, [200]);
    expect(drain()).toEqual([]);
  });

  test('violations — log (blank date), assign, complete, waive, delete', async () => {
    const v1 = await post('/api/violations', { client_id: ctx.clientId, client_name: 'Pat Tour', room: '203', violation_date: '', description: 'Late', staff_name: 'Sam Staff', notes: '' }, [200]);
    const vid = idOf(v1, 'id', 'violation.id');
    // The staff name is typed in and required; the account that saved it stays in logged_by.
    await post('/api/violations', { client_id: ctx.clientId, client_name: 'Pat Tour', room: '203', violation_date: TODAY, description: 'No staff named' }, [400]);
    await post('/api/violations', { client_id: ctx.clientId, client_name: 'Pat Tour', room: '203', violation_date: TODAY, description: 'Blank staff', staff_name: '   ' }, [400]);
    if (vid) {
      const row = await db.query1('SELECT staff_name, logged_by FROM violations WHERE id=?', [vid]);
      expect(row.staff_name).toBe('Sam Staff');
      expect(row.logged_by).toBeTruthy();
    }
    const v2 = await post('/api/violations', { client_id: ctx.clientId, client_name: 'Pat Tour', room: '203', violation_date: TODAY, description: 'Noise', staff_name: 'Sam Staff' }, [200]);
    const vid2 = idOf(v2, 'id', 'violation.id');
    await get('/api/violations', [200]);
    if (vid) {
      await put(`/api/violations/${vid}/review`, { action: 'assign', consequence: 'Extra chore' }, [200]);
      await put(`/api/violations/${vid}/complete`, {}, [200]);
    }
    if (vid2) {
      await put(`/api/violations/${vid2}/review`, { action: 'waive' }, [200]);
      await del(`/api/violations/${vid2}`, [200]);
    }
    expect(drain()).toEqual([]);
  });

  test('incidents — create, edit, review, delete', async () => {
    const i = await post('/api/incidents', {
      client_id: ctx.clientId, incident_date: TODAY, incident_time: '', narrative: 'Tour incident',
      severity: 'low', incident_type: 'Behavior', corrective_action: '', notifications_required: [],
    }, [200]);
    const iid = idOf(i, 'record.id', 'id');
    await get('/api/incidents', [200]);
    if (iid) {
      await put(`/api/incidents/${iid}`, { narrative: 'edited', incident_time: '10:00', corrective_action: '' }, [200]);
      await put(`/api/incidents/${iid}/review`, { status: 'reviewed', review_notes: 'ok' }, [200]);
      await del(`/api/incidents/${iid}`, [200, 403]);
    }
    expect(drain()).toEqual([]);
  });

  test('milestones — blank dates on create and edit, sign-off, delete', async () => {
    const m = await post('/api/milestones', { client_id: ctx.clientId, phase: 'phase1', objective: 'Tour objective', target_date: '', notes: '' }, [200]);
    const mid = idOf(m, 'record.id', 'id');
    await get('/api/milestones', [200]);
    if (mid) {
      await put(`/api/milestones/${mid}`, { target_date: '', completion_date: '', status: 'in_progress', notes: 'n' }, [200]);
      await put(`/api/milestones/${mid}`, { target_date: LATER }, [200]);
      await put(`/api/milestones/${mid}/signoff`, {}, [200]);
    }
    const m2 = await post('/api/milestones', { client_id: ctx.clientId, objective: 'Second' }, [200]);
    const mid2 = idOf(m2, 'record.id', 'id');
    if (mid2) await del(`/api/milestones/${mid2}`, [200, 403]);
    expect(drain()).toEqual([]);
  });

  test('consent and disclosures (42 CFR Part 2)', async () => {
    const c = await post('/api/consent-records', {
      client_id: ctx.clientId, recipient_name: 'Dr Tour', recipient_org: '', purpose: 'Care coordination',
      information_type: 'all', effective_date: TODAY, expiration_date: '', signature_on_file: true,
    }, [200]);
    const cid = idOf(c, 'record.id', 'id');
    await get(`/api/consent-records/${ctx.clientId}`, [200]);
    await post('/api/disclosures', { client_id: ctx.clientId, recipient: 'Dr Tour', information_type: 'all', method: 'fax', notes: '' }, [200]);
    await get(`/api/disclosures/${ctx.clientId}`, [200]);
    if (cid) await put(`/api/consent-records/${cid}/revoke`, {}, [200]);
    expect(drain()).toEqual([]);
  });

  test('groups — master list and sessions with attendance', async () => {
    await get('/api/master-groups', [200]);
    await put('/api/master-groups', { groups: ['Tour Group'] }, [200]);
    const s = await post('/api/group-sessions', {
      session_date: TODAY, group_name: 'Tour Group', time_of_day: 'AM', facilitator: '', notes: '',
      attendance: [{ client_id: ctx.clientId, client_name: 'Pat Tour', room: '203', present: true, notes: '' }],
    }, [200]);
    const sid = idOf(s, 'session.id', 'id');
    await get(`/api/group-sessions?date=${TODAY}`, [200]);
    await get(`/api/group-sessions?from=${TODAY}&to=${LATER}`, [200]);
    if (sid) await del(`/api/group-sessions/${sid}`, [200]);
    expect(drain()).toEqual([]);
  });

  test('clinical records — blank optional dates and scores, sign, delete', async () => {
    const flows = [
      ['notes', { client_id: ctx.clientId, note_type: 'progress', note_date: TODAY, content: 'Tour note' }, { content: 'edited' }],
      ['treatment-plans', { client_id: ctx.clientId, plan_date: TODAY, target_date: '', review_date: '', presenting_problem: 'x', goals: [{ text: 'goal' }], strengths: '', barriers: '', status: 'active' },
        { target_date: '', review_date: '', status: 'active' }],
      ['assessments', { client_id: ctx.clientId, assessment_type: 'risk', assessment_date: TODAY, content: { q: 'a' }, score: '', score_label: '' },
        { score: '', score_label: '' }],
      ['discharge-summaries', { client_id: ctx.clientId, discharge_date: TODAY, admission_date: '', discharge_type: 'planned', discharge_to: '', presenting_problem: '', treatment_summary: '', progress_toward_goals: '', aftercare_plan: '', follow_up_date: '' },
        { follow_up_date: '', admission_date: '' }],
    ];
    for (const [seg, create, edit] of flows) {
      await get(`/api/clinical/${seg}`, [200]);
      const r = await post(`/api/clinical/${seg}`, create, [200]);
      const id = idOf(r, 'record.id', 'id');
      if (!id) continue;
      await get(`/api/clinical/${seg}/${id}`, [200]);
      await put(`/api/clinical/${seg}/${id}`, edit, [200]);
      await patch(`/api/clinical/${seg}/${id}/sign`, {}, [200]);
      const d = await post(`/api/clinical/${seg}`, create, [200]);
      const did = idOf(d, 'record.id', 'id');
      if (did) await del(`/api/clinical/${seg}/${did}`, [200]);
    }
    const g = await post('/api/clinical/group-notes', {
      group_name: 'Tour GN', session_date: TODAY, topic: 'Topic', content: 'Content',
      attendees: [{ client_id: ctx.clientId, participation: 'present', note: '' }],
    }, [200]);
    const gid = idOf(g, 'record.id', 'id');
    await get('/api/clinical/group-notes', [200]);
    if (gid) {
      await get(`/api/clinical/group-notes/${gid}`, [200]);
      await put(`/api/clinical/group-notes/${gid}`, { topic: 'Edited', attendees: [{ client_id: ctx.clientId, participation: 'excused' }] }, [200]);
      await patch(`/api/clinical/group-notes/${gid}/sign`, {}, [200]);
      await post(`/api/clinical_notes/${gid}/unlock`, { reason: 'tour' }, [400, 404]);
    }
    expect(drain()).toEqual([]);
  });

  test('discharge record — discharges a resident', async () => {
    await post('/api/discharge-records', { client_id: ctx.client2Id, discharge_date: TODAY, reason: 'graduate', narrative: '', aftercare_plan: '', referrals_made: [] }, [200]);
    await get('/api/discharge-records', [200]);
    await get(`/api/discharge-records/${ctx.client2Id}`, [200]);
    expect(drain()).toEqual([]);
  });

  test('broadcasts, users, groups, profiles, audit', async () => {
    await post('/api/broadcasts', { message: 'Tour broadcast' }, [200]);
    await get('/api/broadcasts?hours=24', [200]);
    const g = await post('/api/groups', { key: 'tour_grp', label: 'Tour Group', permissions: ['log.add'] }, [200]);
    const gid = idOf(g, 'group.id', 'id');
    await get('/api/groups', [200]);
    const u = await post('/api/users', { username: 'touruser', displayName: 'Tour User', password: 'Tour!Passw0rd8', role: 'pa', groupIds: gid ? [gid] : [] }, [200]);
    const uid = idOf(u, 'id', 'user.id');
    await get('/api/users', [200]);
    if (uid) {
      await put(`/api/users/${uid}`, { displayName: 'Tour User Two' }, [200]);
      await put(`/api/users/${uid}/protect`, {}, [200]);
      await put(`/api/users/${uid}/protect`, {}, [200]);
      await put(`/api/users/${uid}/groups`, { groupIds: [] }, [200]);
      await del(`/api/users/${uid}`, [200]);
    }
    if (gid) {
      await put(`/api/groups/${gid}`, { label: 'Tour Group 2', permissions: ['log.add', 'log.delete'] }, [200]);
      await del(`/api/groups/${gid}`, [200]);
    }
    const prof = await get('/api/permission-profiles', [200]);
    if (Array.isArray(prof.body)) await put('/api/permission-profiles', prof.body, [200]);
    await get('/api/audit-log', [200]);
    await get('/api/audit-log?search=tour&limit=20', [200]);
    await get('/api/heartbeat', [200]);
    await get('/api/health', [200]);
    await get('/api/central/status', [200]);
    await get('/api/update/status', [200]);
    expect(drain()).toEqual([]);
  });

  test('close the shift, start and delete another, reset the roster', async () => {
    const data = await get('/api/data', [200]);
    const rpt = (data.body.reports || []).find(r => r.id === 1);
    if (rpt) await post('/api/data', { reports: [{ ...rpt, is_closed: true, roster_snapshot: data.body.clients }], active_report_id: null }, [200]);
    await post('/api/data', { reports: [{ report_date: TODAY, shift: 'Swing Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] }] }, [200]);
    const after = await get('/api/data', [200]);
    const extra = (after.body.reports || []).find(r => r.id !== 1);
    if (extra) await del(`/api/reports/${extra.id}`, [200]);
    if (ctx.vacantRoomId) await del(`/api/facility/rooms/${ctx.vacantRoomId}`, [200, 400]);
    await post('/api/facility/reset', { rooms: [{ room: '301' }, { room: '302', name: 'VACANT' }] }, [200, 409]);   // 409: residents have records on file
    expect(drain()).toEqual([]);
  });
});
