'use strict';
/**
 * Reports routes — HTTP layer only. register(app) attaches the data API and the
 * log/report deletion + UA-photo routes in the SAME order and at the SAME paths
 * as the original inline definitions. Per-section authorization is resolved here
 * (userPerms reads live perms from the DB) and passed to the service.
 */
const { requireAuth, requirePermission, requireAnyPermission, userPerms } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { apiRateCheck } = require('../../middleware/rateLimit');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Data API ──────────────────────────────────────────────────────
  app.get('/api/data', requireAuth, (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    res.json(service.getData(userPerms(req)));
  });

  app.post('/api/data', requireAuth, csrfCheck, (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    try {
      const d = req.body;
      const result = service.saveData(d, { perms: userPerms(req) });
      if (Array.isArray(d.reports)) d.reports.forEach(r => {
        const act = r.is_closed ? 'report.close' : 'report.save';
        audit(req, act, 'report', r.id, (r.shift || '') + (r.report_date ? ' ' + r.report_date : ''));
      });
      if (Array.isArray(d.clients) && d.clients.length > 0) audit(req, 'client.bulk_edit', 'client', null, d.clients.length + ' clients');
      broadcast({ type: 'data_saved', user: req.session.displayName, active_report_id: result.activeReportId });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.patch('/api/data', requireAuth, csrfCheck, (req, res) => {
    try {
      const patch = req.body;
      const result = service.patchData(patch, { perms: userPerms(req) });
      if (patch.log_entry) audit(req, 'log.add', 'log_entry', null, (patch.log_entry.text || '').slice(0, 80), { reportId: result.rptId });
      if (patch.statuses) audit(req, 'status.edit', 'report', result.rptId, 'Status update', { count: Object.keys(patch.statuses).length });
      if (patch.issues !== undefined) audit(req, 'issues.edit', 'report', result.rptId, 'Issues update');
      if (patch.med_notes !== undefined) audit(req, 'mednote.edit', 'report', result.rptId, 'Med notes update');
      broadcast({ type: 'patched', patch: result.safePatch, user: req.session.displayName, active_report_id: result.activeReportId });
      res.json({ ok: true, log_entry_id: result.logEntryId });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Delete log entry — log.delete or ua.delete both grant access
  app.delete('/api/log/:id', requireAuth, csrfCheck, requireAnyPermission('log.delete', 'ua.delete'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { label } = service.deleteLog(id);
      audit(req, 'log.delete', 'log_entry', id, label);
      broadcast({ type: 'data_saved', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Delete report ────────────────────────────────────────────────
  app.delete('/api/reports/:id', requireAuth, csrfCheck, requirePermission('reports.delete'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { label } = service.deleteReport(id);
      audit(req, 'report.delete', 'report', id, label);
      broadcast({ type: 'data_saved', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── UA Photo ──────────────────────────────────────────────────────
  app.post('/api/log/:id/photo', requireAuth, csrfCheck, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { photo } = service.saveLogPhoto(id, req.body.photo);
      res.json({ ok: true, photo });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get('/api/log/:id/photo', requireAuth, (req, res) => { // all roles may view UA photos
    try {
      const id = parseInt(req.params.id);
      const { photo } = service.getLogPhoto(id);
      res.json({ ok: true, photo });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
