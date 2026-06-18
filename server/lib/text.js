'use strict';
/** Validation + sanitization for user-controlled text fields. Pure. */

const TIME_RE = /^\d{1,2}:\d{2} (AM|PM)$/;

// Is this a well-formed "h:mm AM/PM" time string (12-hour)?
function validTime(s) {
  if (typeof s !== 'string') return false;
  const m = s.match(TIME_RE);
  if (!m) return false;
  const h = parseInt(s.split(':')[0]);
  return h >= 1 && h <= 12;
}

// Strip ASCII control chars (incl. nulls, newlines) and clip to N chars.
// Use for free-text fields that get persisted and re-rendered (names, etc).
function sanitizeText(s, max) {
  return String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, '').slice(0, max);
}

module.exports = { validTime, sanitizeText, TIME_RE };
