'use strict';
/**
 * Wellness / walkthrough schedule — the server's copy of the desktop reminder
 * rules in client/src/pages/ReportTab.jsx (calcScheduledStatus,
 * getMostRecentLogTime), so a push alert fires on exactly the schedule the
 * desktop banner shows. Keep the two in step.
 *
 * The schedule is a list of 'HH:MM' times each day (Admin -> Facility ->
 * Reminders). A check is overdue once a scheduled time has passed with no
 * matching log entry since. Everything reads the server's local time, which is
 * why hosted installs set TZ.
 */

// 'h:mm AM/PM' (a log entry's time) -> a Date today, or yesterday when that
// would put it more than 30 minutes in the future: the 11:50 PM entry read at
// 12:10 AM belongs to last night.
function parseLogTime(timeStr, now = new Date()) {
  const m = String(timeStr || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'AM' && h === 12) h = 0;
  if (ap === 'PM' && h !== 12) h += 12;
  const d = new Date(now);
  d.setHours(h, mn, 0, 0);
  if (d.getTime() > now.getTime() + 30 * 60000) d.setDate(d.getDate() - 1);
  return d;
}

// The newest log entry whose text mentions `keyword`, as a Date.
function mostRecentLogTime(entries, keyword, now = new Date()) {
  const kw = keyword.toLowerCase();
  let best = null;
  for (const e of entries || []) {
    if (!String(e.text || '').toLowerCase().includes(kw)) continue;
    const d = parseLogTime(e.time, now);
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

// { status: 'ok'|'overdue', nextTime, overdueAt } or null with no schedule.
function scheduledStatus(last, schedule, now = new Date()) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  const times = schedule
    .map((t) => {
      const m = String(t).match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const d = new Date(now);
      d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
      return d;
    })
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!times.length) return null;
  const past = times.filter((t) => t <= now);
  const nextTime = times.find((t) => t > now) || null;
  if (!past.length) return { status: 'ok', nextTime, overdueAt: null };
  const mostRecent = past[past.length - 1];
  if (last && last >= mostRecent) return { status: 'ok', nextTime, overdueAt: null };
  return { status: 'overdue', nextTime, overdueAt: mostRecent };
}

// 'h:mm AM/PM' — the format log entries are written in.
function fmtClock(d) {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

module.exports = { parseLogTime, mostRecentLogTime, scheduledStatus, fmtClock };
