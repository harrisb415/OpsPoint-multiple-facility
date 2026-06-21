'use strict';
/**
 * Chores routes — HTTP layer only. register(app) attaches the routes in the SAME
 * order and at the SAME paths as the original inline definitions.
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Chores — chore assignments live on clients, log per day ──────
  // Get master chore list
  app.get('/api/master-chores', requireAuth, (req, res) => {
    res.json(service.getMaster());
  });

  app.put('/api/master-chores', requireAuth, csrfCheck, requirePermission('chores.assign'), (req, res) => {
    try {
      const { count } = service.setMaster(req.body.chores);
      audit(req, 'chore.master_edit', 'settings', null, 'Master Chores', { count });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Update a single client's chore assignment (supervisor only)
  app.patch('/api/clients/:id/chore', requireAuth, csrfCheck, requirePermission('chores.assign'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { label, chore } = service.assignChore(id, req.body);
      audit(req, 'chore.assign', 'client', id, label, { chore });
      broadcast({ type: 'data_saved', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Get chore log — single date or date range (?from=YYYY-MM-DD&to=YYYY-MM-DD)
  app.get('/api/chore-log', requireAuth, (req, res) => {
    res.json(service.getLog(req.query));
  });

  // Upsert a chore log entry
  app.put('/api/chore-log', requireAuth, csrfCheck, requirePermission('chores.log'), (req, res) => {
    try {
      const { client_id, log_date, initials } = req.body;
      service.upsertLog({ client_id, log_date, initials });
      audit(req, 'chore.initial', 'client', client_id, String(client_id), { log_date, initials: initials || '' });
      broadcast({ type: 'chore_log_updated', user: req.session.displayName, client_id, log_date, initials });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
