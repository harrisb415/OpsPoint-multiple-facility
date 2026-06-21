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
const { requireUnlocked, requireConsent } = require('../../middleware/recordLock');
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

  // ── Discharge Records (Phase 6) ──────────────────────────────────
  app.get('/api/discharge-records', requireAuth, (req, res) => {
    const rows = service.listDischarges();
    auditRead(req, 'discharge_records', null, `Discharge records list (${rows.length})`);
    res.json(rows);
  });
  app.get('/api/discharge-records/:client_id', requireAuth, (req, res) => {
    const cid = parseInt(req.params.client_id);
    const rows = service.listDischargesForClient(cid);
    auditRead(req, 'discharge_records', null, `Discharges for client ${cid}`, { client_id: cid });
    res.json(rows);
  });
  app.post('/api/discharge-records', requireAuth, csrfCheck, requirePermission('residents.edit'), (req, res) => {
    try {
      const { record, client } = service.createDischarge(req.body || {}, req.session);
      audit(req, 'discharge.create', 'discharge_records', record.id, client.name, { reason: record.reason });
      broadcast({ type: 'data_saved', user: req.session.displayName || req.session.username });
      broadcast({ type: 'discharge_records_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── 42 CFR Part 2 Consent (Phase 7) ──────────────────────────────
  app.get('/api/consent-records/:client_id', requireAuth, requirePermission('consent.manage'), (req, res) => {
    const cid = parseInt(req.params.client_id);
    const rows = service.listConsents(cid);
    auditRead(req, 'consent_records', null, `Consents for client ${cid}`, { client_id: cid });
    res.json(rows);
  });
  app.post('/api/consent-records', requireAuth, csrfCheck, requirePermission('consent.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const rec = service.createConsent(b, req.session);
      audit(req, 'consent.create', 'consent_records', rec.id, b.recipient_name,
        { client_id: b.client_id, information_type: b.information_type, expires: b.expiration_date });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/consent-records/:id/revoke', requireAuth, csrfCheck, requirePermission('consent.manage'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, recipientName, clientId } = service.revokeConsent(id, req.session);
      audit(req, 'consent.revoke', 'consent_records', id, recipientName, { client_id: clientId });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get('/api/disclosures/:client_id', requireAuth, requirePermission('disclosures.view'), (req, res) => {
    const cid = parseInt(req.params.client_id);
    const rows = service.listDisclosures(cid);
    auditRead(req, 'disclosures', null, `Disclosures for client ${cid}`, { client_id: cid });
    res.json(rows);
  });
  // Log an external disclosure — gated by requireConsent (valid consent on file).
  app.post('/api/disclosures', requireAuth, csrfCheck,
    requireConsent(req => req.body && req.body.client_id, 'all'), (req, res) => {
    try {
      const b = req.body || {};
      const rec = service.logDisclosure(b, req.session, req._consent);
      audit(req, 'disclosure.log', 'disclosures', rec.id, b.recipient || '',
        { client_id: b.client_id, information_type: b.information_type, method: b.method });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Phase 8: Supervisor unlock for clinical records ──────────────
  app.post('/api/:table/:id/unlock', requireAuth, csrfCheck, requirePermission('records.unlock'), (req, res) => {
    try {
      const table = String(req.params.table || '');
      const id = parseInt(req.params.id);
      const { reason } = service.unlockRecord(table, id, req.body || {}, req.session);
      audit(req, 'record.unlock', table, id, '', { reason });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
