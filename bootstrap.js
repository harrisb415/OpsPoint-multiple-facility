'use strict';
/**
 * OpsPoint launcher + auto-rollback supervisor.
 *
 * run.bat runs THIS instead of `node server.js`. It:
 *   - launches server.js as a child (with OPSPOINT_BOOTSTRAP=1)
 *   - after an update (a data/updates/pending-verify.json marker exists),
 *     health-checks the new build and AUTO-ROLLS-BACK to the backup if it does
 *     not come up, then relaunches the restored build
 *   - relaunches the server whenever it exits (an in-app restart / update simply
 *     exits the child; the supervisor brings it back)
 *   - gives up on a crash loop so a persistent failure surfaces instead of spinning
 *
 * bootstrap.js is deliberately NOT in the update bundle's swap set (RUNTIME_FILES),
 * so the supervisor stays stable across updates — like run.bat.
 *
 * Most config comes from env so this is testable in isolation:
 *   OPSPOINT_BOOTSTRAP_BASE   app root (default: __dirname)
 *   OPSPOINT_BOOTSTRAP_ENTRY  server entry (default: <base>/server.js)
 *   OPSPOINT_DATA             data dir (default: <base>/data)
 *   PORT, OPSPOINT_HEALTH_PATH, OPSPOINT_VERIFY_TIMEOUT
 * OPSPOINT_DATA, PORT and the last two may also come from opspoint.config.json
 * (see docs/SETTINGS.md); the environment wins, as it does for the server.
 * So may OPSPOINT_LOG_FILE: its own and the server's output go to that file instead
 * of the console (the Windows service has neither a console nor a journal).
 *
 * A server that exits with code 78 refused to start over a setting: that is
 * printed, and the supervisor stops rather than relaunching into it forever.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const { StringDecoder } = require('string_decoder');

const BASE = process.env.OPSPOINT_BOOTSTRAP_BASE || __dirname;

// The settings file (opspoint.config.json, or the file OPSPOINT_CONFIG names)
// can move the port or the data folder, and the health probe has to follow it.
// Read here without requiring server/settings: the supervisor must keep
// working even when an update broke that code. The environment still wins.
function fileSettings() {
  const named = process.env.OPSPOINT_CONFIG;
  if (named && named.trim().toLowerCase() === 'none') return {};
  try {
    const j = JSON.parse(fs.readFileSync(named ? path.resolve(named) : path.join(BASE, 'opspoint.config.json'), 'utf8').replace(/^\uFEFF/, ''));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch (e) { return {}; }
}
const FILE = fileSettings();
function setting(name) {
  const e = process.env[name];
  if (e !== undefined && e !== '') return e;
  const f = FILE[name];
  return f === undefined || f === null || f === '' ? undefined : String(f);
}

const DATA = setting('OPSPOINT_DATA') || path.join(BASE, 'data');
const ENTRY = process.env.OPSPOINT_BOOTSTRAP_ENTRY || path.join(BASE, 'server.js');
const PORT = parseInt(setting('PORT') || '3000', 10);
const HEALTH_PATH = setting('OPSPOINT_HEALTH_PATH') || '/api/health';
const VERIFY_TIMEOUT = parseInt(setting('OPSPOINT_VERIFY_TIMEOUT') || '90000', 10);
// server.js exits with this when a setting is missing or contradictory
// (server/settings EX_CONFIG): relaunching can't fix that, so stop.
const EX_CONFIG = 78;
const UP_DIR = path.join(DATA, 'updates');
const PENDING = path.join(UP_DIR, 'pending-verify.json');

// OPSPOINT_LOG_FILE: every line, the server's and the supervisor's, with the time it was
// written. At LOG_MAX the file becomes <file>.1 (.1 becomes .2, .2 becomes .3) and a new one
// starts, so it never fills a disk. On Windows a file another program holds open (a viewer
// following it) can't be renamed: then nothing moves, the older files stay as they are, and
// the next try comes after another tenth of LOG_MAX. A file that can't be written leaves the
// console in charge.
const LOG_MAX = parseInt(process.env.OPSPOINT_BOOTSTRAP_LOG_MAX || '', 10) || 10 * 1024 * 1024;
const LOG_KEEP = 3;
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${off < 0 ? '-' : '+'}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}
function openLog(file) {
  let fd = null, size = 0, limit = LOG_MAX;
  const open = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fd = fs.openSync(file, 'a');
    size = fs.fstatSync(fd).size;
  };
  try { open(); } catch (e) {
    console.error(`[bootstrap] can't write the log file ${file} (${e.message}): the output stays on the console`);
    return null;
  }
  function rotate() {
    try { fs.closeSync(fd); } catch (e) { /* already closed */ }
    // The full file moves aside first; only then do the older ones move up (.0 becomes .1).
    let moved = true;
    try { fs.renameSync(file, `${file}.0`); } catch (e) { moved = false; }
    if (moved) for (let i = LOG_KEEP; i >= 1; i--) { try { fs.renameSync(`${file}.${i - 1}`, `${file}.${i}`); } catch (e) { /* not there yet */ } }
    open();
    limit = moved ? LOG_MAX : size + Math.ceil(LOG_MAX / 10);
  }
  return {
    write(text) {
      try {
        if (size >= limit) rotate();
        const b = Buffer.from(text, 'utf8');
        fs.writeSync(fd, b);
        size += b.length;
      } catch (e) { /* a full disk must not take OpsPoint down with it */ }
      if (process.stdout.isTTY) process.stdout.write(text);
    },
  };
}
const LOG = setting('OPSPOINT_LOG_FILE') ? openLog(setting('OPSPOINT_LOG_FILE')) : null;

// One of the server's streams into the log, whole lines only (stdout and stderr never share
// one), each stamped when it is complete; what is left when the stream ends is a line too.
function logStream(stream) {
  const dec = new StringDecoder('utf8');
  let partial = '';
  const line = (l) => LOG.write(`${stamp()} ${l}\n`);
  stream.on('data', (chunk) => {
    const lines = (partial + dec.write(chunk)).split('\n');
    partial = lines.pop();
    for (const l of lines) line(l);
    if (partial.length > 65536) { line(partial); partial = ''; }
  });
  stream.on('end', () => { partial += dec.end(); if (partial) line(partial); partial = ''; });
}

function log(...a) {
  const line = util.format('[bootstrap]', ...a);
  if (LOG) LOG.write(`${stamp()} ${line}\n`); else console.log(line);
}

// One health probe → cb(true|false). HTTPS (self-signed ok) if certs are present.
function healthOnce(cb) {
  const useHttps = fs.existsSync(path.join(DATA, 'cert.pem')) && fs.existsSync(path.join(DATA, 'key.pem'));
  const lib = useHttps ? require('https') : require('http');
  const opts = { host: '127.0.0.1', port: PORT, path: HEALTH_PATH, timeout: 4000 };
  if (useHttps) opts.rejectUnauthorized = false;
  const req = lib.get(opts, (res) => { res.resume(); cb(res.statusCode >= 200 && res.statusCode < 500); });
  req.on('error', () => cb(false));
  req.on('timeout', () => { req.destroy(); cb(false); });
}

// Resolve true once healthy, or false if the child exits or the timeout elapses.
function waitHealthy(child, timeoutMs) {
  return new Promise((resolve) => {
    let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const deadline = Date.now() + timeoutMs;
    child.once('exit', () => finish(false));
    (function poll() {
      if (done) return;
      if (Date.now() > deadline) return finish(false);
      healthOnce((ok) => ok ? finish(true) : setTimeout(poll, 1500));
    })();
  });
}

// Restore everything in a backup folder (except BACKUP.json) over the app root.
// Self-contained: does not require any of the (possibly broken) swapped code.
function restoreBackup(backupPath, baseDir) {
  baseDir = baseDir || BASE;
  for (const name of fs.readdirSync(backupPath)) {
    if (name === 'BACKUP.json') continue;
    const src = path.join(backupPath, name), dest = path.join(baseDir, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) { fs.rmSync(dest, { recursive: true, force: true }); fs.cpSync(src, dest, { recursive: true, force: true }); }
    else fs.copyFileSync(src, dest);
  }
}

// Resolve when the child has exited — immediately if it already has (avoids
// hanging when a broken build exits before we attach a fresh 'exit' listener).
function whenExited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((r) => child.once('exit', r));
}
function readPending() { try { return JSON.parse(fs.readFileSync(PENDING, 'utf8')); } catch (e) { return null; } }
function clearPending() { try { fs.rmSync(PENDING, { force: true }); } catch (e) {} }
function launch() {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: BASE, stdio: LOG ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: Object.assign({}, process.env, { OPSPOINT_BOOTSTRAP: '1' }),
  });
  if (LOG) { logStream(child.stdout); logStream(child.stderr); }
  return child;
}
// With a log file, the child's last lines (why it stopped) are written before its exit is
// acted on: 'exit' can come before its output has all been read.
function drained(child) {
  const streams = [child.stdout, child.stderr].filter(Boolean);
  if (!streams.length) return Promise.resolve();
  const closed = (s) => new Promise((r) => { if (s.readableEnded || s.destroyed) r(); else s.once('close', r); });
  return Promise.race([Promise.all(streams.map(closed)), new Promise((r) => setTimeout(r, 2000))]);
}

async function supervise() {
  let crashes = [];
  for (;;) {
    const pending = readPending();
    const child = launch();

    if (pending && pending.backupPath) {
      log('verifying update to v' + (pending.to || '?') + '…');
      const healthy = await waitHealthy(child, VERIFY_TIMEOUT);
      if (healthy) {
        clearPending();
        log('update verified — running v' + (pending.to || '?'));
      } else {
        log('new build failed health check — rolling back to v' + (pending.from || '?'));
        try { child.kill(); } catch (e) {}
        await whenExited(child); // wait so files are free (immediate if already gone)
        if (pending.backupPath && fs.existsSync(pending.backupPath)) {
          try { restoreBackup(pending.backupPath); log('restored backup'); }
          catch (e) { log('rollback failed:', e && e.message); }
        }
        // Record the rollback so the app can report 'rolled_back' to HQ (Phase 5).
        try { fs.writeFileSync(path.join(UP_DIR, 'last-rollback.json'), JSON.stringify({ from: pending.from, to: pending.to, ts: new Date().toISOString() })); } catch (e) {}
        clearPending();
        continue; // relaunch the restored build
      }
    }

    // Supervise until the child exits (normal restart, update-exit, or crash).
    const code = await new Promise((r) => child.once('exit', (c) => r(c)));
    await drained(child);
    if (readPending()) { continue; } // an update just applied → relaunch + verify
    if (code === EX_CONFIG) {
      log('server refused to start: a setting needs fixing (the reason is printed above). Not relaunching.');
      process.exit(EX_CONFIG);
    }
    const now = Date.now(); crashes = crashes.filter((t) => now - t < 60000); crashes.push(now);
    if (crashes.length >= 5) { log('server exited ' + crashes.length + 'x in 60s (last code ' + code + ') — stopping to avoid a crash loop.'); process.exit(1); }
    log('server exited (code ' + code + ') — relaunching');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

module.exports = { healthOnce, waitHealthy, restoreBackup, readPending, clearPending, PORT, DATA, HEALTH_PATH, VERIFY_TIMEOUT };

if (require.main === module) supervise();
