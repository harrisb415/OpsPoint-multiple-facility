// The notification bell's "Past 24 hours" for UA requests: GET
// /api/ua-requests/recent lists what was acknowledged in the last day, with
// who did it, and leaves out anything still pending or acknowledged earlier.
// Runs on either driver.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// MUST be set before requiring the server (DB_PATH is read once at load).
const TMP_DB = path.join(os.tmpdir(), `opspoint_uarecent_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW = 'UaRecent!Passw0rd9';
let agent;
let clientId;

// 'YYYY-MM-DD HH:MM:SS' local, the format acknowledged_at is written in.
function localAgo(hours) {
  const d = new Date(Date.now() - hours * 3600000), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

beforeAll(async () => {
  await ready;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    ['ua_recent', 'UA Recent', 'admin', hash, salt, JSON.stringify(db.PERMISSIONS)]);
  agent = request.agent(app);
  expect((await agent.post('/api/login').send({ username: 'ua_recent', password: PW })).status).toBe(200);
  const c = await agent.post('/api/clients').send({ name: 'Terrence W.', room: '106' });
  clientId = c.body.id || (c.body.client && c.body.client.id);
  expect(clientId).toBeTruthy();
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('recently acknowledged UA requests', () => {
  let first, second;

  test('an acknowledged request moves from pending to recent, with who acknowledged it', async () => {
    for (let i = 0; i < 2; i++) {
      expect((await agent.post('/api/ua-requests').send({ client_id: clientId, client_name: 'Terrence W.', room: '106' })).status).toBe(200);
    }
    const pending = (await agent.get('/api/ua-requests')).body;
    expect(pending).toHaveLength(2);
    [first, second] = pending.map(r => r.id).sort((a, b) => a - b);

    expect((await agent.post(`/api/ua-requests/${first}/acknowledge`).send({})).status).toBe(200);

    expect((await agent.get('/api/ua-requests')).body.map(r => r.id)).toEqual([second]);
    const recent = (await agent.get('/api/ua-requests/recent')).body;
    expect(recent.map(r => r.id)).toEqual([first]);
    expect(recent[0]).toMatchObject({ client_name: 'Terrence W.', room: '106', acknowledged_by: 'UA Recent' });
    expect(recent[0].acknowledged_at).toBeTruthy();
  });

  test('newest acknowledgement first; one older than a day drops off', async () => {
    expect((await agent.post(`/api/ua-requests/${second}/acknowledge`).send({})).status).toBe(200);
    await db.run('UPDATE ua_requests SET acknowledged_at=? WHERE id=?', [localAgo(2), first]);
    expect((await agent.get('/api/ua-requests/recent')).body.map(r => r.id)).toEqual([second, first]);

    await db.run('UPDATE ua_requests SET acknowledged_at=? WHERE id=?', [localAgo(25), first]);
    expect((await agent.get('/api/ua-requests/recent')).body.map(r => r.id)).toEqual([second]);
  });

  test('signed out gets nothing', async () => {
    expect((await request(app).get('/api/ua-requests/recent')).status).toBe(401);
  });
});
