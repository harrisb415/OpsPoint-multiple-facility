'use strict';
/** CSRF defence (VULN-1) — reject cross-origin state-changing requests. */

function originHost(origin) {
  try { return new URL(origin).host; } catch { return null; }
}

function csrfCheck(req, res, next) {
  const origin = req.headers.origin;
  if (origin && originHost(origin) !== req.headers.host) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { csrfCheck, originHost };
