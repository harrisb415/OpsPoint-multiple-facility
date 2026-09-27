// Integration tests for pass extensions: the stamp that drives the
// "pass extended" notification, the note's timezone, and how the new
// passes.notify_extended permission reaches every group on upgrade.
// Same harness as facility.theme: isolated temp DB via OPSPOINT_DB.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// MUST be set before requiring the server (DB_PATH is read once at load).
const TMP_DB = path.join(os.tmpdir(), `opspoint_passext_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW   = 'Passw0rd!';
const PERM = 'passes.notify_extended';

async function makeUser(username, display, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    [username, display, 'pa', hash, salt, JSON.stringify(perms)]
  );
  return (await db.query1('SELECT id FROM users WHERE username=?', [username])).id;
}
async function agentFor(username) {
  const agent = request.agent(app);
  const r = await agent.post('/api/login').send({ username, password: PW });
  expect(r.status).toBe(200);
  return agent;
}
async function makePass(returnDate) {
  await db.run('INSERT INTO clients (room, name) VALUES (?, ?)', ['111', 'Jerome B.']);
  const client = await db.query1('SELECT id FROM clients ORDER BY id DESC LIMIT 1');
  await db.run(
    'INSERT INTO passes (client_id, room, name, departure, return_date, status) VALUES (?,?,?,?,?,?)',
    [client.id, '111', 'Jerome B.', '2026-09-26T21:22:00.000Z', returnDate, 'Out']);
  return (await db.query1('SELECT id FROM passes ORDER BY id DESC LIMIT 1')).id;
}
const getPass = id => db.query1('SELECT * FROM passes WHERE id=?', [id]);

let floor;   // passes.status only — extending is a status-level action

beforeAll(async () => {
  await ready;
  await makeUser('floorpa', 'Floor PA', ['passes.status']);
  floor = await agentFor('floorpa');
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('pass extension', () => {
  test('stamps when, who and the return it replaced', async () => {
    const id = await makePass('2026-09-28T23:22:00.000Z');
    const before = Date.now();
    const r = await floor.put(`/api/passes/${id}`).send({
      status: 'Extended', return_date: '2026-09-29T06:22:00.000Z', tz: 'America/Los_Angeles',
    });
    expect(r.status).toBe(200);

    const p = await getPass(id);
    expect(p.status).toBe('Extended');
    expect(p.return_date).toBe('2026-09-29T06:22:00.000Z');
    expect(p.extended_by).toBe('Floor PA');
    expect(p.extended_from).toBe('2026-09-28T23:22:00.000Z');
    const at = new Date(p.extended_at).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  // The server runs in UTC when hosted. The note used to be formatted in the
  // server's zone, so it disagreed with the Passes table by the UTC offset.
  test("writes the note in the browser's zone, not the server's", async () => {
    const id = await makePass('2026-09-28T23:22:00.000Z');         // 4:22 PM PDT
    await floor.put(`/api/passes/${id}`).send({
      status: 'Extended', return_date: '2026-09-29T06:22:00.000Z', tz: 'America/Los_Angeles',
    });
    const { notes } = await getPass(id);
    expect(notes).toMatch(/by Floor PA: return Sep 28, 4:22 PM -> Sep 28, 11:22 PM\]$/);
  });

  test('a second extension moves the stamp on', async () => {
    const id = await makePass('2026-09-28T23:22:00.000Z');
    await floor.put(`/api/passes/${id}`).send({ status: 'Extended', return_date: '2026-09-29T06:22:00.000Z' });
    const first = await getPass(id);
    await new Promise(r => setTimeout(r, 5));
    await floor.put(`/api/passes/${id}`).send({ status: 'Extended', return_date: '2026-09-30T06:22:00.000Z' });
    const second = await getPass(id);
    expect(second.extended_from).toBe('2026-09-29T06:22:00.000Z');
    expect(second.extended_at).not.toBe(first.extended_at);   // a fresh notice, not the dismissed one
    expect(second.notes.split('\n')).toHaveLength(2);
  });

  test('an unknown timezone is ignored rather than failing the extension', async () => {
    const id = await makePass('2026-09-28T23:22:00.000Z');
    const r = await floor.put(`/api/passes/${id}`).send({
      status: 'Extended', return_date: '2026-09-29T06:22:00.000Z', tz: 'Mars/Olympus_Mons',
    });
    expect(r.status).toBe(200);
    expect((await getPass(id)).extended_at).toBeTruthy();
  });

  test('an unreadable new return date is refused', async () => {
    const id = await makePass('2026-09-28T23:22:00.000Z');
    const r = await floor.put(`/api/passes/${id}`).send({ status: 'Extended', return_date: 'next tuesday-ish' });
    expect(r.status).toBe(400);
    expect((await getPass(id)).extended_at).toBeFalsy();
  });

  test('other status changes leave no extension stamp', async () => {
    const id = await makePass('2026-09-28T23:22:00.000Z');
    expect((await floor.put(`/api/passes/${id}`).send({ status: 'Returned' })).status).toBe(200);
    const p = await getPass(id);
    expect(p.status).toBe('Returned');
    expect(p.extended_at).toBeFalsy();
  });
});

describe('passes.notify_extended permission', () => {
  test('is a known permission that every role preset starts with', () => {
    expect(db.PERMISSIONS).toContain(PERM);
    for (const [role, perms] of Object.entries(db.ROLE_PRESETS)) {
      expect({ role, has: perms.includes(PERM) }).toEqual({ role, has: true });
    }
  });

  test('a new install seeds it into every built-in group', async () => {
    for (const g of await db.getGroups()) expect(g.permissions).toContain(PERM);
  });

  // An install that predates the permission: the next boot must hand it to
  // every group — a custom one included, which the preset rule alone skips —
  // and to their members; and once known, it is never forced back.
  test('an upgrade grants it to every group and member, once', async () => {
    const known = (await db.getSetting('known_permissions')).filter(p => p !== PERM);
    await db.setSetting('known_permissions', known);
    for (const g of await db.getGroups()) {
      await db.updateGroup(g.id, g.label, g.permissions.filter(p => p !== PERM));
    }
    const custom = await db.createGroup('nightcrew', 'Night Crew', ['passes.status']);
    const uid = await makeUser('nightpa', 'Night PA', []);
    await db.setUserGroups(uid, [custom.id]);
    expect(await db.getUserEffectivePermissions(uid)).not.toContain(PERM);

    await db.init(TMP_DB);                                   // the next boot

    for (const g of await db.getGroups()) expect({ g: g.key, has: g.permissions.includes(PERM) }).toEqual({ g: g.key, has: true });
    expect(await db.getUserEffectivePermissions(uid)).toContain(PERM);
    const row = await db.query1('SELECT permissions FROM users WHERE id=?', [uid]);
    expect(JSON.parse(row.permissions)).toContain(PERM);

    // An admin takes it away again; later boots respect that.
    const g2 = (await db.getGroups()).find(g => g.key === 'nightcrew');
    await db.updateGroup(g2.id, g2.label, g2.permissions.filter(p => p !== PERM));
    await db.init(TMP_DB);
    expect((await db.getGroups()).find(g => g.key === 'nightcrew').permissions).not.toContain(PERM);
  });
});
