// OPSPOINT_UPDATES=platform (the managed and docker profiles): new versions
// arrive as a new image or deployment, so the in-app updater is switched off —
// Admin is told why, and nothing can check, install or roll back through it.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_updplat_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;
process.env.OPSPOINT_UPDATES = 'platform';

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW = 'Upd4tes!Platform9';
let admin;

beforeAll(async () => {
  await ready;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,0)`,
    ['up_admin', 'up_admin', 'admin', hash, salt, JSON.stringify(db.PERMISSIONS)]);
  admin = request.agent(app);
  expect((await admin.post('/api/login').send({ username: 'up_admin', password: PW })).status).toBe(200);
});

afterAll(() => {
  delete process.env.OPSPOINT_UPDATES;
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

const MESSAGE = 'Updates on this deployment arrive as new versions from the hosting platform, not through this page.';

test('the status says updates come from the platform', async () => {
  const r = await admin.get('/api/update/status');
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ mode: 'platform', message: MESSAGE, current: require('../package.json').version });
});

test('check, install and roll back are refused with the reason', async () => {
  for (const route of ['/api/update/check', '/api/update/apply', '/api/update/rollback']) {
    const r = await admin.post(route).send({});
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: MESSAGE });
  }
});

test('the permission check still comes first', async () => {
  const anon = await request(app).post('/api/update/check').send({});
  expect(anon.status).toBe(401);
});
