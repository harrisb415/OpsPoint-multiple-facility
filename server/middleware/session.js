'use strict';
/**
 * Session-state guards: HIPAA idle timeout + forced-password-change gating.
 * (The express-session setup itself stays in the composition root for now,
 * because its cookie.secure flag is rebuilt once TLS status is known.)
 */
const db = require('../../db');
const config = require('../config');

// Force logout after N minutes of inactivity (session_idle_mins setting,
// default config.SESSION_IDLE_DEFAULT_MINS). Only mutations — or an explicit
// X-User-Activity header — count as activity; passive GETs do NOT bump the
// clock, per HIPAA §164.312(a)(2)(iii).
function idleSessionCheck(req, res, next) {
  if (!req.session || !req.session.userId) return next();
  const idleMins = parseInt(db.getSetting('session_idle_mins', config.SESSION_IDLE_DEFAULT_MINS)) || config.SESSION_IDLE_DEFAULT_MINS;
  const maxIdleMs = idleMins * 60 * 1000;
  const now = Date.now();
  if (req.session.last_activity && (now - req.session.last_activity) > maxIdleMs) {
    const uid = req.session.userId;
    const name = req.session.displayName || req.session.username || '';
    try { db.auditLog(uid, name, req.ip || '', 'auth.idle_timeout', 'user', String(uid), name, { idleMins }); } catch (e) {}
    return req.session.destroy(() => {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session expired (idle)', code: 'IDLE_TIMEOUT' });
      return res.redirect('/login');
    });
  }
  const isMutation = req.method === 'POST' || req.method === 'PUT'
    || req.method === 'PATCH' || req.method === 'DELETE';
  if (isMutation || req.headers['x-user-activity'] === '1') {
    req.session.last_activity = now;
  } else if (!req.session.last_activity) {
    req.session.last_activity = now; // first request of a session — start the clock
  }
  next();
}

// Until a must_change_pw user changes their password, allow only a small set of
// routes (+ static assets, so the SPA can render the change-password page).
function requireForceChangePw(req, res, next) {
  if (req.session && req.session.must_change_pw) {
    const allowed = ['/change-password', '/api/force-change-password', '/logout', '/api/me', '/api/login'];
    if (allowed.includes(req.path)) return next();
    if (req.path.startsWith('/assets/') || req.path.startsWith('/static/') ||
        req.path.startsWith('/js/') || req.path.startsWith('/css/')) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Password change required' });
    return res.redirect('/change-password');
  }
  next();
}

module.exports = { idleSessionCheck, requireForceChangePw };
