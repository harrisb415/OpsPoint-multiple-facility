'use strict';
/**
 * Wellness round routes — HTTP layer only. Reading the current round needs a
 * session; starting, marking and finishing one write to the shift log, so they
 * need log.add, the permission the desktop wellness check already requires.
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const push = require('../push/service');
const service = require('./service');

function register(app) {
  const write = [requireAuth, csrfCheck, requirePermission('log.add')];
  const who = (req) => ({ id: req.session.userId, name: req.session.displayName || req.session.username || '' });
  const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });

  app.get('/api/rounds/current', requireAuth, async (req, res) => {
    try { res.json({ round: await service.current(), last: await service.last() }); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/rounds', ...write, async (req, res) => {
    try {
      const r = await service.start(who(req));
      if (!r.joined) {
        await audit(req, 'round.start', 'round', r.round.id, 'Wellness round');
        broadcast({ type: 'round_updated', round_id: r.round.id, user: who(req).name });
      }
      res.json({ ok: true, ...r });
    } catch (e) { fail(res, e); }
  });

  app.put('/api/rounds/:id/marks/:clientId', ...write, async (req, res) => {
    try {
      const value = req.body && 'mark' in req.body ? req.body.mark : undefined;
      const r = await service.mark(parseInt(req.params.id, 10), parseInt(req.params.clientId, 10), value === undefined ? '' : value, who(req));
      broadcast({ type: 'round_updated', round_id: r.round_id, client_id: r.client_id, mark: r.mark, user: r.by });
      res.json({ ok: true, ...r });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/rounds/:id/finish', ...write, async (req, res) => {
    try {
      const user = who(req);
      const r = await service.finish(parseInt(req.params.id, 10), user, { notes: req.body && req.body.notes });
      await audit(req, 'round.finish', 'report', r.reportId, 'Wellness round', { total: r.total, missing: r.missing, unchecked: r.unchecked });
      broadcast({ type: 'patched', patch: { reportId: r.reportId, log_entry: { time: r.logEntry.time, text: r.logEntry.text } }, user: user.name, active_report_id: r.reportId });
      broadcast({ type: 'round_updated', round_id: parseInt(req.params.id, 10), finished: true, user: user.name });
      if (r.missing) {
        push.notify('missing', {
          body: `${r.missing === 1 ? 'A resident was' : `${r.missing} residents were`} not located on the ${r.time} wellness round.`,
          url: '/m/rounds', tag: 'missing',
        }, { excludeUserId: user.id }).catch(() => {});
      }
      res.json({ ok: true, ...r });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/rounds/:id/marks/:clientId/found', ...write, async (req, res) => {
    try {
      const user = who(req);
      const r = await service.found(parseInt(req.params.id, 10), parseInt(req.params.clientId, 10), user, { note: req.body && req.body.note });
      await audit(req, 'round.found', 'client', parseInt(req.params.clientId, 10), r.label);
      broadcast({ type: 'patched', patch: { reportId: r.reportId, log_entry: { time: r.logEntry.time, text: r.logEntry.text } }, user: user.name, active_report_id: r.reportId });
      broadcast({ type: 'round_updated', round_id: parseInt(req.params.id, 10), user: user.name });
      res.json({ ok: true, ...r });
    } catch (e) { fail(res, e); }
  });
}

module.exports = { register };
