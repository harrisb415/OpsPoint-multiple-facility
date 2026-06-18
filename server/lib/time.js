'use strict';
/** Time/timestamp helpers. Pure — no app state. */

// Returns "YYYY-MM-DD HH:MM:SS" in the SERVER's local timezone. Use this
// everywhere a human-readable timestamp is stored/displayed — NOT
// toISOString() (UTC), which browsers re-parse as local and shift the time.
function nowLocal() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
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

module.exports = { nowLocal, timeToMins };
