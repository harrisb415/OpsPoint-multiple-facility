'use strict';
/**
 * Violations routes — HTTP layer only. register(app) attaches the routes in the
 * SAME order and at the SAME paths as the original inline definitions. The GET
 * and POST keep their per-IP apiRateCheck; every mutation broadcasts the updated
 * banner counts.
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { apiRateCheck } = require('../../middleware/rateLimit');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Violations ───────────────────────────────────────────────────
  app.get('/api/violations', requireAuth, (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    res.json(service.list(req.query));
  });

  app.post('/api/violations', requireAuth, csrfCheck, requirePermission('violations.log'), (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    try {
      const actor = req.session.displayName || req.session.username;
      const { id, label, description } = service.create(req.body, { actor });
      audit(req, 'violation.log', 'violation', id, label, { description });
      broadcast({ type: 'violations_updated', ...service.counts() });
      res.json({ ok: true, id });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/violations/:id/review', requireAuth, csrfCheck, requirePermission('violations.review'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const actor = req.session.displayName || req.session.username;
      const { clientName, action, consequence } = service.review(id, req.body, { actor });
      audit(req, 'violation.review', 'violation', id, clientName, { action, consequence });
      broadcast({ type: 'violations_updated', ...service.counts() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/violations/:id/complete', requireAuth, csrfCheck, requirePermission('violations.complete'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const actor = req.session.displayName || req.session.username;
      const { clientName } = service.complete(id, { actor });
      audit(req, 'violation.complete', 'violation', id, clientName);
      broadcast({ type: 'violations_updated', ...service.counts() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/violations/:id', requireAuth, csrfCheck, requirePermission('violations.delete'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { clientName } = service.remove(id);
      audit(req, 'violation.delete', 'violation', id, clientName);
      broadcast({ type: 'violations_updated', ...service.counts() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
