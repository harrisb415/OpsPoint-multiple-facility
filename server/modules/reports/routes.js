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
  app.get('/api/data', requireAuth, async (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    res.json(await service.getData(await userPerms(req)));
  });

  app.post('/api/data', requireAuth, csrfCheck, async (req, res) => {
    if (apiRateCheck(req)) return res.status(429).json({ error: 'Too many requests' });
    try {
      const d = req.body;
      const result = await service.saveData(d, { perms: await userPerms(req) });
      if (Array.isArray(d.reports)) for (const r of d.reports) {
        const act = r.is_closed ? 'report.close' : 'report.save';
        await audit(req, act, 'report', r.id, (r.shift || '') + (r.report_date ? ' ' + r.report_date : ''));
      }
      broadcast({ type: 'data_saved', user: req.session.displayName, active_report_id: result.activeReportId });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.patch('/api/data', requireAuth, csrfCheck, async (req, res) => {
    try {
      const patch = req.body;
      const result = await service.patchData(patch, { perms: await userPerms(req) });
      if (patch.log_entry) await audit(req, 'log.add', 'log_entry', null, (patch.log_entry.text || '').slice(0, 80), { reportId: result.rptId });
      if (patch.statuses) await audit(req, 'status.edit', 'report', result.rptId, 'Status update', { count: Object.keys(patch.statuses).length });
      if (patch.issues !== undefined) await audit(req, 'issues.edit', 'report', result.rptId, 'Issues update');
      if (patch.med_notes !== undefined) await audit(req, 'mednote.edit', 'report', result.rptId, 'Med notes update');
      broadcast({ type: 'patched', patch: result.safePatch, user: req.session.displayName, active_report_id: result.activeReportId });
      res.json({ ok: true, log_entry_id: result.logEntryId });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Delete a log line (log.delete) — never a UA line: those are voided.
  app.delete('/api/log/:id', requireAuth, csrfCheck, requirePermission('log.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { label } = await service.deleteLog(id);
      await audit(req, 'log.delete', 'log_entry', id, label);
      broadcast({ type: 'data_saved', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Delete report ────────────────────────────────────────────────
  app.delete('/api/reports/:id', requireAuth, csrfCheck, requirePermission('reports.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { label } = await service.deleteReport(id);
      await audit(req, 'report.delete', 'report', id, label);
      broadcast({ type: 'data_saved', user: req.session.displayName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── UA Photo ──────────────────────────────────────────────────────
  // The UA cup photo: anyone who records UAs, on a UA line, once.
  app.post('/api/log/:id/photo', requireAuth, csrfCheck, requirePermission('ua.record'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { photo } = await service.saveLogPhoto(id, req.body.photo);
      res.json({ ok: true, photo });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get('/api/log/:id/photo', requireAuth, async (req, res) => { // all roles may view UA photos
    try {
      const id = parseInt(req.params.id);
      const { photo } = await service.getLogPhoto(id);
      res.json({ ok: true, photo });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
