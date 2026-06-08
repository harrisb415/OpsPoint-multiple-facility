'use strict';
/**
 * OpsPoint — Option B updater.
 *
 * Pull-based, integrity-checked, on-prem update mechanism:
 *   check()  — fetch the manifest, compare versions
 *   apply()  — download -> verify sha256 -> extract -> backup (db + code)
 *              -> swap runtime files -> (optional npm install) -> restart
 *   rollback() — restore code from the most recent backup, then restart
 *
 * Windows-only deployment: zip extraction uses the built-in `tar` (bsdtar)
 * with a PowerShell `Expand-Archive` fallback — no runtime npm dependency.
 *
 * Security:
 *   - manifest + download hosts are allow-listed (github.com / *.githubusercontent.com
 *     plus the configured manifest host); redirects only follow to allowed hosts
 *   - the downloaded bundle's sha256 (and size) MUST match the manifest or apply aborts
 *   - the extracted bundle is sanity-checked (server.js + client/dist/index.html present)
 *
 * No side effects on require — call createUpdater(ctx) to get an instance.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

// Host families always trusted for manifest + bundle downloads.
const ALLOWED_HOST_SUFFIXES = ['github.com', 'githubusercontent.com'];

// Pinned Ed25519 release public key. Bundles are signed at release time with the
// matching PRIVATE key, held offline by the vendor (scripts/release.mjs). apply()
// refuses any manifest without a valid signature over "version\nsize\nsha256", so
// a compromised manifest host or HQ relay cannot push code this node will install.
const RELEASE_PUBKEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAFtGFXRfmB1goFWdp+CGmv+LqC6LsQOdmCZe79038Y0U=
-----END PUBLIC KEY-----`;

// Runtime files/dirs that an update bundle may replace. `data/` and
// `node_modules/` are NEVER touched.
const RUNTIME_FILES = ['server.js', 'updater.js', 'db.js', 'package.json', 'package-lock.json'];
const RUNTIME_DIRS = ['migrations', path.join('client', 'dist')];

// ── semver compare (numeric core only; ignores pre-release tags) ──────
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

// Stream a GET, following redirects only to allow-listed hosts. `extraHeaders`
// lets callers attach auth (e.g. x-facility-key) when pulling from an HQ relay.
function _get(urlStr, allowHosts, redirectsLeft, cb, extraHeaders, insecure) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return cb(e); }
  if (!hostAllowed(urlStr, allowHosts)) return cb(new Error('Host not allowed: ' + u.host));
  const lib = u.protocol === 'http:' ? http : https;
  const headers = Object.assign({ 'User-Agent': 'OpsPoint-Updater' }, extraHeaders || {});
  const opts = { headers };
  if (insecure && u.protocol === 'https:') opts.rejectUnauthorized = false; // self-signed HQ on a trusted LAN
  const req = lib.get(urlStr, opts, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      if (redirectsLeft <= 0) return cb(new Error('Too many redirects'));
      const next = new URL(res.headers.location, urlStr).toString();
      return _get(next, allowHosts, redirectsLeft - 1, cb, extraHeaders, insecure);
    }
    if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode + ' for ' + u.host)); }
    cb(null, res);
  });
  req.on('error', cb);
  req.setTimeout(30000, () => req.destroy(new Error('Request timed out')));
}

// Fetch a small resource (manifest) into memory, capped.
function fetchBuffer(urlStr, allowHosts, maxBytes = 1024 * 1024, extraHeaders, insecure) {
  return new Promise((resolve, reject) => {
    _get(urlStr, allowHosts, 5, (err, res) => {
      if (err) return reject(err);
      const chunks = []; let len = 0;
      res.on('data', d => {
        len += d.length;
        if (len > maxBytes) { res.destroy(); return reject(new Error('Response too large')); }
        chunks.push(d);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }, extraHeaders, insecure);
  });
}

// Download a (potentially large) resource to disk, with progress callback.
function downloadToFile(urlStr, dest, allowHosts, onProgress, extraHeaders, insecure) {
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
    }, extraHeaders, insecure);
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

// Verify the manifest's Ed25519 signature over "version\nsize\nsha256" against the
// pinned public key. Returns true only on a valid signature. Because the signed
// payload includes the bundle sha256, a valid signature authenticates the bundle.
function verifyManifestSignature(m) {
  if (!m || !m.signature || !m.sha256 || !m.version) return false;
  try {
    const payload = Buffer.from(`${m.version}\n${m.size || 0}\n${String(m.sha256).toLowerCase()}`, 'utf8');
    const key = crypto.createPublicKey(RELEASE_PUBKEY_PEM);
    return crypto.verify(null, payload, key, Buffer.from(String(m.signature), 'base64'));
  } catch (e) { return false; }
}

// Extract a .zip on Windows: try bsdtar (built in since Win10 1803), then
// fall back to PowerShell Expand-Archive.
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    execFile('tar', ['-xf', zipPath, '-C', destDir], (err) => {
      if (!err) return resolve();
      const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], (err2) => {
        if (err2) return reject(new Error('Extraction failed: ' + (err2.message || err.message)));
        resolve();
      });
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
 * @param {string} ctx.baseDir   app root (server.js lives here)
 * @param {string} ctx.dataDir   writable data dir
 * @param {string} ctx.dbPath    path to opspoint.db
 * @param {object} ctx.db        db module (getSetting, query, run, auditLog)
 * @param {function} ctx.broadcast  WS broadcast(msg)
 * @param {function} ctx.restart    performs the spawn-detached + exit restart
 * @param {function} [ctx.log]
 */
function createUpdater(ctx) {
  const { baseDir, dataDir, dbPath, db, broadcast, restart } = ctx;
  const log = ctx.log || (() => {});
  // Optional: returns auth headers for a URL (e.g. x-facility-key when the
  // manifest/bundle is served by the HQ relay rather than a public host).
  const authFor = ctx.authFor || (() => ({}));
  // Optional: allow a self-signed cert for a URL (HQ relay on a trusted LAN).
  const insecureFor = ctx.insecureFor || (() => false);

  const UP_DIR = path.join(dataDir, 'updates');
  const STAGING = path.join(UP_DIR, 'staging');
  const BACKUP_DIR = path.join(UP_DIR, 'backup');
  const DB_BACKUP_DIR = path.join(dataDir, 'backups');

  let state = { phase: 'idle', pct: 0, message: '', error: null, applying: false, target: null };
  let lastManifest = null;
  let lastChecked = null;

  function setState(patch) {
    state = Object.assign({}, state, patch);
    try { broadcast({ type: 'update_progress', state: publicState() }); } catch (e) {}
  }
  function publicState() {
    return { phase: state.phase, pct: state.pct, message: state.message, error: state.error, applying: state.applying, target: state.target };
  }
  function currentVersion() {
    try { return require(path.join(baseDir, 'package.json')).version || '0.0.0'; }
    catch (e) { return '0.0.0'; }
  }
  function manifestUrl() { return (db.getSetting('update_manifest_url', '') || '').trim(); }
  function manifestHost() { try { return new URL(manifestUrl()).host; } catch (e) { return ''; } }

  async function fetchManifest() {
    const url = manifestUrl();
    if (!url) throw new Error('No update manifest URL configured');
    if (!hostAllowed(url, [manifestHost()])) throw new Error('Manifest host is not allow-listed');
    const buf = await fetchBuffer(url, [manifestHost()], 1024 * 1024, authFor(url), insecureFor(url));
    let m;
    try { m = JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error('Manifest is not valid JSON'); }
    if (!m || !m.version || !m.url || !m.sha256) throw new Error('Manifest missing version/url/sha256');
    lastManifest = m; lastChecked = new Date().toISOString();
    return m;
  }

  function summarize(m) {
    const cur = currentVersion();
    return {
      current: cur,
      latest: m.version,
      available: cmpSemver(m.version, cur) > 0,
      mandatory: !!m.mandatory,
      changelog: Array.isArray(m.changelog) ? m.changelog : [],
      released: m.released || null,
      size: m.size || null,
      min_node: m.min_node || null,
      signed: verifyManifestSignature(m),
    };
  }

  async function check() {
    const m = await fetchManifest();
    try { db.auditLog(null, 'system', '127.0.0.1', 'update.check', 'system', null, m.version, { current: currentVersion() }); } catch (e) {}
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

  // Background apply: drives state, ends in a restart. Throws are captured
  // into state so the polling client can surface them.
  async function apply(actorName) {
    if (state.applying) throw new Error('An update is already in progress');
    state = { phase: 'preflight', pct: 3, message: 'Preparing…', error: null, applying: true, target: null };
    setState({});
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
      const zipPath = path.join(STAGING, 'opspoint-' + ver + '.zip');
      rmrf(zipPath);
      await downloadToFile(m.url, zipPath, [manifestHost()], (got, total) => {
        if (total > 0) setState({ phase: 'download', pct: 12 + Math.round((got / total) * 28), message: 'Downloading v' + ver + '… ' + Math.round((got / total) * 100) + '%' });
      }, authFor(m.url), insecureFor(m.url));

      // 2. Verify
      setState({ phase: 'verify', pct: 44, message: 'Verifying checksum…' });
      if (m.size && fs.statSync(zipPath).size !== m.size) throw new Error('Downloaded size does not match manifest');
      const digest = await sha256File(zipPath);
      if (digest.toLowerCase() !== String(m.sha256).toLowerCase())
        throw new Error('Checksum mismatch — refusing to install (expected ' + m.sha256 + ', got ' + digest + ')');

      // Authenticity: the signed payload binds version+size+sha256, so a valid
      // signature over the verified hash proves the bundle came from the vendor.
      if (!verifyManifestSignature(m))
        throw new Error('Release signature missing or invalid — refusing to install. Bundle must be signed with the OpsPoint release key.');

      // 3. Extract + sanity-check the bundle
      setState({ phase: 'extract', pct: 54, message: 'Extracting…' });
      const stageDir = path.join(STAGING, ver);
      rmrf(stageDir);
      await extractZip(zipPath, stageDir);
      const root = _bundleRoot(stageDir);
      if (!fs.existsSync(path.join(root, 'server.js')) || !fs.existsSync(path.join(root, 'client', 'dist', 'index.html')))
        throw new Error('Bundle is missing server.js or client/dist — aborting');

      // 4. Backup current code + database
      setState({ phase: 'backup', pct: 68, message: 'Backing up current install…' });
      backupPath = path.join(BACKUP_DIR, cur + '_' + tsStamp());
      fs.mkdirSync(backupPath, { recursive: true });
      for (const f of RUNTIME_FILES) { const s = path.join(baseDir, f); if (fs.existsSync(s)) copyAny(s, path.join(backupPath, f)); }
      for (const d of RUNTIME_DIRS) { const s = path.join(baseDir, d); if (fs.existsSync(s)) copyAny(s, path.join(backupPath, d)); }
      fs.writeFileSync(path.join(backupPath, 'BACKUP.json'), JSON.stringify({ from: cur, to: ver, ts: new Date().toISOString() }, null, 2));
      fs.writeFileSync(path.join(UP_DIR, 'last-backup.txt'), backupPath);
      _backupDatabase(ver);

      // 5. Swap runtime files into place
      setState({ phase: 'swap', pct: 82, message: 'Applying files…' });
      for (const f of RUNTIME_FILES) { const s = path.join(root, f); if (fs.existsSync(s)) copyAny(s, path.join(baseDir, f)); }
      for (const d of RUNTIME_DIRS) { const s = path.join(root, d); if (fs.existsSync(s)) { rmrf(path.join(baseDir, d)); copyAny(s, path.join(baseDir, d)); } }

      // 6. Dependencies — only if the lockfile changed
      const oldLock = path.join(backupPath, 'package-lock.json');
      const newLock = path.join(baseDir, 'package-lock.json');
      if (_changed(oldLock, newLock)) {
        setState({ phase: 'deps', pct: 90, message: 'Updating dependencies…' });
        await _npmInstall();
      }

      // 7. Done — record + restart
      fs.writeFileSync(path.join(UP_DIR, 'last-applied.json'), JSON.stringify({ from: cur, to: ver, ts: new Date().toISOString(), by: actorName || 'system' }, null, 2));
      // Tell the bootstrap supervisor to health-check this boot and auto-roll-back on failure.
      fs.writeFileSync(path.join(UP_DIR, 'pending-verify.json'), JSON.stringify({ backupPath, from: cur, to: ver, ts: new Date().toISOString() }, null, 2));
      try { db.auditLog(null, actorName || 'system', '127.0.0.1', 'update.apply', 'system', null, cur + ' -> ' + ver, { backup: backupPath }); db.save && db.save(); } catch (e) {}
      setState({ phase: 'done', pct: 100, message: 'Updated to v' + ver + ' — restarting…', applying: false });
      try { broadcast({ type: 'update_done', from: cur, to: ver }); } catch (e) {}
      try { broadcast({ type: 'server_restarting', user: actorName || 'updater' }); } catch (e) {}
      setTimeout(() => { try { restart && restart(); } catch (e) {} }, 800);
      return { ok: true, from: cur, to: ver };
    } catch (e) {
      log('update apply failed:', e && e.message);
      setState({ phase: 'error', message: 'Update failed', error: (e && e.message) || String(e), applying: false });
      try { broadcast({ type: 'update_error', error: (e && e.message) || String(e) }); } catch (er) {}
      try { db.auditLog(null, actorName || 'system', '127.0.0.1', 'update.error', 'system', null, (e && e.message) || '', {}); } catch (er) {}
      throw e;
    }
  }

  // Restore code from the most recent backup, then restart. DB is left as-is
  // (migrations are additive/idempotent); the pre-update DB copy remains in
  // data/backups/ for manual restore if ever needed.
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
    try { db.auditLog(null, actorName || 'system', '127.0.0.1', 'update.rollback', 'system', null, (meta.to || '?') + ' -> ' + (meta.from || '?'), {}); db.save && db.save(); } catch (e) {}
    setState({ phase: 'done', pct: 100, message: 'Rolled back — restarting…', applying: false });
    try { broadcast({ type: 'server_restarting', user: actorName || 'updater' }); } catch (e) {}
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

  // ── internals ──────────────────────────────────────────────────────
  // Some zips wrap everything in a top-level folder; detect it.
  function _bundleRoot(dir) {
    if (fs.existsSync(path.join(dir, 'server.js'))) return dir;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const e of entries) {
      const sub = path.join(dir, e.name);
      if (fs.existsSync(path.join(sub, 'server.js'))) return sub;
    }
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
      try { db.run && db.run('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) {}
      if (fs.existsSync(dbPath)) {
        const out = path.join(DB_BACKUP_DIR, 'opspoint-' + tsStamp() + '-pre-' + ver + '.db');
        fs.copyFileSync(dbPath, out);
      }
    } catch (e) { log('db backup failed:', e && e.message); }
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

module.exports = { createUpdater, cmpSemver, hostAllowed, verifyManifestSignature, RELEASE_PUBKEY_PEM };
