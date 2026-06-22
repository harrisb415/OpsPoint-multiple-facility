'use strict';
/**
 * OpsPoint Central — self-updater (HQ tier).
 *
 * Same model as the facility updater.js, scoped to the central server:
 *   check()  — fetch the central manifest, compare versions
 *   apply()  — download -> verify sha256 + Ed25519 signature -> extract
 *              -> backup (central.db + code) -> swap runtime files
 *              -> (optional npm install) -> restart
 *   rollback() — restore code from the most recent backup, then restart
 *
 * Differences from the facility updater:
 *   - runtime payload is server.js/db.js/updater.js/package*.json + client/dist/
 *     (the Vite-built console UI; no migrations dir)
 *   - bundle is sanity-checked for server.js + client/dist/index.html
 *   - no WebSocket: progress is read by the console polling status()
 *
 * Security: download hosts are allow-listed; the bundle's sha256 AND a vendor
 * Ed25519 signature over "version\nsize\nsha256" MUST verify against the pinned
 * key below, or apply() aborts. The pinned key is identical to the facility's.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const ALLOWED_HOST_SUFFIXES = ['github.com', 'githubusercontent.com'];

// Pinned Ed25519 release public key (same key the facility updater pins).
const RELEASE_PUBKEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAX0QuuIYyg9EvdxNF0BsNdA6KCbk+wu1u2Ec2m72YXlE=
-----END PUBLIC KEY-----`;

// Central runtime files/dirs an update bundle may replace. data/ and
// node_modules/ are NEVER touched.
const RUNTIME_FILES = ['server.js', 'db.js', 'updater.js', 'package.json', 'package-lock.json'];
const RUNTIME_DIRS = ['client/dist'];

function cmpSemver(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function hostAllowed(urlStr, extra = []) {
  let h;
  try { h = new URL(urlStr).host.toLowerCase(); } catch { return false; }
  const suffixes = ALLOWED_HOST_SUFFIXES.concat(extra.filter(Boolean).map(s => String(s).toLowerCase()));
  return suffixes.some(s => h === s || h.endsWith('.' + s));
}

function _get(urlStr, allowHosts, redirectsLeft, cb) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return cb(e); }
  if (!hostAllowed(urlStr, allowHosts)) return cb(new Error('Host not allowed: ' + u.host));
  const lib = u.protocol === 'http:' ? http : https;
  const req = lib.get(urlStr, { headers: { 'User-Agent': 'OpsPoint-Central-Updater' } }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      if (redirectsLeft <= 0) return cb(new Error('Too many redirects'));
      const next = new URL(res.headers.location, urlStr).toString();
      return _get(next, allowHosts, redirectsLeft - 1, cb);
    }
    if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode + ' for ' + u.host)); }
    cb(null, res);
  });
  req.on('error', cb);
  req.setTimeout(30000, () => req.destroy(new Error('Request timed out')));
}

function fetchBuffer(urlStr, allowHosts, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    _get(urlStr, allowHosts, 5, (err, res) => {
      if (err) return reject(err);
      const chunks = []; let len = 0;
      res.on('data', d => { len += d.length; if (len > maxBytes) { res.destroy(); return reject(new Error('Response too large')); } chunks.push(d); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  });
}

function downloadToFile(urlStr, dest, allowHosts, onProgress) {
  return new Promise((resolve, reject) => {
    _get(urlStr, allowHosts, 5, (err, res) => {
      if (err) return reject(err);
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', d => { got += d.length; if (onProgress) onProgress(got, total); });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve({ bytes: got }));
      res.pipe(out);
    });
  });
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

function verifyManifestSignature(m) {
  if (!m || !m.signature || !m.sha256 || !m.version) return false;
  try {
    const payload = Buffer.from(`${m.version}\n${m.size || 0}\n${String(m.sha256).toLowerCase()}`, 'utf8');
    const key = crypto.createPublicKey(RELEASE_PUBKEY_PEM);
    return crypto.verify(null, payload, key, Buffer.from(String(m.signature), 'base64'));
  } catch (e) { return false; }
}

// Cross-platform extract: tar -xf handles .tar.gz everywhere; per-OS fallback.
function extractZip(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    execFile('tar', ['-xf', archivePath, '-C', destDir], (err) => {
      if (!err) return resolve();
      if (process.platform === 'win32') {
        const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
        return execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], (e2) =>
          e2 ? reject(new Error('Extraction failed: ' + (e2.message || err.message))) : resolve());
      }
      execFile('unzip', ['-o', '-q', archivePath, '-d', destDir], (e2) =>
        e2 ? reject(new Error('Extraction failed (tar: ' + (err.message || '') + '; unzip: ' + (e2.message || '') + ')')) : resolve());
    });
  });
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }
function copyAny(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) fs.cpSync(src, dest, { recursive: true, force: true });
  else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
}
function tsStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

/**
 * @param {object} ctx
 * @param {string} ctx.baseDir    central app root (this file lives here)
 * @param {string} ctx.dataDir    central data dir
 * @param {string} ctx.dbPath     path to central.db
 * @param {function} ctx.getSetting (key, def) => value
 * @param {function} ctx.audit     ({actor,action,target,detail}) => void
 * @param {function} ctx.restart   spawn-detached + exit restart
 * @param {function} [ctx.log]
 */
function createUpdater(ctx) {
  const { baseDir, dataDir, dbPath, getSetting, audit, restart } = ctx;
  const log = ctx.log || (() => {});

  const UP_DIR = path.join(dataDir, 'updates');
  const STAGING = path.join(UP_DIR, 'staging');
  const BACKUP_DIR = path.join(UP_DIR, 'backup');
  const DB_BACKUP_DIR = path.join(dataDir, 'backups');

  let state = { phase: 'idle', pct: 0, message: '', error: null, applying: false, target: null };
  let lastManifest = null;
  let lastChecked = null;

  function setState(patch) { state = Object.assign({}, state, patch); }
  function publicState() {
    return { phase: state.phase, pct: state.pct, message: state.message, error: state.error, applying: state.applying, target: state.target };
  }
  function currentVersion() {
    try { return require(path.join(baseDir, 'package.json')).version || '0.0.0'; }
    catch (e) { return '0.0.0'; }
  }
  function _audit(action, detail) { try { audit && audit({ actor: 'system', action, target: 'central', detail: detail || '' }); } catch (e) {} }
  function manifestUrl() { return String(getSetting('central_update_manifest_url', '') || '').trim(); }
  function manifestHost() { try { return new URL(manifestUrl()).host; } catch (e) { return ''; } }

  async function fetchManifest() {
    const url = manifestUrl();
    if (!url) throw new Error('No central update manifest URL configured');
    if (!hostAllowed(url, [manifestHost()])) throw new Error('Manifest host is not allow-listed');
    const buf = await fetchBuffer(url, [manifestHost()]);
    let m;
    try { m = JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error('Manifest is not valid JSON'); }
    if (!m || !m.version || !m.url || !m.sha256) throw new Error('Manifest missing version/url/sha256');
    lastManifest = m; lastChecked = new Date().toISOString();
    return m;
  }

  function summarize(m) {
    const cur = currentVersion();
    return {
      current: cur, latest: m.version,
      available: cmpSemver(m.version, cur) > 0,
      mandatory: !!m.mandatory,
      changelog: Array.isArray(m.changelog) ? m.changelog : [],
      released: m.released || null, size: m.size || null,
      min_node: m.min_node || null,
      signed: verifyManifestSignature(m),
    };
  }

  async function check() {
    const m = await fetchManifest();
    _audit('update.check', currentVersion() + ' -> ' + m.version);
    return summarize(m);
  }

  function status() {
    return {
      current: currentVersion(),
      latest: lastManifest ? lastManifest.version : null,
      available: lastManifest ? cmpSemver(lastManifest.version, currentVersion()) > 0 : false,
      mandatory: lastManifest ? !!lastManifest.mandatory : false,
      changelog: lastManifest && Array.isArray(lastManifest.changelog) ? lastManifest.changelog : [],
      signed: lastManifest ? verifyManifestSignature(lastManifest) : false,
      lastChecked,
      progress: publicState(),
    };
  }

  async function apply(actorName) {
    if (state.applying) throw new Error('An update is already in progress');
    state = { phase: 'preflight', pct: 3, message: 'Preparing…', error: null, applying: true, target: null };
    let backupPath = null;
    try {
      const cur = currentVersion();
      const m = await fetchManifest();
      const ver = m.version;
      setState({ target: ver });

      if (cmpSemver(ver, cur) <= 0) throw new Error('No newer version available (current ' + cur + ')');
      if (m.min_node && cmpSemver(process.versions.node, m.min_node) < 0)
        throw new Error('Requires Node ' + m.min_node + ' (this box has ' + process.versions.node + ')');
      if (m.min_from && cmpSemver(cur, m.min_from) < 0)
        throw new Error('Cannot update directly from ' + cur + '; minimum is ' + m.min_from);
      if (!hostAllowed(m.url, [manifestHost()])) throw new Error('Bundle host is not allow-listed');

      fs.mkdirSync(STAGING, { recursive: true });
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });

      // 1. Download
      setState({ phase: 'download', pct: 12, message: 'Downloading v' + ver + '…' });
      const zipPath = path.join(STAGING, 'opscentral-' + ver + '.tgz');
      rmrf(zipPath);
      await downloadToFile(m.url, zipPath, [manifestHost()], (got, total) => {
        if (total > 0) setState({ phase: 'download', pct: 12 + Math.round((got / total) * 28), message: 'Downloading v' + ver + '… ' + Math.round((got / total) * 100) + '%' });
      });

      // 2. Verify checksum + signature
      setState({ phase: 'verify', pct: 44, message: 'Verifying checksum…' });
      if (m.size && fs.statSync(zipPath).size !== m.size) throw new Error('Downloaded size does not match manifest');
      const digest = await sha256File(zipPath);
      if (digest.toLowerCase() !== String(m.sha256).toLowerCase())
        throw new Error('Checksum mismatch — refusing to install (expected ' + m.sha256 + ', got ' + digest + ')');
      setState({ phase: 'verify', pct: 48, message: 'Verifying signature…' });
      if (!verifyManifestSignature(m))
        throw new Error('Release signature missing or invalid — refusing to install. Bundle must be signed with the OpsPoint release key.');

      // 3. Extract + sanity-check
      setState({ phase: 'extract', pct: 54, message: 'Extracting…' });
      const stageDir = path.join(STAGING, ver);
      rmrf(stageDir);
      await extractZip(zipPath, stageDir);
      const root = _bundleRoot(stageDir);
      if (!fs.existsSync(path.join(root, 'server.js')) || !fs.existsSync(path.join(root, 'client', 'dist', 'index.html')))
        throw new Error('Bundle is missing server.js or client/dist/index.html — aborting');

      // 4. Backup current code + database
      setState({ phase: 'backup', pct: 68, message: 'Backing up current install…' });
      backupPath = path.join(BACKUP_DIR, cur + '_' + tsStamp());
      fs.mkdirSync(backupPath, { recursive: true });
      for (const f of RUNTIME_FILES) { const s = path.join(baseDir, f); if (fs.existsSync(s)) copyAny(s, path.join(backupPath, f)); }
      for (const d of RUNTIME_DIRS) { const s = path.join(baseDir, d); if (fs.existsSync(s)) copyAny(s, path.join(backupPath, d)); }
      fs.writeFileSync(path.join(backupPath, 'BACKUP.json'), JSON.stringify({ from: cur, to: ver, ts: new Date().toISOString() }, null, 2));
      fs.writeFileSync(path.join(UP_DIR, 'last-backup.txt'), backupPath);
      _backupDatabase(ver);

      // 5. Swap runtime files
      setState({ phase: 'swap', pct: 82, message: 'Applying files…' });
      for (const f of RUNTIME_FILES) { const s = path.join(root, f); if (fs.existsSync(s)) copyAny(s, path.join(baseDir, f)); }
      for (const d of RUNTIME_DIRS) { const s = path.join(root, d); if (fs.existsSync(s)) { rmrf(path.join(baseDir, d)); copyAny(s, path.join(baseDir, d)); } }

      // 6. Dependencies — only if the lockfile changed
      if (_changed(path.join(backupPath, 'package-lock.json'), path.join(baseDir, 'package-lock.json'))) {
        setState({ phase: 'deps', pct: 90, message: 'Updating dependencies…' });
        await _npmInstall();
      }

      // 7. Done — record + restart
      fs.writeFileSync(path.join(UP_DIR, 'last-applied.json'), JSON.stringify({ from: cur, to: ver, ts: new Date().toISOString(), by: actorName || 'system' }, null, 2));
      // Tell the bootstrap supervisor to health-check this boot and auto-roll-back on failure.
      fs.writeFileSync(path.join(UP_DIR, 'pending-verify.json'), JSON.stringify({ backupPath, from: cur, to: ver, ts: new Date().toISOString() }, null, 2));
      _audit('update.apply', cur + ' -> ' + ver);
      setState({ phase: 'done', pct: 100, message: 'Updated to v' + ver + ' — restarting…', applying: false });
      setTimeout(() => { try { restart && restart(); } catch (e) {} }, 800);
      return { ok: true, from: cur, to: ver };
    } catch (e) {
      log('central update apply failed:', e && e.message);
      setState({ phase: 'error', message: 'Update failed', error: (e && e.message) || String(e), applying: false });
      _audit('update.error', (e && e.message) || '');
      throw e;
    }
  }

  async function rollback(actorName) {
    const ptrFile = path.join(UP_DIR, 'last-backup.txt');
    if (!fs.existsSync(ptrFile)) throw new Error('No backup recorded to roll back to');
    const backupPath = fs.readFileSync(ptrFile, 'utf8').trim();
    if (!backupPath || !fs.existsSync(backupPath)) throw new Error('Recorded backup folder is missing');
    setState({ phase: 'rollback', pct: 30, message: 'Restoring previous version…', error: null, applying: true });
    for (const f of RUNTIME_FILES) { const s = path.join(backupPath, f); if (fs.existsSync(s)) copyAny(s, path.join(baseDir, f)); }
    for (const d of RUNTIME_DIRS) { const s = path.join(backupPath, d); if (fs.existsSync(s)) { rmrf(path.join(baseDir, d)); copyAny(s, path.join(baseDir, d)); } }
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(backupPath, 'BACKUP.json'), 'utf8')); } catch (e) {}
    try { fs.rmSync(path.join(UP_DIR, 'pending-verify.json'), { force: true }); } catch (e) {} // manual rollback: don't re-verify
    _audit('update.rollback', (meta.to || '?') + ' -> ' + (meta.from || '?'));
    setState({ phase: 'done', pct: 100, message: 'Rolled back — restarting…', applying: false });
    setTimeout(() => { try { restart && restart(); } catch (e) {} }, 800);
    return { ok: true, restored: meta.from || null };
  }

  function backups() {
    try {
      return fs.readdirSync(BACKUP_DIR).filter(n => fs.existsSync(path.join(BACKUP_DIR, n, 'BACKUP.json')))
        .map(n => { let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, n, 'BACKUP.json'), 'utf8')); } catch (e) {} return { id: n, from: m.from, to: m.to, ts: m.ts }; })
        .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    } catch (e) { return []; }
  }

  function _bundleRoot(dir) {
    if (fs.existsSync(path.join(dir, 'server.js'))) return dir;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const e of entries) { const sub = path.join(dir, e.name); if (fs.existsSync(path.join(sub, 'server.js'))) return sub; }
    return dir;
  }
  function _changed(a, b) {
    try {
      if (!fs.existsSync(a) || !fs.existsSync(b)) return true;
      return crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex') !==
             crypto.createHash('sha256').update(fs.readFileSync(b)).digest('hex');
    } catch (e) { return true; }
  }
  function _backupDatabase(ver) {
    try {
      if (fs.existsSync(dbPath)) {
        const out = path.join(DB_BACKUP_DIR, 'central-' + tsStamp() + '-pre-' + ver + '.db');
        fs.copyFileSync(dbPath, out);
      }
    } catch (e) { log('central db backup failed:', e && e.message); }
  }
  function _npmInstall() {
    return new Promise((resolve, reject) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const child = spawn(npmCmd, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: baseDir, stdio: 'ignore', shell: process.platform === 'win32' });
      const killer = setTimeout(() => { try { child.kill(); } catch (e) {} reject(new Error('npm install timed out')); }, 5 * 60 * 1000);
      child.on('error', e => { clearTimeout(killer); reject(e); });
      child.on('exit', code => { clearTimeout(killer); code === 0 ? resolve() : reject(new Error('npm install exited ' + code)); });
    });
  }

  return { check, apply, rollback, status, backups, currentVersion };
}

module.exports = { createUpdater, cmpSemver, hostAllowed, verifyManifestSignature, RELEASE_PUBKEY_PEM, fetchBuffer, downloadToFile, sha256File };
