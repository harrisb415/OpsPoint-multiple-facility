'use strict';
/**
 * Admin routes — HTTP layer only. register(app, { restartServer }) attaches the
 * server-restart and audit-log endpoints. restartServer is injected from the
 * composition root (process lifecycle stays there).
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app, { restartServer } = {}) {
  // ── Server restart (admin only) ───────────────────────────────────
  app.post('/api/admin/restart', requireAuth, csrfCheck, requirePermission('admin.system'), async (req, res) => {
    await audit(req, 'server.restart', 'server', null, 'Server Restart', { by: req.session.displayName || req.session.username });
    broadcast({ type: 'server_restarting', user: req.session.displayName || req.session.username });
    res.json({ ok: true });
    setTimeout(() => restartServer(), 600);
  });

  // ── Audit Log API ─────────────────────────────────────────────────
  app.get('/api/audit-log', requireAuth, requirePermission('admin.audit'), async (req, res) => {
    res.json(await service.getAuditLog(req.query));
  });
}

module.exports = { register };
