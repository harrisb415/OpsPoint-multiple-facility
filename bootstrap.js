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
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.OPSPOINT_BOOTSTRAP_BASE || __dirname;
const DATA = process.env.OPSPOINT_DATA || path.join(BASE, 'data');
const ENTRY = process.env.OPSPOINT_BOOTSTRAP_ENTRY || path.join(BASE, 'server.js');
const PORT = parseInt(process.env.PORT || '3000', 10);
const HEALTH_PATH = process.env.OPSPOINT_HEALTH_PATH || '/api/health';
const VERIFY_TIMEOUT = parseInt(process.env.OPSPOINT_VERIFY_TIMEOUT || '90000', 10);
const UP_DIR = path.join(DATA, 'updates');
const PENDING = path.join(UP_DIR, 'pending-verify.json');

function log(...a) { console.log('[bootstrap]', ...a); }

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
function launch() { return spawn(process.execPath, [ENTRY], { cwd: BASE, stdio: 'inherit', env: Object.assign({}, process.env, { OPSPOINT_BOOTSTRAP: '1' }) }); }

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
    if (readPending()) { continue; } // an update just applied → relaunch + verify
    const now = Date.now(); crashes = crashes.filter((t) => now - t < 60000); crashes.push(now);
    if (crashes.length >= 5) { log('server exited ' + crashes.length + 'x in 60s (last code ' + code + ') — stopping to avoid a crash loop.'); process.exit(1); }
    log('server exited (code ' + code + ') — relaunching');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

module.exports = { healthOnce, waitHealthy, restoreBackup, readPending, clearPending };

if (require.main === module) supervise();
