'use strict';
/**
 * Groups routes — HTTP layer only. register(app) attaches the routes in the SAME
 * order and at the SAME paths as the original inline definitions.
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit, auditRead } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Group Sessions ────────────────────────────────────────────────
  app.get('/api/master-groups', requireAuth, (req, res) => {
    res.json(service.getMaster());
  });

  app.put('/api/master-groups', requireAuth, csrfCheck, requirePermission('groups.log'), (req, res) => {
    try {
      const { count } = service.setMaster(req.body.groups);
      audit(req, 'groups.master_edit', 'settings', null, 'Master Groups', { count });
      broadcast({ type: 'data_saved', user: req.session.displayName || req.session.username });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get('/api/group-sessions', requireAuth, requirePermission('groups.view'), (req, res) => {
    const sessions = service.listSessions(req.query);
    auditRead(req, 'group_sessions', null, `Group sessions (${sessions.length})`);
    res.json(sessions);
  });

  app.post('/api/group-sessions', requireAuth, csrfCheck, requirePermission('groups.log'), (req, res) => {
    try {
      const me = req.session;
      const { session } = service.createSession(req.body, { actorId: me.userId, actorName: me.displayName || me.username || '' });
      audit(req, 'groups.session_create', 'group_sessions', session.id, req.body.group_name, { date: req.body.session_date });
      broadcast({ type: 'data_saved', user: me.displayName || me.username });
      res.json({ ok: true, session });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/group-sessions/:id', requireAuth, csrfCheck, requirePermission('groups.log'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { groupName } = service.deleteSession(id);
      audit(req, 'groups.session_delete', 'group_sessions', id, groupName);
      broadcast({ type: 'data_saved', user: req.session.displayName || req.session.username });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
