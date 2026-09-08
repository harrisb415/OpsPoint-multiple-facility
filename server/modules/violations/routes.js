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
  app.get('/api/violations', requireAuth, async (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    res.json(await service.list(req.query));
  });

  app.post('/api/violations', requireAuth, csrfCheck, requirePermission('violations.log'), async (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    try {
      const actor = req.session.displayName || req.session.username;
      const { id, label, description } = await service.create(req.body, { actor });
      await audit(req, 'violation.log', 'violation', id, label, { description });
      broadcast({ type: 'violations_updated', ...await service.counts() });
      res.json({ ok: true, id });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/violations/:id/review', requireAuth, csrfCheck, requirePermission('violations.review'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const actor = req.session.displayName || req.session.username;
      const { clientName, action, consequence } = await service.review(id, req.body, { actor });
      await audit(req, 'violation.review', 'violation', id, clientName, { action, consequence });
      broadcast({ type: 'violations_updated', ...await service.counts() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/violations/:id/complete', requireAuth, csrfCheck, requirePermission('violations.complete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const actor = req.session.displayName || req.session.username;
      const { clientName } = await service.complete(id, { actor });
      await audit(req, 'violation.complete', 'violation', id, clientName);
      broadcast({ type: 'violations_updated', ...await service.counts() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/violations/:id', requireAuth, csrfCheck, requirePermission('violations.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { clientName } = await service.remove(id);
      await audit(req, 'violation.delete', 'violation', id, clientName);
      broadcast({ type: 'violations_updated', ...await service.counts() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
