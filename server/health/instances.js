'use strict';
/**
 * The row each running server keeps in app_instances: which machine and
 * process it is, its version, and when each background job last ran
 * (server/lib/jobs.js). Written at start and every minute, so the health check
 * — in this process or in `opspoint doctor` — sees stalled timers and a second
 * instance.
 *
 * A clean stop (SIGTERM from a platform, SIGINT from PM2 or Ctrl+C) takes the
 * row with it. A crash leaves it behind: the next start on the same machine
 * removes rows whose process is gone, and any row silent for an hour is pruned.
 */
const os = require('os');
const crypto = require('crypto');
const jobs = require('../lib/jobs');

const EVERY_MS = 60 * 1000;
const LIVE_MS = 150 * 1000;          // two missed beats and then some
const PRUNE_MS = 60 * 60 * 1000;

const INSTANCE_ID = crypto.randomUUID();
const STARTED_AT = new Date().toISOString();

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

async function write(conn, { app = 'facility', version = '' } = {}) {
  await conn.run(
    `INSERT INTO app_instances (instance_id, app, hostname, pid, version, started_at, last_seen, jobs)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (instance_id) DO UPDATE SET last_seen=excluded.last_seen, jobs=excluded.jobs, version=excluded.version`,
    [INSTANCE_ID, app, os.hostname(), process.pid, String(version || ''), STARTED_AT, new Date().toISOString(),
      JSON.stringify(jobs.snapshot())]);
}

// Rows a crash left behind: silent for an hour, or on this machine with a
// process that no longer exists.
async function cleanup(conn, app = 'facility') {
  await conn.run('DELETE FROM app_instances WHERE last_seen < ?', [new Date(Date.now() - PRUNE_MS).toISOString()]);
  const rows = await conn.query('SELECT instance_id, pid FROM app_instances WHERE hostname=? AND app=? AND instance_id<>?',
    [os.hostname(), app, INSTANCE_ID]);
  for (const r of rows) {
    if (!pidAlive(Number(r.pid))) await conn.run('DELETE FROM app_instances WHERE instance_id=?', [r.instance_id]);
  }
}

function parseJobs(text) {
  try { const j = JSON.parse(text || '{}'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; }
}

// Every row for the app, newest first, with `live` = heard from recently.
async function list(conn, app = 'facility', now = Date.now()) {
  const rows = await conn.query('SELECT * FROM app_instances WHERE app=? ORDER BY last_seen DESC', [app]);
  return rows.map((r) => {
    const seen = Date.parse(r.last_seen);
    return {
      id: r.instance_id, hostname: r.hostname, pid: Number(r.pid), version: r.version,
      startedAt: r.started_at, lastSeen: r.last_seen, live: Number.isFinite(seen) && now - seen <= LIVE_MS,
      jobs: parseJobs(r.jobs), self: r.instance_id === INSTANCE_ID,
    };
  });
}

let _timer = null;
let _opts = null;
let _conn = null;

// Start this process's heartbeat. Never throws: the health check reports a
// heartbeat that isn't arriving, the server keeps serving.
async function start(conn, opts = {}) {
  if (_timer) return;
  _conn = conn; _opts = opts;
  try { await cleanup(conn, opts.app); } catch (e) { /* the table may be missing: the health check says so */ }
  await beatNow();
  _timer = setInterval(() => { beatNow(); }, EVERY_MS);
  if (_timer.unref) _timer.unref();

  const stop = (signal) => {
    const exit = () => process.exit(0);
    setTimeout(exit, 1000).unref();          // never let a slow database hold up a stop
    remove().then(exit, exit);
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  // A plain process.exit (restart, update) can only clean up synchronously,
  // which the SQLite driver is; on Postgres the next start or the prune does it.
  process.once('exit', () => { if (!conn.isPg) { try { conn.run('DELETE FROM app_instances WHERE instance_id=?', [INSTANCE_ID]); } catch (e) { /* closing */ } } });
}

async function beatNow() {
  if (!_conn) return false;
  try { await write(_conn, _opts); return true; }
  catch (e) { console.error('[health] heartbeat:', e.message); return false; }
}

async function remove() {
  if (!_conn) return;
  try { await _conn.run('DELETE FROM app_instances WHERE instance_id=?', [INSTANCE_ID]); } catch (e) { /* closing */ }
}

module.exports = { start, beatNow, list, cleanup, write, INSTANCE_ID, LIVE_MS, EVERY_MS, _pidAlive: pidAlive };
