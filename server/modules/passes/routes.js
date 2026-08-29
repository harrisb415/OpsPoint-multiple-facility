'use strict';
/**
 * Passes routes — HTTP layer only. register(app) attaches the routes in the
 * SAME order and at the SAME paths as the original inline definitions.
 *
 * The PUT handler resolves the caller's live permissions (an authz/HTTP concern)
 * and passes a canEditDetails flag to the service, which owns the status-only
 * business rule.
 */
const { requireAuth, requirePermission, requireAnyPermission, userPerms } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Weekend Passes ────────────────────────────────────────────────
  app.get('/api/passes', requireAuth, (req, res) => {
    res.json(service.list());
  });

  app.post('/api/passes', requireAuth, csrfCheck, requirePermission('passes.edit'), (req, res) => {
    try {
      const pass = service.create(req.body);
      audit(req, 'passes.add', 'pass', null, pass.name,
        { departure: pass.departure || '', return_date: pass.return_date || '', status: pass.status || 'Out' });
      broadcast({ type: 'passes_updated', user: req.session.displayName });
      res.json({ ok: true, pass });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/passes/:id', requireAuth, csrfCheck, requireAnyPermission('passes.edit', 'passes.status'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const canEditDetails = userPerms(req).includes('passes.edit');
      const { status } = req.body;
      const actor = req.session.displayName || req.session.username || '';
      const name = service.update(id, req.body, { canEditDetails, actor });
      if (status !== undefined) audit(req, 'passes.status', 'pass', id, name, { status });
      else audit(req, 'passes.edit', 'pass', id, name);
      broadcast({ type: 'passes_updated', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/passes/:id', requireAuth, csrfCheck, requirePermission('passes.edit'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const info = service.remove(id);
      audit(req, 'passes.delete', 'pass', id, info.name);
      broadcast({ type: 'passes_updated', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Pass notice board
  app.get('/api/pass-notice', requireAuth, (req, res) => {
    res.json({ notice: service.getNotice() });
  });

  app.put('/api/pass-notice', requireAuth, csrfCheck, requirePermission('passes.edit'), (req, res) => {
    try {
      const stored = service.setNotice(req.body.notice);
      audit(req, 'passes.notice', 'settings', null, 'Pass Notice', { notice: stored.slice(0, 100) });
      broadcast({ type: 'pass_notice_updated', user: req.session.displayName, notice: req.body.notice || '' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
