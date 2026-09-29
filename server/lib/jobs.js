'use strict';
/**
 * Background jobs report here each time they run, so the health check can tell
 * a timer that stopped (a crashed interval, a platform that throttles the CPU
 * of an idle container) from one that is simply between runs.
 *
 *   jobs.register('hq-sync', 20000, 'HQ sync')   when the job's timer starts
 *   jobs.beat('hq-sync')                          every time it runs
 *
 * In memory, per process; server/health/instances.js copies the snapshot into
 * the app_instances table every minute, so `opspoint doctor` in another
 * process sees it too.
 */
const _jobs = new Map();

function register(name, everyMs, label) {
  const prev = _jobs.get(name);
  _jobs.set(name, { label: label || name, everyMs, registeredAt: prev ? prev.registeredAt : Date.now(), lastRun: prev ? prev.lastRun : null });
}

function beat(name) {
  const j = _jobs.get(name);
  if (j) j.lastRun = Date.now();
}

// { name: { label, everyMs, registeredAt, lastRun } } — times as ms since epoch.
function snapshot() {
  const out = {};
  for (const [name, j] of _jobs) out[name] = { ...j };
  return out;
}

function _reset() { _jobs.clear(); }   // tests

module.exports = { register, beat, snapshot, _reset };
