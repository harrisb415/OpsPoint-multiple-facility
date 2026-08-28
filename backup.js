// ═══════════════════════════════════════════════════════════════════════
//  Scheduled database backup
//
//  HIPAA §164.308(a)(7)(ii)(A) — Data Backup Plan — is a REQUIRED
//  implementation specification, not an addressable one. `data/opspoint.db`
//  is the sole copy of every clinical note, consent record, and audit row,
//  so losing it is unrecoverable.
//
//  Uses SQLite's online backup API via db.backupTo(), which is safe against
//  a live WAL-mode database. A plain file copy is NOT safe without first
//  checkpointing, because committed pages can still be sitting in the -wal
//  sidecar.
//
//  Settings (all overridable through the settings table):
//    backup_enabled        default true
//    backup_interval_hours default 6
//    backup_keep           default 28   (~1 week at 6h; tune with interval)
//    backup_dir            default <data>/backups/scheduled
//
//  IMPORTANT: the default directory sits on the same volume as the database,
//  which protects against accidental deletion and bad migrations but NOT
//  against drive failure. Point backup_dir at a different physical device
//  (or sync it off the box) for that. runOnce() logs a warning when the
//  destination shares a root with the database.
// ═══════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

let _timer   = null;
let _running = false;

function _stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
         `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function _dir(db) {
  const configured = db.getSetting('backup_dir', null);
  if (configured) return configured;
  return path.join(path.dirname(db.getDbPath()), 'backups', 'scheduled');
}

// Keep the N most recent backups; delete the rest. Never throws.
function _prune(dir, keep) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('opspoint-') && f.endsWith('.db'))
      .sort()
      .reverse();
    for (const stale of files.slice(keep)) {
      try { fs.unlinkSync(path.join(dir, stale)); } catch (e) { /* next sweep */ }
    }
    return Math.max(0, files.length - keep);
  } catch (e) { return 0; }
}

// Take one backup now. Resolves to the path written, or null on failure —
// never rejects, so a failing backup can't take the server down with it.
async function runOnce(db, { quiet = false } = {}) {
  if (_running) return null;              // don't stack if a run is slow
  _running = true;
  const started = Date.now();
  try {
    const dir  = _dir(db);
    const dest = path.join(dir, `opspoint-${_stamp()}.db`);

    await db.backupTo(dest);

    const bytes = fs.statSync(dest).size;
    const keep  = parseInt(db.getSetting('backup_keep', 28), 10) || 28;
    const pruned = _prune(dir, keep);

    if (!quiet) {
      const mb = (bytes / 1048576).toFixed(1);
      console.log(`  [backup] ${path.basename(dest)} — ${mb} MB in ${Date.now() - started}ms` +
                  (pruned ? ` (pruned ${pruned})` : ''));
    }

    // Same-volume warning: a backup beside the database survives mistakes,
    // not hardware failure. Say so rather than implying false safety.
    if (path.parse(path.resolve(dest)).root === path.parse(path.resolve(db.getDbPath())).root
        && !db.getSetting('backup_same_volume_ack', false)) {
      console.warn('  [backup] WARNING: backups are on the same volume as the database. ' +
                   'Set backup_dir to another device to survive a drive failure.');
    }

    try {
      db.auditLog(null, 'system', '127.0.0.1', 'backup.create', 'database', null,
                  path.basename(dest), { bytes, ms: Date.now() - started });
    } catch (e) { /* audit must never block a backup */ }

    return dest;
  } catch (e) {
    console.error('  [backup] FAILED:', e && e.message);
    try {
      db.auditLog(null, 'system', '127.0.0.1', 'backup.failed', 'database', null, '',
                  { error: String(e && e.message).slice(0, 300) });
    } catch (e2) { /* nothing more we can do */ }
    return null;
  } finally {
    _running = false;
  }
}

// Start the scheduler. Safe to call once at boot; a second call is a no-op.
function start(db) {
  if (_timer) return;
  if (!db.getSetting('backup_enabled', true)) {
    console.log('  [backup] disabled via backup_enabled setting');
    return;
  }

  const hours = Math.max(1, parseInt(db.getSetting('backup_interval_hours', 6), 10) || 6);
  const ms    = hours * 60 * 60 * 1000;

  // First backup shortly after boot rather than immediately — lets startup
  // finish and gives an install that crash-loops a chance to be stopped
  // before it churns through the retained generations.
  setTimeout(() => { runOnce(db); }, 90 * 1000);
  _timer = setInterval(() => { runOnce(db); }, ms);
  if (_timer.unref) _timer.unref();

  console.log(`  [backup] scheduled every ${hours}h → ${_dir(db)}`);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, runOnce };
