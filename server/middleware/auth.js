'use strict';
/**
 * Identity + permission guards. ALL read permissions from the DB on every call
 * (never trust session.permissions) so grants/revokes take effect immediately
 * without re-login. API requests get 401/403 JSON; page requests redirect.
 */
const db = require('../../db');

// Resolve the live permission set for the current session.
function userPerms(req) {
  if (!req.session || !req.session.userId) return [];
  const u = db.query1('SELECT permissions,role FROM users WHERE id=?', [req.session.userId]);
  if (!u) return [];
  return u.permissions ? JSON.parse(u.permissions) : (db.ROLE_PRESETS[u.role] || []);
}

// Any authenticated user whose account still exists.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    if (db.query1('SELECT id FROM users WHERE id=?', [req.session.userId])) return next();
    req.session.destroy(() => {});
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  req.session.returnTo = req.originalUrl; res.redirect('/login');
}

// Require one named permission.
function requirePermission(perm) {
  return function (req, res, next) {
    if (!req.session || !req.session.userId) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
      req.session.returnTo = req.originalUrl; return res.redirect('/login');
    }
    const _u = db.query1('SELECT permissions,role FROM users WHERE id=?', [req.session.userId]);
    if (!_u) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
      return res.redirect('/login');
    }
    const perms = _u.permissions ? JSON.parse(_u.permissions) : (db.ROLE_PRESETS[_u.role] || []);
    if (perms.includes(perm)) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Permission denied' });
    return res.status(403).send('Access denied.');
  };
}

// Require at least one of the listed permissions.
function requireAnyPermission(...perms) {
  return function (req, res, next) {
    if (!req.session || !req.session.userId) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
      req.session.returnTo = req.originalUrl; return res.redirect('/login');
    }
    const _u = db.query1('SELECT permissions,role FROM users WHERE id=?', [req.session.userId]);
    if (!_u) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
      return res.redirect('/login');
    }
    const up = _u.permissions ? JSON.parse(_u.permissions) : (db.ROLE_PRESETS[_u.role] || []);
    if (perms.some(p => up.includes(p))) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Permission denied' });
    return res.status(403).send('Access denied.');
  };
}

module.exports = { userPerms, requireAuth, requirePermission, requireAnyPermission };
