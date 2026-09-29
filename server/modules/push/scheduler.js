'use strict';
/**
 * Timed alerts: a wellness check or walkthrough coming due (10 minutes ahead)
 * or overdue, and a resident still out after a pass's return time. tick() runs
 * once a minute in the listening process (server.js); tests call it directly
 * with a fixed clock.
 *
 * Due/overdue follows the same schedule and log-entry rules as the desktop
 * reminder banner (server/lib/schedule.js). What was sent is remembered in the
 * push_sent setting, so a restart doesn't repeat an alert, and anything more
 * than a few hours stale is dropped rather than announced late.
 */
const db = require('../../../db');
const c = require('../../db/connection');
const reportLog = require('../../db/reportLog');
const { mostRecentLogTime, scheduledStatus, fmtClock } = require('../../lib/schedule');
const push = require('./service');
const jobs = require('../../lib/jobs');

const SOON_MS = 10 * 60000;
const STALE_MS = 3 * 3600000;
const PASS_STALE_MS = 12 * 3600000;

// Local 'YYYY-MM-DDTHH:MM' — one scheduled slot.
function slot(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function tick(now = new Date()) {
  if (!push.status().enabled) return [];
  const sent = (await db.getSetting('push_sent', {})) || {};
  const vis = (await db.getSetting('ui_visibility', {})) || {};
  const fired = [];
  async function fire(key, type, message) {
    if (sent[key]) return;
    sent[key] = now.toISOString();
    fired.push(key);
    await push.notify(type, message);
  }

  const reportId = await reportLog.getActiveReportId();
  const report = reportId ? await c.query1('SELECT id, is_closed FROM reports WHERE id=?', [reportId]) : null;
  if (report && !report.is_closed) {
    const entries = await c.query('SELECT time, text FROM log_entries WHERE report_id=?', [report.id]);
    const kinds = [
      { type: 'due',  keyword: 'wellness check', key: 'wellness_schedule', noun: 'Wellness check', url: '/m/rounds',           on: vis.buttons?.wellness !== false },
      { type: 'walk', keyword: 'walkthrough',    key: 'walk_schedule',     noun: 'Walkthrough',    url: '/m/rounds?view=walk', on: vis.buttons?.walkthrough !== false },
    ];
    for (const k of kinds) {
      if (!k.on) continue;
      const last = mostRecentLogTime(entries, k.keyword, now);
      const st = scheduledStatus(last, await db.getSetting(k.key, []), now);
      if (!st) continue;
      const doneEarly = last && st.nextTime && last >= new Date(st.nextTime.getTime() - 15 * 60000);
      if (st.nextTime && st.nextTime - now <= SOON_MS && !doneEarly) {
        await fire(`${k.type}:soon:${slot(st.nextTime)}`, k.type, { body: `${k.noun} due at ${fmtClock(st.nextTime)}.`, url: k.url });
      }
      if (st.status === 'overdue' && now - st.overdueAt <= STALE_MS) {
        await fire(`${k.type}:late:${slot(st.overdueAt)}`, k.type, { body: `${k.noun} overdue since ${fmtClock(st.overdueAt)}.`, url: k.url });
      }
    }
  }

  if (vis.tabs?.passes !== false) {
    for (const p of await c.query("SELECT id, return_date FROM passes WHERE status IN ('Out','Extended')")) {
      const due = Date.parse(p.return_date);
      if (!Number.isFinite(due) || due > now.getTime() || now.getTime() - due > PASS_STALE_MS) continue;
      await fire(`pass:${p.id}:${p.return_date}`, 'pass_late', { body: 'A resident is late back from a pass.', url: '/m/' });
    }
  }

  if (fired.length) {
    const cutoff = now.getTime() - 48 * 3600000;
    for (const [k, v] of Object.entries(sent)) if (Date.parse(v) < cutoff) delete sent[k];
    await db.setSetting('push_sent', sent);
  }
  return fired;
}

let _timer = null;
function start() {
  if (_timer) return;
  jobs.register('push-scheduler', 60000, 'Push alert scheduler');
  _timer = setInterval(async () => {
    try { await tick(); } catch (e) { console.error('[push] scheduler:', e.message); }
    jobs.beat('push-scheduler');   // after the run: one that hangs stops beating
  }, 60000);
  if (_timer.unref) _timer.unref();
}

module.exports = { tick, start };
