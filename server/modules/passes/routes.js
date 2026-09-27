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
  app.get('/api/passes', requireAuth, async (req, res) => {
    res.json(await service.list());
  });

  app.post('/api/passes', requireAuth, csrfCheck, requirePermission('passes.edit'), async (req, res) => {
    try {
      const pass = await service.create(req.body);
      await audit(req, 'passes.add', 'pass', null, pass.name,
        { departure: pass.departure || '', return_date: pass.return_date || '', status: pass.status || 'Out' });
      broadcast({ type: 'passes_updated', user: req.session.displayName });
      res.json({ ok: true, pass });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.put('/api/passes/:id', requireAuth, csrfCheck, requireAnyPermission('passes.edit', 'passes.status'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const canEditDetails = (await userPerms(req)).includes('passes.edit');
      const { status, tz } = req.body;
      const actor = req.session.displayName || req.session.username || '';
      const { name, extension } = await service.update(id, req.body,
        { canEditDetails, actor, timeZone: tz });
      if (extension) {
        await audit(req, 'passes.status', 'pass', id, name,
          { status, return_date: extension.return_date, extended_from: extension.extended_from });
      } else if (status !== undefined) await audit(req, 'passes.status', 'pass', id, name, { status });
      else await audit(req, 'passes.edit', 'pass', id, name);
      // An extension rides on the usual refresh; `extended` lets clients holding
      // passes.notify_extended chime. Everyone signed in can already see passes,
      // so the payload exposes nothing new.
      broadcast({
        type: 'passes_updated', user: req.session.displayName,
        ...(extension ? { extended: {
          id: extension.id, name: extension.name, room: extension.room,
          return_date: extension.return_date, extended_from: extension.extended_from,
          extended_by: extension.extended_by, extended_at: extension.extended_at,
        } } : {}),
      });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/passes/:id', requireAuth, csrfCheck, requirePermission('passes.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const info = await service.remove(id);
      await audit(req, 'passes.delete', 'pass', id, info.name);
      broadcast({ type: 'passes_updated', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Pass notice board
  app.get('/api/pass-notice', requireAuth, async (req, res) => {
    res.json({ notice: await service.getNotice() });
  });

  app.put('/api/pass-notice', requireAuth, csrfCheck, requirePermission('passes.edit'), async (req, res) => {
    try {
      const stored = await service.setNotice(req.body.notice);
      await audit(req, 'passes.notice', 'settings', null, 'Pass Notice', { notice: stored.slice(0, 100) });
      broadcast({ type: 'pass_notice_updated', user: req.session.displayName, notice: req.body.notice || '' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
