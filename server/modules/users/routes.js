'use strict';
/**
 * Users routes — HTTP layer only. register(app) attaches accounts, permission
 * profiles, groups, and self-service password in the SAME order/paths as the
 * originals. The service returns a breakdown the route uses to fire the exact
 * conditional audits + permission re-broadcasts.
 */
const express = require('express');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck, originHost } = require('../../middleware/csrf');
const { apiRateCheck, loginRateCheck } = require('../../middleware/rateLimit');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');
const invites = require('./invites');
const { establishSession } = require('../auth/session');

// The link an invite is opened with: the address the admin is using, or the
// server's LAN address when that is this machine's own localhost.
const inviteLink = (req, token) => `${require('../../lib/net').reachableOrigin(req)}/invite/${token}`;

function register(app) {
  // ── Users API ─────────────────────────────────────────────────────
  app.get('/api/users', requireAuth, requirePermission('admin.users'), async (req, res) => {
    res.json(await service.list());
  });

  app.post('/api/users', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const body = req.body || {};
      const r = await service.create(body);
      await audit(req, 'user.add', 'user', r.id, r.displayName, { username: r.username, role: r.role, groupIds: r.groupIds, invite: !body.password });
      if (body.password) return res.json({ ok: true, id: r.id });
      const inv = await invites.create(r.id, { createdBy: req.session.userId });
      await audit(req, 'user.invite', 'user', r.id, r.displayName, { expiresAt: inv.expiresAt });
      res.json({ ok: true, id: r.id, invite: { link: inviteLink(req, inv.token), expiresAt: inv.expiresAt } });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Invite links (server/modules/users/invites.js) ────────────────
  // A new link for an account; any unused one stops working.
  app.post('/api/users/:id/invite', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const inv = await invites.create(id, { createdBy: req.session.userId });
      const tgt = (await service.list()).find((u) => u.id === id);
      await audit(req, 'user.invite', 'user', id, tgt ? tgt.displayName || tgt.username : String(id), { expiresAt: inv.expiresAt });
      res.json({ ok: true, link: inviteLink(req, inv.token), expiresAt: inv.expiresAt });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  // Opening a link (no session): who it is for, or 410.
  app.get('/api/invites/:token', async (req, res) => {
    const inv = await invites.lookup(req.params.token);
    if (!inv) return res.status(410).json({ error: 'This invite link has expired or was already used. Ask your administrator for a new one.' });
    res.json({ username: inv.username, displayName: inv.displayName, expiresAt: inv.expiresAt });
  });
  // Using it: the owner's own password, then they are signed in. No session
  // yet, so the Origin is checked the way /api/login checks it, and guesses
  // share the login rate limit.
  app.post('/api/invites/:token', express.json(), async (req, res) => {
    const o = req.headers.origin;
    if (o && originHost(o) !== req.headers.host) return res.status(403).json({ error: 'Forbidden' });
    const ip = req.ip || 'unknown';
    if (loginRateCheck(ip)) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes.' });
    try {
      const u = await invites.accept(req.params.token, (req.body || {}).password);
      const { mustChangePw } = await establishSession(req, u);
      await audit(req, 'user.invite_accepted', 'user', u.id, u.display_name || u.username, null, { actorId: u.id, actorName: u.display_name || u.username });
      res.json({ ok: true, mustChangePw });
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not set the password.' }); }
  });

  app.put('/api/users/:id', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = await service.update(id, req.body, { currentUserId: req.session.userId });
      if (r.permissionsChanged) broadcast({ type: 'permissions_updated', userId: id });
      if (r.permissionsChanged) await audit(req, 'user.perm_change', 'user', id, r.targetName, { permissions: r.perms });
      if (r.roleApplied) await audit(req, 'user.role_change', 'user', id, r.targetName, { role: r.role });
      if (r.passwordChanged && !r.isOwnPw) await audit(req, 'user.pw_reset', 'user', id, r.targetName);
      if (r.passwordChanged && r.isOwnPw) await audit(req, 'auth.pw_change', 'user', id, r.targetName, { type: 'self_change' });
      if (r.displayNameProvided && !r.permissionsChanged && !r.passwordChanged) await audit(req, 'user.edit', 'user', id, r.targetName, { displayName: req.body.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/users/:id', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = await service.remove(id, { currentUserId: req.session.userId });
      await audit(req, 'user.delete', 'user', id, r.targetName);
      broadcast({ type: 'user_deleted', userId: id });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/users/:id/protect', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = await service.toggleProtect(id, { currentUserId: req.session.userId });
      await audit(req, 'user.protect', 'user', id, r.targetName, { protected: r.protectedVal });
      res.json({ ok: true, protected: r.protectedVal });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Permission profiles ───────────────────────────────────────────
  app.get('/api/permission-profiles', requireAuth, requirePermission('admin.users'), async (req, res) => {
    res.json(await service.getProfiles());
  });
  app.put('/api/permission-profiles', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const r = await service.saveProfiles(req.body);
      await audit(req, 'profile.edit', 'settings', null, 'Permission Profiles', { count: r.count, profiles: r.keys });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Groups API ────────────────────────────────────────────────────
  app.get('/api/groups', requireAuth, requirePermission('admin.users'), async (req, res) => {
    res.json(await service.listGroups());
  });
  app.post('/api/groups', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const r = await service.createGroup(req.body);
      await audit(req, 'group.create', 'group', r.id, r.label, { key: r.key });
      res.json({ ok: true, id: r.id });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/groups/:id', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = await service.updateGroup(id, req.body);
      r.memberIds.forEach(uid => broadcast({ type: 'permissions_updated', userId: uid }));
      await audit(req, 'group.edit', 'group', id, r.label, { permCount: r.permCount });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/groups/:id', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = await service.deleteGroup(id);
      r.affectedIds.forEach(uid => broadcast({ type: 'permissions_updated', userId: uid }));
      await audit(req, 'group.delete', 'group', id, r.label);
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/users/:id/groups', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const r = await service.setUserGroups(id, req.body, { currentUserId: req.session.userId });
      broadcast({ type: 'permissions_updated', userId: id });
      await audit(req, 'user.groups_change', 'user', id, r.targetName, { groupIds: r.groupIds });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Self-service password change ──────────────────────────────────
  app.post('/api/users/me/password', requireAuth, csrfCheck, async (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    try {
      await service.changeOwnPassword(req.session.userId, req.body);
      await audit(req, 'auth.pw_change', 'user', req.session.userId, req.session.displayName || req.session.username, { type: 'self_change' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
