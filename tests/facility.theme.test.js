// Integration tests for the facility brand theme (Phase 3).
// Same harness as clinical.integration: isolated temp DB via OPSPOINT_DB,
// driven over HTTP with supertest.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// MUST be set before requiring the server (DB_PATH is read once at load).
const TMP_DB = path.join(os.tmpdir(), `opspoint_theme_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db } = require('../server');

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
async function agentFor(username) {
  const agent = request.agent(app);
  const r = await agent.post('/api/login').send({ username, password: PW });
  expect(r.status).toBe(200);
  return agent;
}

// saveSettings requires facility_name, so every PUT has to carry it.
const put = (agent, body) =>
  agent.put('/api/facility/settings').send({ facility_name: 'Test Facility', ...body });

let admin, plain;

beforeAll(async () => {
  makeUser('themeadmin', ['admin.settings', 'facility.manage']);
  makeUser('themeplain', ['mobile.access']);
  admin = await agentFor('themeadmin');
  plain = await agentFor('themeplain');
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('facility theme', () => {
  test('seeds to indigo', () => {
    expect(db.getSetting('facility_theme')).toBe('indigo');
  });

  test('is exposed on /api/data so the client can apply it', async () => {
    const r = await admin.get('/api/data');
    expect(r.status).toBe(200);
    expect(r.body.facility_theme).toBe('indigo');
  });

  test('is returned by the facility settings endpoint', async () => {
    const r = await admin.get('/api/facility/settings');
    expect(r.status).toBe(200);
    expect(r.body.facility_theme).toBe('indigo');
  });

  test('a valid theme persists', async () => {
    const r = await put(admin, { facility_theme: 'emerald' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);   // the route returns {ok}, not the settings
    expect(db.getSetting('facility_theme')).toBe('emerald');
  });

  // saveFacilitySettings must return facility_theme because that object is the
  // settings_updated broadcast payload; getFacilitySettings must return it so
  // the Admin panel GET sees the stored value instead of falling back to the
  // default — the bug client_statuses already hit.
  test('the save path returns the theme for the settings_updated broadcast', () => {
    const repo = require('../server/modules/facility/repository');
    const out = repo.saveFacilitySettings({ facility_name: 'Test Facility', facility_theme: 'rose' });
    expect(out.facility_theme).toBe('rose');
    expect(repo.getFacilitySettings().facility_theme).toBe('rose');
    repo.saveFacilitySettings({ facility_name: 'Test Facility', facility_theme: 'emerald' });
  });

  test('the stored theme survives a re-read on both endpoints', async () => {
    expect((await admin.get('/api/facility/settings')).body.facility_theme).toBe('emerald');
    expect((await admin.get('/api/data')).body.facility_theme).toBe('emerald');
  });

  test('an unknown theme is rejected and does not overwrite the stored one', async () => {
    const r = await put(admin, { facility_theme: 'chartreuse' });
    expect(r.status).toBe(400);
    expect(db.getSetting('facility_theme')).toBe('emerald');
  });

  test('a non-string theme is rejected', async () => {
    const r = await put(admin, { facility_theme: { key: 'blue' } });
    expect(r.status).toBe(400);
    expect(db.getSetting('facility_theme')).toBe('emerald');
  });

  test('omitting the field leaves the theme alone', async () => {
    const r = await put(admin, { wellness_interval_mins: 90 });
    expect(r.status).toBe(200);
    expect(db.getSetting('facility_theme')).toBe('emerald');
  });

  test('every advertised theme key is accepted', async () => {
    for (const k of ['indigo', 'blue', 'teal', 'emerald', 'rose']) {
      const r = await put(admin, { facility_theme: k });
      expect(r.status).toBe(200);
      expect(db.getSetting('facility_theme')).toBe(k);
    }
  });

  test('a user without admin.settings cannot change the theme', async () => {
    const before = db.getSetting('facility_theme');
    const r = await put(plain, { facility_theme: 'blue' });
    expect(r.status).toBe(403);
    expect(db.getSetting('facility_theme')).toBe(before);
  });
});
