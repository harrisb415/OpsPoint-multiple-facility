'use strict';
/**
 * Mail routes — HTTP layer only. register(app) attaches the routes in the SAME
 * order and at the SAME paths as the original inline definitions.
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Mail Log ──────────────────────────────────────────────────────
  app.get('/api/mail', requireAuth, (req, res) => {
    res.json(service.list());
  });

  app.post('/api/mail', requireAuth, csrfCheck, requirePermission('mail.log'), (req, res) => {
    try {
      const actor = req.session.displayName || req.session.username || '';
      const { logged, wroteActiveLog } = service.logMail(req.body, { actor });
      for (const r of logged) {
        audit(req, 'mail.log', 'mail', null, r.client_name + ' Rm.' + r.room, { notes: r.notes, mail_type: r.mail_type });
      }
      if (wroteActiveLog) broadcast({ type: 'data_saved', user: req.session.displayName || req.session.username });
      broadcast({ type: 'mail_updated', user: req.session.displayName || req.session.username });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/mail/:id/approve', requireAuth, csrfCheck, requirePermission('mail.approve'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const by = req.session.displayName || req.session.username;
      const label = service.approve(id, by);
      audit(req, 'mail.approve', 'mail', id, label);
      broadcast({ type: 'mail_updated', user: by });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/mail/:id/deliver', requireAuth, csrfCheck, requirePermission('mail.deliver'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const label = service.deliver(id);
      audit(req, 'mail.deliver', 'mail', id, label);
      broadcast({ type: 'mail_updated', user: req.session.displayName || req.session.username });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/mail/:id', requireAuth, csrfCheck, requirePermission('mail.delete'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const label = service.remove(id);
      audit(req, 'mail.delete', 'mail', id, label);
      broadcast({ type: 'mail_updated', user: req.session.displayName || req.session.username });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
