'use strict';
/**
 * Broadcasts routes — HTTP layer only. register(app) attaches the routes in the
 * SAME order and at the SAME paths as the original inline definitions.
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const push = require('../push/service');
const service = require('./service');

function register(app) {
  // ── Broadcasts ─────────────────────────────────────────────────────
  app.get('/api/broadcasts', requireAuth, async (req, res) => {
    res.json(await service.list(req.query.hours));
  });

  app.post('/api/broadcasts', requireAuth, csrfCheck, requirePermission('broadcast.send'), async (req, res) => {
    try {
      const msg = await service.create(req.body.message, {
        actorId: req.session.userId,
        actorName: req.session.displayName || req.session.username,
      });
      await audit(req, 'broadcast.send', 'broadcast', msg.id, String(req.body.message || '').trim().slice(0, 500).slice(0, 80));
      broadcast({ type: 'broadcast_message', message: msg });
      // The sender's name only: the message itself may mention a resident.
      push.notify('broadcast', {
        body: `New announcement from ${req.session.displayName || req.session.username}. Open OpsPoint to read it.`,
        url: '/m/announcements', tag: 'broadcast',
      }, { excludeUserId: req.session.userId }).catch(() => {});
      res.json({ ok: true, message: msg });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
