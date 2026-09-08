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
  app.get('/api/mail', requireAuth, async (req, res) => {
    res.json(await service.list());
  });

  app.post('/api/mail', requireAuth, csrfCheck, requirePermission('mail.log'), async (req, res) => {
    try {
      const actor = req.session.displayName || req.session.username || '';
      const { logged, wroteActiveLog } = await service.logMail(req.body, { actor });
      for (const r of logged) {
        await audit(req, 'mail.log', 'mail', null, r.client_name + ' Rm.' + r.room, { notes: r.notes, mail_type: r.mail_type });
      }
      if (wroteActiveLog) broadcast({ type: 'data_saved', user: req.session.displayName || req.session.username });
      broadcast({ type: 'mail_updated', user: req.session.displayName || req.session.username });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/mail/:id/approve', requireAuth, csrfCheck, requirePermission('mail.approve'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const by = req.session.displayName || req.session.username;
      const label = await service.approve(id, by);
      await audit(req, 'mail.approve', 'mail', id, label);
      broadcast({ type: 'mail_updated', user: by });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/mail/:id/deliver', requireAuth, csrfCheck, requirePermission('mail.deliver'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const label = await service.deliver(id);
      await audit(req, 'mail.deliver', 'mail', id, label);
      broadcast({ type: 'mail_updated', user: req.session.displayName || req.session.username });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/mail/:id', requireAuth, csrfCheck, requirePermission('mail.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const label = await service.remove(id);
      await audit(req, 'mail.delete', 'mail', id, label);
      broadcast({ type: 'mail_updated', user: req.session.displayName || req.session.username });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
