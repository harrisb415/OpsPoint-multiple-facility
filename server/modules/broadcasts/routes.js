'use strict';
/**
 * Broadcasts routes — HTTP layer only. register(app) attaches the routes in the
 * SAME order and at the SAME paths as the original inline definitions.
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Broadcasts ─────────────────────────────────────────────────────
  app.get('/api/broadcasts', requireAuth, (req, res) => {
    res.json(service.list(req.query.hours));
  });

  app.post('/api/broadcasts', requireAuth, csrfCheck, requirePermission('broadcast.send'), (req, res) => {
    try {
      const msg = service.create(req.body.message, {
        actorId: req.session.userId,
        actorName: req.session.displayName || req.session.username,
      });
      audit(req, 'broadcast.send', 'broadcast', msg.id, String(req.body.message || '').trim().slice(0, 500).slice(0, 80));
      broadcast({ type: 'broadcast_message', message: msg });
      res.json({ ok: true, message: msg });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
