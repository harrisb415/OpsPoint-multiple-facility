'use strict';
/**
 * Users routes — HTTP layer only. register(app) attaches accounts, permission
 * profiles, groups, and self-service password in the SAME order/paths as the
 * originals. The service returns a breakdown the route uses to fire the exact
 * conditional audits + permission re-broadcasts.
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { apiRateCheck } = require('../../middleware/rateLimit');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Users API ─────────────────────────────────────────────────────
  app.get('/api/users', requireAuth, requirePermission('admin.users'), (req, res) => {
    res.json(service.list());
  });

  app.post('/api/users', requireAuth, csrfCheck, requirePermission('admin.users'), (req, res) => {
    try {
      const r = service.create(req.body);
      audit(req, 'user.add', 'user', r.id, r.displayName, { username: r.username, role: r.role, groupIds: r.groupIds });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/users/:id', requireAuth, csrfCheck, requirePermission('admin.users'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = service.update(id, req.body, { currentUserId: req.session.userId });
      if (r.permissionsChanged) broadcast({ type: 'permissions_updated', userId: id });
      if (r.permissionsChanged) audit(req, 'user.perm_change', 'user', id, r.targetName, { permissions: r.perms });
      if (r.roleApplied) audit(req, 'user.role_change', 'user', id, r.targetName, { role: r.role });
      if (r.passwordChanged && !r.isOwnPw) audit(req, 'user.pw_reset', 'user', id, r.targetName);
      if (r.passwordChanged && r.isOwnPw) audit(req, 'auth.pw_change', 'user', id, r.targetName, { type: 'self_change' });
      if (r.displayNameProvided && !r.permissionsChanged && !r.passwordChanged) audit(req, 'user.edit', 'user', id, r.targetName, { displayName: req.body.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/users/:id', requireAuth, csrfCheck, requirePermission('admin.users'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = service.remove(id, { currentUserId: req.session.userId });
      audit(req, 'user.delete', 'user', id, r.targetName);
      broadcast({ type: 'user_deleted', userId: id });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/users/:id/protect', requireAuth, csrfCheck, requirePermission('admin.users'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = service.toggleProtect(id, { currentUserId: req.session.userId });
      audit(req, 'user.protect', 'user', id, r.targetName, { protected: r.protectedVal });
      res.json({ ok: true, protected: r.protectedVal });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Permission profiles ───────────────────────────────────────────
  app.get('/api/permission-profiles', requireAuth, requirePermission('admin.users'), (req, res) => {
    res.json(service.getProfiles());
  });
  app.put('/api/permission-profiles', requireAuth, csrfCheck, requirePermission('admin.users'), (req, res) => {
    try {
      const r = service.saveProfiles(req.body);
      audit(req, 'profile.edit', 'settings', null, 'Permission Profiles', { count: r.count, profiles: r.keys });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Groups API ────────────────────────────────────────────────────
  app.get('/api/groups', requireAuth, requirePermission('admin.users'), (req, res) => {
    res.json(service.listGroups());
  });
  app.post('/api/groups', requireAuth, csrfCheck, requirePermission('admin.users'), (req, res) => {
    try {
      const r = service.createGroup(req.body);
      audit(req, 'group.create', 'group', r.id, r.label, { key: r.key });
      res.json({ ok: true, id: r.id });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/groups/:id', requireAuth, csrfCheck, requirePermission('admin.users'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = service.updateGroup(id, req.body);
      r.memberIds.forEach(uid => broadcast({ type: 'permissions_updated', userId: uid }));
      audit(req, 'group.edit', 'group', id, r.label, { permCount: r.permCount });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/groups/:id', requireAuth, csrfCheck, requirePermission('admin.users'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = service.deleteGroup(id);
      r.affectedIds.forEach(uid => broadcast({ type: 'permissions_updated', userId: uid }));
      audit(req, 'group.delete', 'group', id, r.label);
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/users/:id/groups', requireAuth, csrfCheck, requirePermission('admin.users'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = service.setUserGroups(id, req.body, { currentUserId: req.session.userId });
      broadcast({ type: 'permissions_updated', userId: id });
      audit(req, 'user.groups_change', 'user', id, r.targetName, { groupIds: r.groupIds });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Self-service password change ──────────────────────────────────
  app.post('/api/users/me/password', requireAuth, csrfCheck, (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    try {
      service.changeOwnPassword(req.session.userId, req.body);
      audit(req, 'auth.pw_change', 'user', req.session.userId, req.session.displayName || req.session.username, { type: 'self_change' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
