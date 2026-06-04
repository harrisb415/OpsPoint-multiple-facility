// Integration tests for the Structured Clinical Lite HTTP API.
// Points the server at an isolated temp DB (OPSPOINT_DB) and drives it with
// supertest. The server only binds a port / opens a browser when run directly,
// so requiring it here is side-effect-safe.
'use strict';
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');

// MUST be set before requiring the server (DB_PATH is read once at load).
const TMP_DB = path.join(os.tmpdir(), `opspoint_itest_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db } = require('../server');

const CLINICAL_PERMS = ['clinical.notes', 'clinical.treatment', 'clinical.assessments', 'clinical.groups', 'clinical.discharge'];
const PW = 'Passw0rd!';

function makeUser(username, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    [username, username, 'admin', hash, salt, JSON.stringify(perms)]
  );
}
function makeClient(name, room) {
  const info = db.run('INSERT INTO clients (room,name,is_active,is_special) VALUES (?,?,1,0)', [room, name]);
  return info.lastInsertRowid;
}
async function agentFor(username) {
  const agent = request.agent(app);
  const r = await agent.post('/api/login').send({ username, password: PW });
  expect(r.status).toBe(200);
  return agent;
}

let clinician, noPerms, attendance, clientId;

beforeAll(async () => {
  makeUser('clinician', CLINICAL_PERMS);
  makeUser('noperms', ['mobile.access']);          // authenticated but no clinical access
  makeUser('attendance', ['groups.log', 'groups.view']); // PA: attendance entry only
  clientId = makeClient('Test Resident', '201');
  clinician  = await agentFor('clinician');
  noPerms    = await agentFor('noperms');
  attendance = await agentFor('attendance');
});

afterAll(() => {
  try { db.run('DELETE FROM clinical_notes'); } catch (e) { /* ignore */ }
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

// ── Auth / permission gating ───────────────────────────────────────────────
describe('auth + permission gating', () => {
  test('401 without a session', async () => {
    const r = await request(app).get('/api/clinical/notes');
    expect(r.status).toBe(401);
  });
  test('403 when authenticated without the permission', async () => {
    const r = await noPerms.get('/api/clinical/notes');
    expect(r.status).toBe(403);
  });
  test('200 with the permission', async () => {
    const r = await clinician.get('/api/clinical/notes');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

// ── CRUD across all five modules ────────────────────────────────────────────
const MODULES = [
  { seg: 'notes',               extra: { note_type: 'progress', content: 'hello' } },
  { seg: 'treatment-plans',     extra: { plan_date: '2026-06-02', goals: [{ goal: 'G', objectives: ['o'], interventions: ['i'] }] }, json: 'goals' },
  { seg: 'assessments',         extra: { assessment_type: 'risk', content: { 'Suicide Risk': { Ideation: 'denied' } } }, json: 'content' },
  { seg: 'discharge-summaries', extra: { discharge_date: '2026-06-02', discharge_type: 'planned' } },
];

describe.each(MODULES)('CRUD: $seg', ({ seg, extra, json }) => {
  test('create → get → update → sign → list', async () => {
    const base = `/api/clinical/${seg}`;
    const create = await clinician.post(base).send({ client_id: clientId, ...extra });
    expect(create.status).toBe(200);
    expect(create.body.ok).toBe(true);
    const id = create.body.record.id;

    // JSON fields come back parsed (objects/arrays), never strings
    if (json) expect(typeof create.body.record[json]).not.toBe('string');

    const single = await clinician.get(`${base}/${id}`);
    expect(single.status).toBe(200);
    if (json) expect(typeof single.body[json]).not.toBe('string');

    const upd = await clinician.put(`${base}/${id}`).send({ ...extra });
    expect(upd.status).toBe(200);

    const signed = await clinician.patch(`${base}/${id}/sign`).send({});
    expect(signed.status).toBe(200);

    const list = await clinician.get(`${base}?clientId=${clientId}`);
    expect(list.status).toBe(200);
    expect(list.body.some(r => r.id === id)).toBe(true);
  });

  test('400 when a required field is missing', async () => {
    const r = await clinician.post(`/api/clinical/${seg}`).send({ ...extra }); // no client_id
    expect(r.status).toBe(400);
  });
});

// ── Group notes (attendees embedded) ────────────────────────────────────────
describe('CRUD: group-notes', () => {
  test('create with attendees → embedded array → 400 without group_name', async () => {
    const create = await clinician.post('/api/clinical/group-notes').send({
      group_name: 'Morning Group', session_date: '2026-06-02', topic: 'Coping',
      attendees: [{ client_id: clientId, participation: 'present', individual_note: 'engaged' }],
    });
    expect(create.status).toBe(200);
    expect(Array.isArray(create.body.record.attendees)).toBe(true);
    expect(create.body.record.attendees).toHaveLength(1);

    const missing = await clinician.post('/api/clinical/group-notes').send({ session_date: '2026-06-02' });
    expect(missing.status).toBe(400);
  });
});

// ── Group notes: attendance-role (groups.log) vs clinician (clinical.groups) ──
describe('group-notes two-role workflow', () => {
  test('attendance user can log attendance but cannot write the note or sign', async () => {
    // PA logs attendance, and even if a content field is sent it must be stripped
    const create = await attendance.post('/api/clinical/group-notes').send({
      group_name: 'Process Group', session_date: '2026-06-02',
      content: 'PA should NOT be able to set this',
      attendees: [{ client_id: clientId, participation: 'present' }],
    });
    expect(create.status).toBe(200);
    const id = create.body.record.id;
    expect(create.body.record.content || '').toBe('');        // content stripped
    expect(create.body.record.attendees).toHaveLength(1);

    // PA cannot finalise (needs clinical.groups)
    const sign = await attendance.patch(`/api/clinical/group-notes/${id}/sign`).send({});
    expect(sign.status).toBe(403);

    // Clinician finishes the same record: adds the note + signs
    const note = await clinician.put(`/api/clinical/group-notes/${id}`).send({ content: 'Clinical note added' });
    expect(note.status).toBe(200);
    expect(note.body.record.content).toBe('Clinical note added');
    const signed = await clinician.patch(`/api/clinical/group-notes/${id}/sign`).send({});
    expect(signed.status).toBe(200);
    expect(signed.body.record.status).toBe('final');

    // Once final, the PA can no longer edit it
    const blocked = await attendance.put(`/api/clinical/group-notes/${id}`).send({ topic: 'x' });
    expect(blocked.status).toBe(400);
  });
});

// ── Draft lock (notes + discharge) ──────────────────────────────────────────
describe('draft lock on finalised records', () => {
  test.each(['notes', 'discharge-summaries'])('%s: PUT and DELETE return 400 once final', async (seg) => {
    const extra = seg === 'notes'
      ? { note_type: 'progress', content: 'x' }
      : { discharge_date: '2026-06-02', discharge_type: 'planned' };
    const base = `/api/clinical/${seg}`;
    const create = await clinician.post(base).send({ client_id: clientId, ...extra });
    const id = create.body.record.id;
    await clinician.patch(`${base}/${id}/sign`).send({});       // → final
    const put = await clinician.put(`${base}/${id}`).send({ ...extra });
    expect(put.status).toBe(400);
    const del = await clinician.delete(`${base}/${id}`);
    expect(del.status).toBe(400);
  });
});

// ── 404 for unknown ids ─────────────────────────────────────────────────────
describe('not found', () => {
  test('GET unknown id → 404', async () => {
    const r = await clinician.get('/api/clinical/notes/99999');
    expect(r.status).toBe(404);
  });
});
