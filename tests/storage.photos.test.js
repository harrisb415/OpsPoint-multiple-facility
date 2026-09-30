// Photos through the storage port, end to end over HTTP: a resident photo and
// a UA cup photo are saved, come back on GET /api/data and the photo routes,
// and land in whichever backend is configured — the local folder beside the
// database, or (swapped in here) a cloud backend. Runs on either driver.
'use strict';
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_photos_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db, ready } = require('../server');
const storage = require('../server/storage');
const photos = require('../server/storage/photos');

const PW = 'Photos!Passw0rd9';
// A real 1×1 PNG (the magic bytes are what the server checks).
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const PNG_URI = `data:image/png;base64,${PNG_B64}`;
const TODAY = new Date().toLocaleDateString('en-CA');
let admin;

beforeAll(async () => {
  await ready;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,0)`,
    ['ph_admin', 'Photo Admin', 'admin', hash, salt, JSON.stringify(db.PERMISSIONS)]);
  admin = request.agent(app);
  expect((await admin.post('/api/login').send({ username: 'ph_admin', password: PW })).status).toBe(200);
});

afterEach(() => { storage.useStorage(null); photos._clearCache(); });

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

async function residentWithPhoto(room) {
  const c = await admin.post('/api/clients').send({ name: `Photo Resident ${room}`, room });
  expect(c.status).toBe(200);
  const id = c.body.id;
  expect((await admin.put(`/api/clients/${id}`).send({ photo: PNG_URI })).status).toBe(200);
  return id;
}

test('local storage: the photo is a file beside the database and comes back as a PNG data URI', async () => {
  const id = await residentWithPhoto('701');
  const row = await db.query1('SELECT photo FROM clients WHERE id=?', [id]);
  expect(row.photo).toBe(`photos/client_${id}.png`);
  const file = path.join(path.dirname(TMP_DB), 'photos', `client_${id}.png`);
  expect(fs.readFileSync(file).toString('base64')).toBe(PNG_B64);
  const data = (await admin.get('/api/data')).body;
  expect(data.clients.find(c => c.id === id).photo).toBe(PNG_URI);
  const direct = await admin.get(`/photos/client_${id}.png`);
  expect(direct.status).toBe(200);
  expect(direct.headers['content-type']).toMatch(/^image\/png/);
  expect(direct.headers['cache-control']).toBe('private, no-cache');
  const anon = await request(app).get(`/photos/client_${id}.png`);        // signed out: sent to sign in, no photo
  expect(anon.status).toBe(302);
  expect(anon.headers.location).toBe('/login');
  expect((await admin.get('/photos/..%2F..%2Fsecret.key')).status).toBe(404);
  fs.unlinkSync(file);
});

test('a cloud backend: the same routes read and write through it', async () => {
  const objects = new Map();
  storage.useStorage(storage.wrap({
    kind: 's3',
    put: async (k, b, type) => { objects.set(k, { b, type }); },
    get: async (k) => (objects.get(k) || {}).b || null,
    remove: async (k) => { objects.delete(k); },
    list: async () => [...objects.keys()],
    describe: () => 'a fake bucket',
  }));
  const id = await residentWithPhoto('702');
  expect(objects.get(`photos/client_${id}.png`)).toMatchObject({ type: 'image/png' });
  expect(fs.existsSync(path.join(path.dirname(TMP_DB), 'photos', `client_${id}.png`))).toBe(false);
  photos._clearCache();
  const data = (await admin.get('/api/data')).body;
  expect(data.clients.find(c => c.id === id).photo).toBe(PNG_URI);

  // A UA cup photo: onto a UA line of the open shift, then read back.
  const rep = { id: 9001, report_date: TODAY, shift: 'Day Shift', mod_name: '', is_closed: false, statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
  expect((await admin.post('/api/data').send({ reports: [rep], active_report_id: 9001 })).status).toBe(200);
  const ua = await admin.post('/api/ua-records').send({ client_id: id, client_name: 'Photo Resident 702', room: '702', tested_at: new Date().toISOString(),
    collection_method: 'observed', reason: 'random', result: 'pass', panel_results: { THC: 'neg' }, witnessed_by_name: 'Pat', notes: '', log_time: '9:40 AM' });
  expect(ua.status).toBe(200);
  const line = ua.body.log_entry_id;
  expect((await admin.post(`/api/log/${line}/photo`).send({ photo: PNG_URI })).status).toBe(200);
  const key = [...objects.keys()].find(k => k.startsWith(`photos/ua_${line}_`));
  expect(key).toBeTruthy();
  const back = await admin.get(`/api/log/${line}/photo`);
  expect(back.status).toBe(200);
  expect(back.body.photo).toBe(PNG_URI);                    // PNG, though the file is named .jpg
});

test('a cloud backend that is down: the resident list still loads, without the photo', async () => {
  storage.useStorage(storage.wrap({
    kind: 's3', put: async () => {}, get: async () => { throw new Error("can't reach s3.us-west-2.amazonaws.com: no answer in 20 seconds"); },
    remove: async () => {}, list: async () => [], describe: () => 'a bucket that is down',
  }));
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const r = await admin.get('/api/data');
    expect(r.status).toBe(200);
    expect(r.body.clients.filter(c => /^Photo Resident/.test(c.name)).every(c => c.photo === null)).toBe(true);
  } finally { quiet.mockRestore(); }
});
