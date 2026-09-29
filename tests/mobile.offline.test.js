// The phone's offline queue, server side: writes sent with an Idempotency-Key
// run once however many times the phone resends them, and queued round taps
// keep the time they were made. Runs on either driver (scripts/pg-audit.sh
// runs it on Postgres).
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_offline_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');
const { fmtClock } = require('../server/lib/schedule');

const PW = 'Offline!Passw0rd9';
const TODAY = new Date().toLocaleDateString('en-CA');
const agents = {};
const ids = {};
const key = () => crypto.randomUUID();
const minsAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

async function makeUser(username, displayName, perms) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,0)`,
    [username, displayName, 'pa', hash, salt, JSON.stringify(perms)]);
  const agent = request.agent(app);
  expect((await agent.post('/api/login').send({ username, password: PW })).status).toBe(200);
  return agent;
}
const lines = async () => (await db.query('SELECT id, time, text FROM log_entries WHERE report_id=1 ORDER BY id'));
const addLine = (agent, k, text, reportId = 1) => {
  const r = agent.patch('/api/data');
  if (k) r.set('Idempotency-Key', k);
  return r.send({ reportId, log_entry: { time: '9:40 PM', text } });
};

beforeAll(async () => {
  await ready;
  agents.a = await makeUser('off_a', 'Offline A', db.ROLE_PRESETS.pa);
  agents.b = await makeUser('off_b', 'Offline B', db.ROLE_PRESETS.pa);
  agents.admin = await makeUser('off_admin', 'Offline Admin', db.PERMISSIONS);
  for (const [room, name] of [['301', 'Riley Stone'], ['302', 'Avery Cole'], ['303', 'Quinn Hale']]) {
    const r = await agents.admin.post('/api/clients').send({ name, room });
    ids[room] = r.body.id || (r.body.client && r.body.client.id);
  }
  const report = { id: 1, report_date: TODAY, shift: 'Night Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
  expect((await agents.admin.post('/api/data').send({ reports: [report], active_report_id: 1 })).status).toBe(200);
});

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

describe('Idempotency-Key', () => {
  test('a resend replays the first answer instead of writing again', async () => {
    const k = key();
    const first = await addLine(agents.a, k, 'Queued while offline');
    expect(first.status).toBe(200);
    const again = await addLine(agents.a, k, 'Queued while offline');
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect((await lines()).filter(e => e.text === 'Queued while offline')).toHaveLength(1);
  });

  test('without the header, or with a new key, it writes as before', async () => {
    await addLine(agents.a, null, 'Plain one');
    await addLine(agents.a, null, 'Plain one');
    await addLine(agents.a, key(), 'Plain one');
    expect((await lines()).filter(e => e.text === 'Plain one')).toHaveLength(3);
  });

  test('keys are per account, bound to their request, and well-formed', async () => {
    const k = key();
    await addLine(agents.a, k, 'From A');
    const b = await addLine(agents.b, k, 'From B');
    expect(b.status).toBe(200);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect((await lines()).map(e => e.text)).toEqual(expect.arrayContaining(['From A', 'From B']));
    const other = await agents.a.put(`/api/rounds/1/marks/${ids['301']}`).set('Idempotency-Key', k).send({ mark: 'ok' });
    expect(other.status).toBe(422);
    expect((await addLine(agents.a, 'short', 'Bad key')).status).toBe(400);
    expect((await addLine(agents.a, 'x'.repeat(20) + ';drop', 'Bad key')).status).toBe(400);
  });

  test('a refusal is replayed too; a request still running answers "try again"', async () => {
    const k = key();
    const first = await addLine(agents.a, k, 'For a report that is not active', 999);
    expect(first.status).toBe(403);
    const again = await addLine(agents.a, k, 'For a report that is not active', 999);
    expect(again.status).toBe(403);
    expect(again.headers['idempotent-replayed']).toBe('true');

    const uid = (await db.query1('SELECT id FROM users WHERE username=?', ['off_a'])).id;
    const running = key();
    await db.run(`INSERT INTO idempotency_keys (user_id, key, route, status, body, created_at) VALUES (?,?,?,0,'',?)`,
      [uid, running, 'PATCH /api/data', new Date().toISOString()]);
    const busy = await addLine(agents.a, running, 'Still running');
    expect(busy.status).toBe(409);
    expect(busy.body.in_progress).toBe(true);
    // One that died mid-write (a restart) is run again after two minutes.
    await db.run('UPDATE idempotency_keys SET created_at=? WHERE user_id=? AND key=?', [minsAgo(5), uid, running]);
    expect((await addLine(agents.a, running, 'Still running')).status).toBe(200);
    expect((await lines()).filter(e => e.text === 'Still running')).toHaveLength(1);
  });
});

describe('queued round taps keep their time', () => {
  let roundId;
  beforeAll(async () => {
    roundId = (await agents.a.post('/api/rounds').send({})).body.round.id;
    // Started half an hour ago, so taps from ten minutes ago are believable.
    await db.run('UPDATE wellness_rounds SET started_at=? WHERE id=?', [minsAgo(30), roundId]);
  });
  const mark = (agent, room, body, k = key()) =>
    agent.put(`/api/rounds/${roundId}/marks/${ids[room]}`).set('Idempotency-Key', k).send(body);
  const markRow = (room) => db.query1('SELECT mark, marked_at, marked_by_name FROM wellness_round_marks WHERE round_id=? AND client_id=?', [roundId, ids[room]]);

  test('a mark is stamped with when it was tapped', async () => {
    const at = minsAgo(10);
    const r = await mark(agents.a, '301', { mark: 'ok', at });
    expect(r.status).toBe(200);
    expect(Date.parse((await markRow('301')).marked_at)).toBe(Date.parse(at));
  });

  test('a late tap loses to a newer one from another phone', async () => {
    expect((await mark(agents.b, '302', { mark: 'ok' })).status).toBe(200);   // online, just now
    const late = await mark(agents.a, '302', { mark: 'missing', at: minsAgo(8) });
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ mark: 'ok', superseded: true });
    expect(await markRow('302')).toMatchObject({ mark: 'ok', marked_by_name: 'Offline B' });
  });

  test('a time in the future or from before the round is not believed', async () => {
    const before = Date.now();
    await mark(agents.a, '303', { mark: 'ok', at: new Date(Date.now() + 3600000).toISOString() });
    expect(Date.parse((await markRow('303')).marked_at)).toBeGreaterThanOrEqual(before - 1000);
    await mark(agents.a, '303', { mark: 'missing', at: minsAgo(90) });
    expect(Date.parse((await markRow('303')).marked_at)).toBeGreaterThanOrEqual(before - 1000);
  });

  test('finishing logs the time the round was finished, once however often it is sent', async () => {
    const at = minsAgo(5);
    const k = key();
    const r = await agents.a.post(`/api/rounds/${roundId}/finish`).set('Idempotency-Key', k).send({ notes: '', at });
    expect(r.status).toBe(200);
    expect(r.body.logEntry.time).toBe(fmtClock(new Date(at)));
    const again = await agents.a.post(`/api/rounds/${roundId}/finish`).set('Idempotency-Key', k).send({ notes: '', at });
    expect(again.status).toBe(200);
    expect(again.body.logEntry.id).toBe(r.body.logEntry.id);
    expect((await lines()).filter(e => /^Wellness check conducted/.test(e.text))).toHaveLength(1);
    const round = await db.query1('SELECT finished_at FROM wellness_rounds WHERE id=?', [roundId]);
    expect(Date.parse(round.finished_at)).toBe(Date.parse(at));
  });

  test('a "found" follow-up logs when they were found', async () => {
    const at = minsAgo(2);
    const r = await agents.a.post(`/api/rounds/${roundId}/marks/${ids['303']}/found`).set('Idempotency-Key', key()).send({ at });
    expect(r.status).toBe(200);
    expect(r.body.logEntry.text).toContain(`located at ${fmtClock(new Date(at))}`);
  });
});
