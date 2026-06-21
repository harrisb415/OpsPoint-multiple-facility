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
const service = require('./service');

function register(app) {
  // ── UA Requests ────────────────────────────────────────────────────
  app.get('/api/ua-requests', requireAuth, (req, res) => {
    res.json(service.listPending());
  });

  app.post('/api/ua-requests', requireAuth, csrfCheck, requirePermission('ua.request'), (req, res) => {
    try {
      const actor = req.session.displayName || req.session.username;
      const r = service.createRequest(req.body, { actor });
      audit(req, 'ua.request', 'client', r.targetId, r.label, { room: r.room, interview: r.isIntv });
      broadcast({ type: 'ua_request', requests: service.listPending() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/ua-requests/:id', requireAuth, csrfCheck, requireAnyPermission('ua.acknowledge', 'ua.record'), (req, res) => {
    try {
      const r = service.deleteRequest(req.params.id);
      audit(req, 'ua.request.delete', 'ua_request', parseInt(req.params.id, 10), r.label, 'Pending request cancelled');
      broadcast({ type: 'ua_request', requests: service.listPending() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post('/api/ua-requests/:id/acknowledge', requireAuth, csrfCheck, requireAnyPermission('ua.acknowledge', 'ua.record'), (req, res) => {
    try {
      const actor = req.session.displayName || req.session.username;
      const r = service.acknowledgeRequest(req.params.id, { actor });
      audit(req, 'ua.acknowledge', 'ua_request', parseInt(req.params.id, 10), r.label);
      broadcast({ type: 'ua_request', requests: service.listPending() });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── UA Draws ───────────────────────────────────────────────────────
  app.get('/api/ua-draws', requireAuth, (req, res) => {
    const since = req.query.since || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    res.json(service.getDraws(since));
  });

  app.get('/api/ua-draws/recent-clients', requireAuth, requirePermission('ua.draw'), (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json({ ids: Array.from(service.getRecentDrawn(days)) });
  });

  app.post('/api/ua-draws', requireAuth, csrfCheck, requirePermission('ua.draw'), (req, res) => {
    try {
      const actor = req.session.displayName || req.session.username;
      const { draw, count } = service.createDraw(req.body.residents, { actor, actorId: req.session.userId });
      audit(req, 'ua.draw', 'ua_draw', draw.id, `${count} residents`, { residents: req.body.residents });
      broadcast({ type: 'ua_draw_created', drawId: draw.id, draw, requests: service.listPending() });
      res.json({ ok: true, drawId: draw.id });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
