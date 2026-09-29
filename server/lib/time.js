'use strict';
/** Time/timestamp helpers. Pure — no app state. */

// Returns "YYYY-MM-DD HH:MM:SS" in the SERVER's local timezone. Use this
// everywhere a human-readable timestamp is stored/displayed — NOT
// toISOString() (UTC), which browsers re-parse as local and shift the time.
function nowLocal() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// nowLocal()'s format, `hours` from now (negative = earlier): a cutoff to
// compare against timestamps nowLocal() wrote.
function localShift(hours = 0) {
  const d = new Date(Date.now() + hours * 3600000), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Parse a "h:mm AM/PM" string into minutes-since-midnight.
function timeToMins(t) {
  if (!t) return 0;
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 0;
  let h = parseInt(m[1]), mn = parseInt(m[2]), ap = m[3].toUpperCase();
  if (ap === 'AM' && h === 12) h = 0;
  if (ap === 'PM' && h !== 12) h += 12;
  return h * 60 + mn;
}

// "YYYY-MM-DD" of the server's local calendar day, `days` from today.
// NOT toISOString().slice(0, 10): that is the UTC date, already tomorrow by
// late afternoon in the Americas — the chore log's "today" emptied out at
// 5 PM Pacific, and a consent expiring today stopped counting hours early.
// Correct once the process runs in the facility's zone (TZ).
function localDate(days = 0) {
  const d = new Date(Date.now() + days * 86400000), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Milliseconds for an instant the database stamped: ISO text (with Z or an
// offset, as the pg driver returns timestamptz) or SQLite datetime('now') text,
// which is UTC with no zone marker. NaN when unreadable.
function instantMs(v) {
  if (v instanceof Date) return v.getTime();
  const s = String(v == null ? '' : v).trim();
  if (!s) return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(s) ? s : s.replace(' ', 'T') + 'Z');
}

// nowLocal()'s format for an instant (ms): what a person reading the audit
// log expects, rather than UTC. '' when unreadable.
function localStampAt(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

module.exports = { nowLocal, localShift, timeToMins, localDate, instantMs, localStampAt };
