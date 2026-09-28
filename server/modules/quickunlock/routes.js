'use strict';
/**
 * Quick-unlock routes. The device token travels only in the opspoint_pin
 * cookie: httpOnly (no page script can read it), SameSite=Strict, and scoped
 * to /api/auth/pin so it is sent nowhere else. Unlock and remove work without
 * a session, so they check Origin the way /api/login does, and unlock shares
 * the login rate limit.
 */
const express = require('express');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck, originHost } = require('../../middleware/csrf');
const { loginRateCheck } = require('../../middleware/rateLimit');
const { audit } = require('../../middleware/audit');
const { establishSession } = require('../auth/session');
const service = require('./service');

const COOKIE = 'opspoint_pin';
const COOKIE_PATH = '/api/auth/pin';

function readToken(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}
function setToken(req, res, token, expiresAt) {
  res.cookie(COOKIE, token, { httpOnly: true, secure: req.secure, sameSite: 'strict', path: COOKIE_PATH, expires: new Date(expiresAt) });
}
function clearToken(res) {
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
}
function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || originHost(o) === req.headers.host;
}

function register(app) {
  app.get('/api/auth/pin/status', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const token = readToken(req);
    const s = await service.status(token);
    if (!s.available) {
      if (token) clearToken(res);
      return res.json({ available: false });
    }
    // mine: the PIN is the signed-in user's (the More screen shows it as on)
    res.json({ available: true, name: s.name, mine: !!(req.session && req.session.userId === s.userId) });
  });

  app.post('/api/auth/pin/setup', requireAuth, csrfCheck, requirePermission('mobile.access'), express.json(), async (req, res) => {
    try {
      const { token, expiresAt } = await service.setup(req.session.userId, req.body && req.body.pin, {
        userAgent: req.get('user-agent') || '', replaceToken: readToken(req),
      });
      setToken(req, res, token, expiresAt);
      await audit(req, 'auth.pin_setup', 'user', req.session.userId, req.session.displayName || req.session.username, 'Quick unlock turned on for a phone');
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post('/api/auth/pin/unlock', express.json(), async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    if (loginRateCheck(ip)) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes.' });
    try {
      const r = await service.unlock(readToken(req), req.body && req.body.pin);
      if (r.status === 'ok') {
        const { mustChangePw } = await establishSession(req, r.user);
        setToken(req, res, readToken(req), r.expiresAt);   // slide the cookie with the credential
        await audit(req, 'auth.pin_login', 'user', r.user.id, r.user.display_name || r.user.username, null, { actorId: r.user.id, actorName: r.user.display_name || r.user.username });
        return res.json({ ok: true, mustChangePw });
      }
      if (r.status === 'bad_pin' || r.status === 'locked') {
        await audit(req, r.status === 'locked' ? 'auth.pin_locked' : 'auth.pin_fail', 'user', r.userId, r.username, null, { actorId: null, actorName: r.username });
      }
      if (r.status === 'bad_pin') return res.status(401).json({ error: `Wrong PIN. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.`, left: r.left });
      clearToken(res);
      if (r.status === 'locked') return res.status(401).json({ error: 'Too many wrong PINs, so quick unlock is off. Sign in with your password.', gone: true });
      return res.status(401).json({ error: 'Quick unlock isn’t set up on this phone. Sign in with your password.', gone: true });
    } catch (e) {
      res.status(500).json({ error: 'Unlock error.' });
    }
  });

  app.delete('/api/auth/pin', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    const removed = await service.remove(readToken(req)).catch(() => false);
    clearToken(res);
    if (removed && req.session && req.session.userId) {
      await audit(req, 'auth.pin_off', 'user', req.session.userId, req.session.displayName || req.session.username, 'Quick unlock turned off for a phone');
    }
    res.json({ ok: true, removed });
  });
}

module.exports = { register, _readToken: readToken };
