'use strict';
/**
 * Auth routes — HTTP layer for the login / logout / me / change-password flow.
 * register(app, { serveSPA }) attaches them; serveSPA is injected from the
 * composition root. Session regenerate/save stays here (request-bound). The
 * /api/login Origin check + per-IP rate limit are HTTP concerns and live here.
 */
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { csrfCheck, originHost } = require('../../middleware/csrf');
const { loginRateCheck } = require('../../middleware/rateLimit');
const { audit } = require('../../middleware/audit');
const service = require('./service');
const { establishSession } = require('./session');

function register(app, { serveSPA } = {}) {
  // ── Login / logout — React SPA handles the UI ─────────────────────
  app.get('/login', (req, res) => {
    if (req.session && req.session.userId) return res.redirect('/');
    serveSPA(res);
  });

  app.post('/logout', csrfCheck, async (req, res) => {
    await audit(req, 'auth.logout', 'user', req.session.userId, req.session.displayName || req.session.username);
    req.session.destroy(() => res.json({ ok: true }));
  });

  // ── Force password change ─────────────────────────────────────────
  app.get('/change-password', requireAuth, (req, res) => serveSPA(res));

  app.post('/api/force-change-password', requireAuth, csrfCheck, async (req, res) => {
    // Only usable when the account is actually in must_change_pw state
    if (!req.session.must_change_pw) return res.status(403).json({ error: 'Not applicable' });
    try {
      await service.forceChangePassword(req.session.userId, req.body.newPassword);
      await audit(req, 'auth.pw_change', 'user', req.session.userId, req.session.displayName || req.session.username, { type: 'forced_change' });
      req.session.must_change_pw = false;
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Current user ──────────────────────────────────────────────────
  app.get('/api/me', requireAuth, async (req, res) => {
    res.json(await service.getMe(req.session));
  });

  // ── JSON login endpoint for the React frontend ────────────────────
  app.post('/api/login', express.json(), async (req, res) => {
    const loginOrigin = req.headers.origin;
    if (loginOrigin && originHost(loginOrigin) !== req.headers.host) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    if (loginRateCheck(ip)) return res.status(429).json({ error: 'Too many login attempts. Wait 15 minutes.' });
    const { username, password } = req.body || {};

    const r = await service.authenticate(username, password);
    if (r.status === 'no_user') {
      await audit(req, 'auth.login_fail', 'user', null, username || '?', { reason: 'user_not_found' }, { actorId: null, actorName: username || '?' });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    if (r.status === 'error') return res.status(500).json({ error: 'Login error.' });
    if (r.status === 'bad_password') {
      await audit(req, 'auth.login_fail', 'user', r.user.id, r.user.username, { reason: 'bad_password' }, { actorId: null, actorName: r.user.username });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const u = r.user;
    try {
      const { mustChangePw } = await establishSession(req, u);
      await audit(req, 'auth.login', 'user', u.id, u.display_name || u.username, null, { actorId: u.id, actorName: u.display_name || u.username });
      res.json({ ok: true, mustChangePw });
    } catch (e) {
      res.status(500).json({ error: 'Login error.' });
    }
  });
}

module.exports = { register };
