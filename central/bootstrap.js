'use strict';
/**
 * OpsPoint Central launcher + auto-rollback supervisor (HQ tier).
 * Mirror of the facility bootstrap.js, scoped to central (port 4000, CENTRAL_DATA).
 * run.bat runs THIS instead of `node server.js`.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.OPSPOINT_BOOTSTRAP_BASE || __dirname;
const DATA = process.env.OPSPOINT_BOOTSTRAP_DATA || process.env.CENTRAL_DATA || path.join(BASE, 'data');
const ENTRY = process.env.OPSPOINT_BOOTSTRAP_ENTRY || path.join(BASE, 'server.js');
const PORT = parseInt(process.env.PORT || '4000', 10);
const HEALTH_PATH = process.env.OPSPOINT_HEALTH_PATH || '/api/health';
const VERIFY_TIMEOUT = parseInt(process.env.OPSPOINT_VERIFY_TIMEOUT || '90000', 10);
const UP_DIR = path.join(DATA, 'updates');
const PENDING = path.join(UP_DIR, 'pending-verify.json');

function log(...a) { console.log('[central-bootstrap]', ...a); }

function healthOnce(cb) {
  const useHttps = fs.existsSync(path.join(DATA, 'cert.pem')) && fs.existsSync(path.join(DATA, 'key.pem'));
  const lib = useHttps ? require('https') : require('http');
  const opts = { host: '127.0.0.1', port: PORT, path: HEALTH_PATH, timeout: 4000 };
  if (useHttps) opts.rejectUnauthorized = false;
  const req = lib.get(opts, (res) => { res.resume(); cb(res.statusCode >= 200 && res.statusCode < 500); });
  req.on('error', () => cb(false));
  req.on('timeout', () => { req.destroy(); cb(false); });
}
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
      if (healthy) { clearPending(); log('update verified — running v' + (pending.to || '?')); }
      else {
        log('new build failed health check — rolling back to v' + (pending.from || '?'));
        try { child.kill(); } catch (e) {}
        await whenExited(child);
        if (pending.backupPath && fs.existsSync(pending.backupPath)) {
          try { restoreBackup(pending.backupPath); log('restored backup'); }
          catch (e) { log('rollback failed:', e && e.message); }
        }
        clearPending();
        continue;
      }
    }
    const code = await new Promise((r) => child.once('exit', (c) => r(c)));
    if (readPending()) { continue; }
    const now = Date.now(); crashes = crashes.filter((t) => now - t < 60000); crashes.push(now);
    if (crashes.length >= 5) { log('server exited ' + crashes.length + 'x in 60s (last code ' + code + ') — stopping to avoid a crash loop.'); process.exit(1); }
    log('server exited (code ' + code + ') — relaunching');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

module.exports = { healthOnce, waitHealthy, restoreBackup, readPending, clearPending };

if (require.main === module) supervise();
