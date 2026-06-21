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
  app.get('/api/staff', requireAuth, (req, res) => {
    res.json(service.list());
  });

  app.post('/api/staff', requireAuth, csrfCheck, requirePermission('staff.edit'), (req, res) => {
    try {
      const row = service.create(req.body);
      audit(req, 'staff.add', 'staff', null, row.name, { category: row.category || '' });
      broadcast({ type: 'staff_updated', user: req.session.displayName });
      res.json({ ok: true, staff: row });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/staff/:id', requireAuth, csrfCheck, requirePermission('staff.edit'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const name = service.update(id, req.body);
      audit(req, 'staff.edit', 'staff', id, name);
      broadcast({ type: 'staff_updated', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/staff/:id', requireAuth, csrfCheck, requirePermission('staff.edit'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const info = service.remove(id);
      audit(req, 'staff.delete', 'staff', id, info.name, { category: info.category });
      broadcast({ type: 'staff_updated', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Staff categories setting
  app.get('/api/staff/categories', requireAuth, (req, res) => {
    res.json(service.getCategories());
  });

  app.put('/api/staff/categories', requireAuth, csrfCheck, requirePermission('staff.edit'), (req, res) => {
    try {
      const clean = service.setCategories(req.body.categories);
      audit(req, 'staff.categories', 'settings', null, 'Staff Categories', { categories: clean });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
