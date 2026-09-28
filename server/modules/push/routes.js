'use strict';
/**
 * Push routes — HTTP layer only. Everything here acts on the caller's own
 * phone: a subscription is identified by its endpoint and only its owner can
 * read, change or remove it. Endpoints travel in request bodies, never query
 * strings, so they stay out of access logs.
 */
const { requireAuth, requirePermission, userPerms } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const service = require('./service');

function register(app) {
  const mobile = [requireAuth, requirePermission('mobile.access')];
  const send = (res, e) => res.status(e.status || 500).json({ error: e.message });

  app.get('/api/push/config', ...mobile, async (req, res) => {
    res.json(service.config(await userPerms(req)));
  });

  app.post('/api/push/subscribe', ...mobile, csrfCheck, async (req, res) => {
    try {
      const r = await service.subscribe(req.session.userId, req.body, { userAgent: req.get('user-agent') || '' });
      await audit(req, 'push.subscribe', 'user', req.session.userId, req.session.displayName || req.session.username, 'Turned on alerts for a phone');
      res.json({ ok: true, ...r });
    } catch (e) { send(res, e); }
  });

  app.post('/api/push/device', ...mobile, csrfCheck, async (req, res) => {
    try { res.json(await service.device(req.session.userId, req.body)); }
    catch (e) { send(res, e); }
  });

  app.put('/api/push/prefs', ...mobile, csrfCheck, async (req, res) => {
    try { res.json({ ok: true, ...await service.setPrefs(req.session.userId, req.body) }); }
    catch (e) { send(res, e); }
  });

  // Signing out also calls this, so it only needs a session, not mobile.access:
  // someone whose access was just revoked must still be able to switch alerts off.
  app.delete('/api/push/subscribe', requireAuth, csrfCheck, async (req, res) => {
    try {
      const r = await service.unsubscribe(req.session.userId, req.body);
      if (r.removed) await audit(req, 'push.unsubscribe', 'user', req.session.userId, req.session.displayName || req.session.username, 'Turned off alerts for a phone');
      res.json({ ok: true, ...r });
    } catch (e) { send(res, e); }
  });

  app.post('/api/push/test', ...mobile, csrfCheck, async (req, res) => {
    try { res.json(await service.test(req.session.userId, req.body)); }
    catch (e) { send(res, e); }
  });
}

module.exports = { register };
