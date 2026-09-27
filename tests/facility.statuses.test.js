// Integration tests for the resident status list: what a new facility starts
// with, and what an admin can and can't take away. Same harness as
// facility.theme: isolated temp DB via OPSPOINT_DB, driven over HTTP.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// MUST be set before requiring the server (DB_PATH is read once at load).
const TMP_DB = path.join(os.tmpdir(), `opspoint_statuses_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW = 'Passw0rd!';
const BUILT_IN = ['building', 'pass', 'hospital', 'out'];

async function makeUser(username, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    [username, username, 'admin', hash, salt, JSON.stringify(perms)]
  );
}

const put = (agent, list) =>
  agent.put('/api/facility/settings').send({ facility_name: 'Test Facility', client_statuses: list });
const keys = async () => (await db.getSetting('client_statuses')).map(s => s.key);
const addReport = (isClosed, statuses) =>
  db.run('INSERT INTO reports (report_date, shift, is_closed, statuses) VALUES (?,?,?,?)',
    ['2026-09-01', 'Day Shift', isClosed ? 1 : 0, JSON.stringify(statuses)]);

let admin;

beforeAll(async () => {
  await ready;
  await makeUser('statusadmin', ['admin.settings']);
  admin = request.agent(app);
  const r = await admin.post('/api/login').send({ username: 'statusadmin', password: PW });
  expect(r.status).toBe(200);
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('resident statuses', () => {
  test('a new facility starts with the four built-ins and nothing else', async () => {
    const list = await db.getSetting('client_statuses');
    expect(list.map(s => s.key)).toEqual(BUILT_IN);
    expect(list.every(s => s.system === true)).toBe(true);
  });

  // The client's first-paint fallback and its "required" markers are separate
  // literals in an ESM file jest can't import. Read them as text so the two
  // sides can't drift apart again (the fallback once had no system flags).
  test('the client fallback and built-in list mirror the server', () => {
    const src = fs.readFileSync(path.join(__dirname, '../client/src/utils/statuses.js'), 'utf8');
    const block = src.match(/export const DEFAULT_STATUSES = \[([\s\S]*?)\n\]/)[1];
    expect([...block.matchAll(/key: '(\w+)'/g)].map(m => m[1])).toEqual(BUILT_IN);
    expect((block.match(/system: true/g) || []).length).toBe(BUILT_IN.length);
    const sys = src.match(/export const SYSTEM_STATUS_KEYS = \[([^\]]*)\]/)[1];
    expect([...sys.matchAll(/'(\w+)'/g)].map(m => m[1])).toEqual(BUILT_IN);
  });

  test('no built-in can be removed — Hospital included', async () => {
    const full = await db.getSetting('client_statuses');
    for (const key of BUILT_IN) {
      const r = await put(admin, full.filter(s => s.key !== key));
      expect(r.status).toBe(400);
    }
    expect(await keys()).toEqual(BUILT_IN);
  });

  test('a built-in can still be renamed and recoloured', async () => {
    const list = (await db.getSetting('client_statuses'))
      .map(s => (s.key === 'hospital' ? { ...s, label: 'Medical', tone: 'pink' } : s));
    expect((await put(admin, list)).status).toBe(200);
    const hosp = (await db.getSetting('client_statuses')).find(s => s.key === 'hospital');
    expect(hosp).toMatchObject({ label: 'Medical', tone: 'pink', system: true });
  });

  test('a site-specific status can be added, and removed outright while unused', async () => {
    const base = await db.getSetting('client_statuses');
    expect((await put(admin, [...base, { key: 'court', label: 'Court', tone: 'purple' }])).status).toBe(200);
    expect(await keys()).toEqual([...BUILT_IN, 'court']);
    expect((await put(admin, base)).status).toBe(200);
    expect(await keys()).toEqual(BUILT_IN);           // never used -> deleted, not archived
  });

  test('removing a status an old shift used retires it, so history keeps its label', async () => {
    const base = await db.getSetting('client_statuses');
    await put(admin, [...base, { key: 'work', label: 'At Work', tone: 'blue' }]);
    await addReport(true, { 1: 'work' });
    expect((await put(admin, base)).status).toBe(200);
    const work = (await db.getSetting('client_statuses')).find(s => s.key === 'work');
    expect(work).toMatchObject({ label: 'At Work', archived: true });
  });

  test('a status in use on the open shift cannot be removed', async () => {
    const base = (await db.getSetting('client_statuses')).filter(s => !s.archived);
    await put(admin, [...base, { key: 'bhc', label: 'BHC', tone: 'purple' }]);
    await addReport(false, { 2: 'bhc' });
    const r = await put(admin, base);
    expect(r.status).toBe(409);
    expect(await keys()).toContain('bhc');
  });
});
