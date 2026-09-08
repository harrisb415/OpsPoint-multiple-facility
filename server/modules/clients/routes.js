'use strict';
/**
 * Clients routes — HTTP layer only. register(app) attaches the routes in the
 * SAME order and at the SAME paths as the original inline definitions. The
 * profile-view route keeps its per-IP apiRateCheck and HIPAA read-audit.
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { apiRateCheck } = require('../../middleware/rateLimit');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Add new client ─────────────────────────────────────────────
  app.post('/api/clients', requireAuth, csrfCheck, requirePermission('residents.edit'), async (req, res) => {
    try {
      const r = await service.create(req.body);
      await audit(req, 'client.add', 'client', r.id, r.label);
      broadcast({ type: 'data_saved', user: req.session.displayName || req.session.username });
      res.json({ ok: true, id: r.id, client: r.client });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Direct client update (all authenticated roles) ─────────────
  app.put('/api/clients/:id', requireAuth, csrfCheck, requirePermission('residents.edit'), async (req, res) => {
    try {
      const r = await service.update(req.params.id, req.body);
      await audit(req, 'client.edit', 'client', parseInt(req.params.id, 10), r.label, { fields: Object.keys(req.body) });
      broadcast({ type: 'data_saved', user: req.session.displayName || req.session.username });
      res.json({ ok: true, client: r.client });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Client profile view (audit gate — HIPAA §164.312(b)) ─────────────
  app.get('/api/clients/:id/profile', requireAuth, async (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    try {
      const cl = await service.getProfileTarget(req.params.id);
      await audit(req, 'record.read', 'client_profile', cl.id, cl.name + ' Rm.' + cl.room, 'Profile drawer opened');
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
