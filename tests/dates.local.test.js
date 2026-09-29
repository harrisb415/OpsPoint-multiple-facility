// Calendar days the server stamps are the facility's day, not UTC's.
// SQLite's date('now') gave a milestone signed off at 6 PM Pacific tomorrow's
// completion date. Checked in a zone that disagrees with UTC about today right
// now, so a UTC day can't pass by luck — and in a child process, because TZ is
// process-wide and jest runs every test file in one. Runs on either driver.
'use strict';
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { execFileSync } = require('child_process');

// UTC+14 differs from UTC from 10:00 UTC on, UTC-12 before 12:00 UTC.
const ZONE = new Date().getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Etc/GMT+12';
const TMP_DB = path.join(os.tmpdir(), `opspoint_dates_${Date.now()}.db`);
const REPO = path.join(__dirname, '..');

const CHILD = `
  const { db, ready } = require(${JSON.stringify(path.join(REPO, 'server.js'))});
  const { localDate } = require(${JSON.stringify(path.join(REPO, 'server', 'lib', 'time.js'))});
  (async () => {
    await ready;
    const c = await db.run("INSERT INTO clients (room, name) VALUES ('599', 'Date Resident')");
    const m = await db.createMilestone({ client_id: c.lastInsertRowid, client_name: 'Date Resident', objective: 'Stay the course' });
    const s = await db.signoffMilestone(m.id, null, 'Counselor');
    process.stdout.write('@@' + JSON.stringify({ completion: s.completion_date, local: localDate(), utc: new Date().toISOString().slice(0, 10) }));
    process.exit(0);
  })().catch(e => { console.error(e); process.exit(1); });`;

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

test("signing off a milestone dates it today in the facility's zone", () => {
  const out = execFileSync(process.execPath, ['-e', CHILD], {
    env: { ...process.env, TZ: ZONE, OPSPOINT_DB: TMP_DB }, encoding: 'utf8', timeout: 60000,
  });
  const r = JSON.parse(out.slice(out.lastIndexOf('@@') + 2));
  expect(r.local).not.toBe(r.utc);   // the zone really does disagree with UTC today
  expect(r.completion).toBe(r.local);
});
