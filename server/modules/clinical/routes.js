'use strict';
/**
 * Clinical routes — HTTP layer for the clinical EHR entities. register(app)
 * attaches them in the SAME order/paths as the inline originals. PATCH/PUT/DELETE
 * on locked-immutable records go through requireUnlocked (server/middleware/
 * recordLock). Reads write the HIPAA read-audit via auditRead.
 *
 * Installment 2 covers ua-records, med-log, milestones, incidents. Later
 * installments add discharge/consent/disclosures/unlock and Structured Clinical
 * Lite to this same register().
 */
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { requireUnlocked } = require('../../middleware/recordLock');
const { audit, auditRead } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── UA Records (Phase 2) ─────────────────────────────────────────
  app.get('/api/ua-records', requireAuth, (req, res) => {
    const { rows, filter } = service.listUA(req.query);
    auditRead(req, 'ua_records', null, `UA records list (${rows.length})`, filter);
    res.json(rows);
  });
  app.get('/api/ua-records/:id', requireAuth, (req, res) => {
    try {
      const r = service.getUA(parseInt(req.params.id));
      auditRead(req, 'ua_records', r.id, r.client_name);
      res.json(r);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/ua-records', requireAuth, csrfCheck, requirePermission('ua.record'), (req, res) => {
    try {
      const rec = service.createUA(req.body || {}, req.session);
      audit(req, 'ua.record.create', 'ua_records', rec.id, rec.client_name, { result: rec.result });
      broadcast({ type: 'ua_records_updated' });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.patch('/api/ua-records/:id', requireAuth, csrfCheck, requirePermission('ua.record'),
    requireUnlocked('ua_records'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName, fields } = service.updateUA(id, req.body || {});
      audit(req, 'ua.record.edit', 'ua_records', id, clientName, { fields });
      broadcast({ type: 'ua_records_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/ua-records/:id', requireAuth, csrfCheck, requirePermission('ua.delete'),
    requireUnlocked('ua_records'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { clientName } = service.deleteUA(id);
      audit(req, 'ua.record.delete', 'ua_records', id, clientName);
      broadcast({ type: 'ua_records_updated' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Med Administration Log (Phase 3) ─────────────────────────────
  app.get('/api/med-log', requireAuth, (req, res) => {
    const { rows, filter } = service.listMed(req.query);
    auditRead(req, 'med_administration_log', null, `Med log list (${rows.length})`, filter);
    res.json(rows);
  });
  app.post('/api/med-log', requireAuth, csrfCheck, requirePermission('med.witness'), (req, res) => {
    try {
      const rec = service.createMed(req.body || {}, req.session);
      audit(req, 'med.witness', 'med_administration_log', rec.id, rec.client_name, { med: rec.medication });
      broadcast({ type: 'med_log_updated' });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.patch('/api/med-log/:id', requireAuth, csrfCheck, requirePermission('med.witness'),
    requireUnlocked('med_administration_log'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName } = service.updateMed(id, req.body || {});
      audit(req, 'med.edit', 'med_administration_log', id, clientName);
      broadcast({ type: 'med_log_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/med-log/:id', requireAuth, csrfCheck, requirePermission('med.delete'),
    requireUnlocked('med_administration_log'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      service.deleteMed(id);
      audit(req, 'med.delete', 'med_administration_log', id, '');
      broadcast({ type: 'med_log_updated' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Milestones (Phase 4) ─────────────────────────────────────────
  app.get('/api/milestones', requireAuth, (req, res) => {
    const { rows, filter } = service.listMilestones(req.query);
    auditRead(req, 'milestones', null, `Milestones list (${rows.length})`, filter);
    res.json(rows);
  });
  app.post('/api/milestones', requireAuth, csrfCheck, requirePermission('milestones.edit'), (req, res) => {
    try {
      const rec = service.createMilestone(req.body || {}, req.session);
      audit(req, 'milestone.create', 'milestones', rec.id, rec.client_name, { phase: rec.phase, objective: rec.objective });
      broadcast({ type: 'milestones_updated' });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/milestones/:id', requireAuth, csrfCheck, requirePermission('milestones.edit'),
    requireUnlocked('milestones'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName } = service.updateMilestone(id, req.body || {});
      audit(req, 'milestone.edit', 'milestones', id, clientName);
      broadcast({ type: 'milestones_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/milestones/:id/signoff', requireAuth, csrfCheck, requirePermission('milestones.signoff'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName } = service.signoffMilestone(id, req.session);
      audit(req, 'milestone.signoff', 'milestones', id, clientName);
      broadcast({ type: 'milestones_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/milestones/:id', requireAuth, csrfCheck, requirePermission('milestones.edit'),
    requireUnlocked('milestones'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      service.deleteMilestone(id);
      audit(req, 'milestone.delete', 'milestones', id, '');
      broadcast({ type: 'milestones_updated' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Incidents (Phase 5) ──────────────────────────────────────────
  app.get('/api/incidents', requireAuth, (req, res) => {
    const { rows, filter } = service.listIncidents(req.query);
    auditRead(req, 'incidents', null, `Incidents list (${rows.length})`, filter);
    res.json(rows);
  });
  app.post('/api/incidents', requireAuth, csrfCheck, requirePermission('incidents.log'), (req, res) => {
    try {
      const me = req.session;
      const { record: rec, severity: sev, merged } = service.createIncident(req.body || {}, me);
      audit(req, 'incident.create', 'incidents', rec.id, rec.client_name, { severity: sev, notifications: merged });
      broadcast({ type: 'incidents_updated' });
      broadcast({ type: 'incident_notification', incident: {
        id: rec.id, client_name: rec.client_name, room: rec.room,
        severity: sev, incident_type: rec.incident_type, incident_date: rec.incident_date,
        logged_by: me.displayName || me.username || '',
      } });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/incidents/:id', requireAuth, csrfCheck, requirePermission('incidents.log'),
    requireUnlocked('incidents'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName } = service.updateIncident(id, req.body || {});
      audit(req, 'incident.edit', 'incidents', id, clientName);
      broadcast({ type: 'incidents_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/incidents/:id/review', requireAuth, csrfCheck, requirePermission('incidents.review'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName, status } = service.reviewIncident(id, req.body || {}, req.session);
      audit(req, 'incident.review', 'incidents', id, clientName, { status });
      broadcast({ type: 'incidents_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/incidents/:id', requireAuth, csrfCheck, requirePermission('incidents.delete'),
    requireUnlocked('incidents'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      service.deleteIncident(id);
      audit(req, 'incident.delete', 'incidents', id, '');
      broadcast({ type: 'incidents_updated' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
