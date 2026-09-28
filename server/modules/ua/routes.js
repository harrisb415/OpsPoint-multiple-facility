'use strict';
/**
 * UA routes — HTTP layer only. register(app) attaches the routes in the SAME
 * order and at the SAME paths as the original inline definitions (UA Requests
 * then UA Draws). All mutations re-broadcast the pending-request list.
 */
const { requireAuth, requirePermission, requireAnyPermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const push = require('../push/service');
const service = require('./service');
const { localDate } = require('../../lib/time');

function register(app) {
  // ── UA Requests ────────────────────────────────────────────────────
  app.get('/api/ua-requests', requireAuth, async (req, res) => {
    res.json(await service.listPending());
  });

  app.post('/api/ua-requests', requireAuth, csrfCheck, requirePermission('ua.request'), async (req, res) => {
    try {
      const actor = req.session.displayName || req.session.username;
      const r = await service.createRequest(req.body, { actor });
      await audit(req, 'ua.request', 'client', r.targetId, r.label, { room: r.room, interview: r.isIntv });
      broadcast({ type: 'ua_request', requests: await service.listPending() });
      // Lock-screen text: no name, no room.
      push.notify('ua', { body: 'UA requested. Open OpsPoint to see who.', url: '/m/', tag: 'ua' },
        { excludeUserId: req.session.userId }).catch(() => {});
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/ua-requests/:id', requireAuth, csrfCheck, requireAnyPermission('ua.acknowledge', 'ua.record'), async (req, res) => {
    try {
      const r = await service.deleteRequest(req.params.id);
      await audit(req, 'ua.request.delete', 'ua_request', parseInt(req.params.id, 10), r.label, 'Pending request cancelled');
      broadcast({ type: 'ua_request', requests: await service.listPending() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post('/api/ua-requests/:id/acknowledge', requireAuth, csrfCheck, requireAnyPermission('ua.acknowledge', 'ua.record'), async (req, res) => {
    try {
      const actor = req.session.displayName || req.session.username;
      const r = await service.acknowledgeRequest(req.params.id, { actor });
      await audit(req, 'ua.acknowledge', 'ua_request', parseInt(req.params.id, 10), r.label);
      broadcast({ type: 'ua_request', requests: await service.listPending() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── UA Draws ───────────────────────────────────────────────────────
  app.get('/api/ua-draws', requireAuth, async (req, res) => {
    const since = req.query.since || localDate(-30);
    res.json(await service.getDraws(since));
  });

  app.get('/api/ua-draws/recent-clients', requireAuth, requirePermission('ua.draw'), async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json({ ids: Array.from(await service.getRecentDrawn(days)) });
  });

  app.post('/api/ua-draws', requireAuth, csrfCheck, requirePermission('ua.draw'), async (req, res) => {
    try {
      const actor = req.session.displayName || req.session.username;
      const { draw, count } = await service.createDraw(req.body.residents, { actor, actorId: req.session.userId });
      await audit(req, 'ua.draw', 'ua_draw', draw.id, `${count} residents`, { residents: req.body.residents });
      broadcast({ type: 'ua_draw_created', drawId: draw.id, draw, requests: await service.listPending() });
      res.json({ ok: true, drawId: draw.id });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── UA Log (log entries containing UA results) ────────────────────
  app.get('/api/ua-log', requireAuth, async (req, res) => {
    res.json(await service.getUALog(req.query) || []);
  });
}

module.exports = { register };
