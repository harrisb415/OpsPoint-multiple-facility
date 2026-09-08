'use strict';
/**
 * Staff routes — HTTP layer only. Validates nothing itself: it shapes the
 * request for the service, maps thrown `.status` errors to responses, and fires
 * the audit + broadcast side effects.
 *
 * register(app) attaches the routes to the existing Express app in the SAME
 * order and at the SAME paths as the original inline definitions, so route
 * matching/precedence is byte-for-byte unchanged (notably: `/:id` is still
 * registered before `/categories`).
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Staff Directory ───────────────────────────────────────────────
  app.get('/api/staff', requireAuth, async (req, res) => {
    res.json(await service.list());
  });

  app.post('/api/staff', requireAuth, csrfCheck, requirePermission('staff.edit'), async (req, res) => {
    try {
      const row = await service.create(req.body);
      await audit(req, 'staff.add', 'staff', null, row.name, { category: row.category || '' });
      broadcast({ type: 'staff_updated', user: req.session.displayName });
      res.json({ ok: true, staff: row });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/staff/:id', requireAuth, csrfCheck, requirePermission('staff.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const name = await service.update(id, req.body);
      await audit(req, 'staff.edit', 'staff', id, name);
      broadcast({ type: 'staff_updated', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/staff/:id', requireAuth, csrfCheck, requirePermission('staff.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const info = await service.remove(id);
      await audit(req, 'staff.delete', 'staff', id, info.name, { category: info.category });
      broadcast({ type: 'staff_updated', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Staff categories setting
  app.get('/api/staff/categories', requireAuth, async (req, res) => {
    res.json(await service.getCategories());
  });

  app.put('/api/staff/categories', requireAuth, csrfCheck, requirePermission('staff.edit'), async (req, res) => {
    try {
      const clean = await service.setCategories(req.body.categories);
      await audit(req, 'staff.categories', 'settings', null, 'Staff Categories', { categories: clean });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
