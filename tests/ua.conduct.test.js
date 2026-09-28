// Anyone can conduct a UA: every role has ua.record (granted once to
// existing groups, never re-applied), and POST /api/ua-records writes the
// UA's shift-log line and the resident's last-UA stamp itself, so
// "Record UA results" alone covers it — a PA without ua.request and a case
// manager without log.add can both save one. Runs on either driver.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// MUST be set before requiring the server (DB_PATH is read once at load).
const TMP_DB = path.join(os.tmpdir(), `opspoint_uaconduct_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW = 'UaConduct!Passw0rd9';
const TODAY = new Date().toLocaleDateString('en-CA');
const agents = {};
let terrence;

async function makeUser(username, displayName, role, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    [username, displayName, role, hash, salt, JSON.stringify(perms)]);
  const agent = request.agent(app);
  expect((await agent.post('/api/login').send({ username, password: PW })).status).toBe(200);
  return agent;
}
const ua = (over = {}) => ({
  client_id: terrence, client_name: 'Terrence W.', room: '106',
  tested_at: new Date().toISOString(), collection_method: 'observed', reason: 'random',
  result: 'fail', panel_results: { ETG: 'neg', THC: 'pos', FEN: 'na' },
  witnessed_by_name: 'Pat Q.', notes: '', log_time: '9:15 PM', ...over,
});
const report = async () => db.query1('SELECT last_ua FROM reports WHERE id=1');
const lines = async () => (await db.query('SELECT id, time, text FROM log_entries WHERE report_id=1 ORDER BY id')).map(e => e.text);

beforeAll(async () => {
  await ready;
  agents.admin = await makeUser('uc_admin', 'UC Admin', 'admin', db.PERMISSIONS);
  agents.pa    = await makeUser('uc_pa', 'UC PA', 'pa', db.ROLE_PRESETS.pa);
  agents.cm    = await makeUser('uc_cm', 'UC CM', 'case_manager', db.ROLE_PRESETS.case_manager);
  agents.none  = await makeUser('uc_none', 'UC None', 'pa', db.ROLE_PRESETS.pa.filter(p => p !== 'ua.record'));
  const c = await agents.admin.post('/api/clients').send({ name: 'Terrence W.', room: '106' });
  terrence = c.body.id || (c.body.client && c.body.client.id);
  const rep = { id: 1, report_date: TODAY, shift: 'Swing Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
  expect((await agents.admin.post('/api/data').send({ reports: [rep], active_report_id: 1 })).status).toBe(200);
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('ua.record for everyone', () => {
  test('every role preset has it, and so does every seeded group', async () => {
    for (const role of Object.keys(db.ROLE_PRESETS)) expect([role, db.ROLE_PRESETS[role].includes('ua.record')]).toEqual([role, true]);
    for (const g of await db.getGroups()) expect([g.key, g.permissions.includes('ua.record')]).toEqual([g.key, true]);
    expect(await db.getSetting('perm_grants', [])).toContain('ua.record-everyone');
  });

  test('the grant reaches custom groups once, and never comes back after an admin removes it', async () => {
    // An install from before the grant: a custom group without it, grant not yet recorded.
    await db.createGroup('night_float', 'Night Float', ['log.add']);
    await db.setSetting('perm_grants', []);
    await db._applyOneTimeGrants();
    const g = (await db.getGroups()).find(x => x.key === 'night_float');
    expect(g.permissions).toContain('ua.record');

    // An admin takes it away again; later boots leave it that way.
    await db.updateGroup(g.id, g.label, g.permissions.filter(p => p !== 'ua.record'));
    await db._applyOneTimeGrants();
    expect((await db.getGroups()).find(x => x.key === 'night_float').permissions).not.toContain('ua.record');
  });
});

describe('recording a UA writes its own log line', () => {
  test('a PA (no ua.request) records one: the line, the last-UA stamp and the link to the record', async () => {
    expect(db.ROLE_PRESETS.pa.includes('ua.request')).toBe(false);
    const r = await agents.pa.post('/api/ua-records').send(ua());
    expect(r.status).toBe(200);
    const text = 'Terrence W. (Rm. 106) — UA: POS: THC | NEG: ETG | NT: FEN — by Pat Q. [Random, Observed]';
    expect((await lines()).slice(-1)).toEqual([text]);
    const entry = await db.query1('SELECT id, time FROM log_entries WHERE report_id=1 ORDER BY id DESC LIMIT 1');
    expect(entry.time).toBe('9:15 PM');
    expect(r.body.log_entry_id).toBe(entry.id);
    expect(r.body.record.log_entry_id).toBe(entry.id);
    const stamps = JSON.parse((await report()).last_ua || '{}');
    expect(stamps[String(terrence)]).toBe(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  });

  test('a case manager (no log.add) records one too; all-negative reads "All NEG"', async () => {
    expect(db.ROLE_PRESETS.case_manager.includes('log.add')).toBe(false);
    const r = await agents.cm.post('/api/ua-records').send(ua({ result: 'pass', reason: 'cm_request', collection_method: 'lab', panel_results: { ETG: 'neg', THC: 'neg' } }));
    expect(r.status).toBe(200);
    expect((await lines()).slice(-1)).toEqual(['Terrence W. (Rm. 106) — UA: All NEG — by Pat Q. [CM request, Lab]']);
  });

  test('the line carries only the record\'s own fields', async () => {
    const r = await agents.pa.post('/api/ua-records').send(ua({
      reason: 'anything I like', collection_method: 'freeform',
      panel_results: { THC: 'pos', 'Injected text, here': 'pos' },
    }));
    expect(r.status).toBe(200);
    expect((await lines()).slice(-1)).toEqual(['Terrence W. (Rm. 106) — UA: POS: THC — by Pat Q. []']);
  });

  test('an interview: its name, no last-UA stamp', async () => {
    const before = (await report()).last_ua;
    const r = await agents.pa.post('/api/ua-records').send(ua({
      client_id: 0, is_interview: true, client_name: 'Jordan (interview)', room: '', reason: '', panel_results: { ETG: 'neg' },
    }));
    expect(r.status).toBe(200);
    expect((await lines()).slice(-1)).toEqual(['Jordan (interview) — UA: All NEG — by Pat Q. [Interview, Observed]']);
    expect((await report()).last_ua).toBe(before);
  });

  test('without ua.record: refused, and nothing is written', async () => {
    const n = (await lines()).length;
    expect((await agents.none.post('/api/ua-records').send(ua())).status).toBe(403);
    expect((await lines()).length).toBe(n);
  });

  test('a bad time is refused before anything is written', async () => {
    const n = (await lines()).length;
    const records = (await db.query('SELECT COUNT(*) AS c FROM ua_records'))[0].c;
    expect((await agents.pa.post('/api/ua-records').send(ua({ log_time: '25:99' }))).status).toBe(400);
    expect((await lines()).length).toBe(n);
    expect((await db.query('SELECT COUNT(*) AS c FROM ua_records'))[0].c).toBe(records);
  });

  test('no open report: the record is saved without a line', async () => {
    await db.run('UPDATE reports SET is_closed=1 WHERE id=1');
    const n = (await lines()).length;
    const r = await agents.pa.post('/api/ua-records').send(ua());
    expect(r.status).toBe(200);
    expect(r.body.log_entry_id).toBeNull();
    expect((await lines()).length).toBe(n);
    await db.run('UPDATE reports SET is_closed=0 WHERE id=1');
  });
});
