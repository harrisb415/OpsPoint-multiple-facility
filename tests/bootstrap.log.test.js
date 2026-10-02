// The supervisor's log file (OPSPOINT_LOG_FILE): the Windows service has no console and no
// journal, so bootstrap.js writes its own and the server's output there, each line with its
// time, kept to a size. Without the setting nothing changes: the output stays on the console.
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_bootlog_'));
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* temp */ } });

const STAMP = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d[+-]\d\d:\d\d /;

// A stand-in for server.js: writes what it is given, then refuses to start (exit 78), so the
// supervisor stops at once instead of relaunching it.
let n = 0;
function fakeServer(body) {
  const f = path.join(TMP, `server-${++n}.js`);
  fs.writeFileSync(f, `const fs = require('fs');\n${body}\nprocess.exit(78);\n`);
  return f;
}
function supervise(entry, env = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, 'bootstrap.js')], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, OPSPOINT_CONFIG: 'none', OPSPOINT_DATA: TMP, OPSPOINT_BOOTSTRAP_ENTRY: entry, ...env },
  });
}

test("the server's lines and the supervisor's own go to the file, each with its time", () => {
  const log = path.join(TMP, 'a', 'logs', 'opspoint.log');            // the folder is made for it
  const entry = fakeServer([
    "fs.writeSync(1, 'OpsPoint starting\\n');",
    "fs.writeSync(2, 'OpsPoint can\\'t start: TZ is not a time zone\\n');",
    "fs.writeSync(1, 'half a line, then');",
    "fs.writeSync(1, ' the rest — in UTF-8\\nno newline at the end');",
  ].join('\n'));
  const r = supervise(entry, { OPSPOINT_LOG_FILE: log });
  expect(r.status).toBe(78);
  expect(r.stdout).toBe('');                                            // not a terminal: nothing on the console
  const text = fs.readFileSync(log, 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  const lines = text.slice(0, -1).split('\n');
  for (const l of lines) expect(l).toMatch(STAMP);
  const bodies = lines.map((l) => l.replace(STAMP, ''));
  expect(bodies).toContain('OpsPoint starting');
  expect(bodies).toContain("OpsPoint can't start: TZ is not a time zone");    // the reason, before the stop
  expect(bodies).toContain('half a line, then the rest — in UTF-8');
  expect(bodies).toContain('no newline at the end');
  expect(bodies[bodies.length - 1]).toMatch(/^\[bootstrap\] server refused to start/);
});

test('the file is kept to its size: older lines move to .1, .2 and .3, and no further', () => {
  const dir = path.join(TMP, 'rot');
  const log = path.join(dir, 'opspoint.log');
  const entry = fakeServer("for (let i = 0; i < 400; i++) fs.writeSync(1, 'line ' + i + ' ' + 'x'.repeat(40) + '\\n');");
  const r = supervise(entry, { OPSPOINT_LOG_FILE: log, OPSPOINT_BOOTSTRAP_LOG_MAX: '2000' });
  expect(r.status).toBe(78);
  expect(fs.readdirSync(dir).sort()).toEqual(['opspoint.log', 'opspoint.log.1', 'opspoint.log.2', 'opspoint.log.3']);
  const kept = [`${log}.3`, `${log}.2`, `${log}.1`, log].map((f) => fs.readFileSync(f, 'utf8'));
  for (const t of kept) expect(Buffer.byteLength(t)).toBeLessThan(2000 + 200);   // the size, plus at most one line
  // Oldest to newest, nothing lost inside what is kept, and the newest file ends with the stop.
  const numbers = kept.join('').match(/line \d+/g).map((s) => Number(s.slice(5)));
  expect(numbers[numbers.length - 1]).toBe(399);
  numbers.forEach((v, i) => { if (i) expect(v).toBe(numbers[i - 1] + 1); });
  expect(kept[3]).toMatch(/\[bootstrap\] server refused to start/);
});

test("a full file that can't be moved aside (on Windows: a viewer has it open) leaves the older files as they are", () => {
  const dir = path.join(TMP, 'held');
  const log = path.join(dir, 'opspoint.log');
  fs.mkdirSync(path.join(dir, 'opspoint.log.0', 'x'), { recursive: true });   // where it would move: taken, so the move fails
  fs.writeFileSync(`${log}.1`, 'older\n');
  fs.writeFileSync(`${log}.2`, 'oldest\n');
  const entry = fakeServer("for (let i = 0; i < 400; i++) fs.writeSync(1, 'line ' + i + ' ' + 'x'.repeat(40) + '\\n');");
  const r = supervise(entry, { OPSPOINT_LOG_FILE: log, OPSPOINT_BOOTSTRAP_LOG_MAX: '2000' });
  expect(r.status).toBe(78);
  expect(fs.readFileSync(`${log}.1`, 'utf8')).toBe('older\n');
  expect(fs.readFileSync(`${log}.2`, 'utf8')).toBe('oldest\n');
  expect(fs.existsSync(`${log}.3`)).toBe(false);
  expect(fs.readFileSync(log, 'utf8').match(/line \d+/g)).toHaveLength(400);   // every line, in the one file
});

test('without the setting the output stays on the console, as before', () => {
  const entry = fakeServer("fs.writeSync(1, 'on the console\\n');");
  const r = supervise(entry);
  expect(r.status).toBe(78);
  expect(r.stdout).toMatch(/^on the console\n\[bootstrap\] server refused to start/);
  expect(fs.readdirSync(TMP).filter((f) => f.endsWith('.log'))).toEqual([]);
});

test("a log file it can't write leaves the output on the console, and OpsPoint still starts", () => {
  const blocker = path.join(TMP, 'a-file');
  fs.writeFileSync(blocker, '');
  const entry = fakeServer("fs.writeSync(1, 'still running\\n');");
  const r = supervise(entry, { OPSPOINT_LOG_FILE: path.join(blocker, 'logs', 'opspoint.log') });
  expect(r.status).toBe(78);
  expect(r.stderr).toMatch(/can't write the log file .*the output stays on the console/);
  expect(r.stdout).toMatch(/still running/);
});
