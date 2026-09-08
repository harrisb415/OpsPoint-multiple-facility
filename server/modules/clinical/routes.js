'use strict';
/**
 * Clinical routes — HTTP layer for the clinical EHR entities. register(app)
 * attaches them in the SAME order/paths as the inline originals. PATCH/PUT/DELETE
 * on locked-immutable records go through requireUnlocked (server/middleware/
 * recordLock). Reads write the HIPAA read-audit via auditRead.
 *
 * Installment 2 covers ua-records, milestones, incidents. Later
 * installments add discharge/consent/disclosures/unlock and Structured Clinical
 * Lite to this same register().
 */
const { requireAuth, requirePermission, requireAnyPermission, userPerms } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { requireUnlocked, requireConsent } = require('../../middleware/recordLock');
const { audit, auditRead } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');
const repo = require('./repository');

// Parse JSON columns (goals/content) before responding — clients get objects.
function _clinicalParse(row, jsonFields) {
  if (!row || !jsonFields || !jsonFields.length) return row;
  jsonFields.forEach(f => {
    if (typeof row[f] === 'string') {
      try { row[f] = JSON.parse(row[f]); } catch (e) { row[f] = (f === 'content') ? {} : []; }
    }
  });
  return row;
}

function register(app) {
  // ── UA Records (Phase 2) ─────────────────────────────────────────
  app.get('/api/ua-records', requireAuth, async (req, res) => {
    const { rows, filter } = await service.listUA(req.query);
    await auditRead(req, 'ua_records', null, `UA records list (${rows.length})`, filter);
    res.json(rows);
  });
  app.get('/api/ua-records/:id', requireAuth, async (req, res) => {
    try {
      const r = await service.getUA(parseInt(req.params.id));
      await auditRead(req, 'ua_records', r.id, r.client_name);
      res.json(r);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/ua-records', requireAuth, csrfCheck, requirePermission('ua.record'), async (req, res) => {
    try {
      const rec = await service.createUA(req.body || {}, req.session);
      await audit(req, 'ua.record.create', 'ua_records', rec.id, rec.client_name, { result: rec.result });
      broadcast({ type: 'ua_records_updated' });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.patch('/api/ua-records/:id', requireAuth, csrfCheck, requirePermission('ua.record'),
    requireUnlocked('ua_records'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName, fields } = await service.updateUA(id, req.body || {});
      await audit(req, 'ua.record.edit', 'ua_records', id, clientName, { fields });
      broadcast({ type: 'ua_records_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/ua-records/:id', requireAuth, csrfCheck, requirePermission('ua.delete'),
    requireUnlocked('ua_records'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { clientName } = await service.deleteUA(id);
      await audit(req, 'ua.record.delete', 'ua_records', id, clientName);
      broadcast({ type: 'ua_records_updated' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Milestones (Phase 4) ─────────────────────────────────────────
  app.get('/api/milestones', requireAuth, async (req, res) => {
    const { rows, filter } = await service.listMilestones(req.query);
    await auditRead(req, 'milestones', null, `Milestones list (${rows.length})`, filter);
    res.json(rows);
  });
  app.post('/api/milestones', requireAuth, csrfCheck, requirePermission('milestones.edit'), async (req, res) => {
    try {
      const rec = await service.createMilestone(req.body || {}, req.session);
      await audit(req, 'milestone.create', 'milestones', rec.id, rec.client_name, { phase: rec.phase, objective: rec.objective });
      broadcast({ type: 'milestones_updated' });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/milestones/:id', requireAuth, csrfCheck, requirePermission('milestones.edit'),
    requireUnlocked('milestones'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName } = await service.updateMilestone(id, req.body || {});
      await audit(req, 'milestone.edit', 'milestones', id, clientName);
      broadcast({ type: 'milestones_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/milestones/:id/signoff', requireAuth, csrfCheck, requirePermission('milestones.signoff'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName } = await service.signoffMilestone(id, req.session);
      await audit(req, 'milestone.signoff', 'milestones', id, clientName);
      broadcast({ type: 'milestones_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/milestones/:id', requireAuth, csrfCheck, requirePermission('milestones.edit'),
    requireUnlocked('milestones'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await service.deleteMilestone(id);
      await audit(req, 'milestone.delete', 'milestones', id, '');
      broadcast({ type: 'milestones_updated' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Incidents (Phase 5) ──────────────────────────────────────────
  app.get('/api/incidents', requireAuth, async (req, res) => {
    const { rows, filter } = await service.listIncidents(req.query);
    await auditRead(req, 'incidents', null, `Incidents list (${rows.length})`, filter);
    res.json(rows);
  });
  app.post('/api/incidents', requireAuth, csrfCheck, requirePermission('incidents.log'), async (req, res) => {
    try {
      const me = req.session;
      const { record: rec, severity: sev, merged } = await service.createIncident(req.body || {}, me);
      await audit(req, 'incident.create', 'incidents', rec.id, rec.client_name, { severity: sev, notifications: merged });
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
    requireUnlocked('incidents'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName } = await service.updateIncident(id, req.body || {});
      await audit(req, 'incident.edit', 'incidents', id, clientName);
      broadcast({ type: 'incidents_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/incidents/:id/review', requireAuth, csrfCheck, requirePermission('incidents.review'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, clientName, status } = await service.reviewIncident(id, req.body || {}, req.session);
      await audit(req, 'incident.review', 'incidents', id, clientName, { status });
      broadcast({ type: 'incidents_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/incidents/:id', requireAuth, csrfCheck, requirePermission('incidents.delete'),
    requireUnlocked('incidents'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await service.deleteIncident(id);
      await audit(req, 'incident.delete', 'incidents', id, '');
      broadcast({ type: 'incidents_updated' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Discharge Records (Phase 6) ──────────────────────────────────
  app.get('/api/discharge-records', requireAuth, async (req, res) => {
    const rows = await service.listDischarges();
    await auditRead(req, 'discharge_records', null, `Discharge records list (${rows.length})`);
    res.json(rows);
  });
  app.get('/api/discharge-records/:client_id', requireAuth, async (req, res) => {
    const cid = parseInt(req.params.client_id);
    const rows = await service.listDischargesForClient(cid);
    await auditRead(req, 'discharge_records', null, `Discharges for client ${cid}`, { client_id: cid });
    res.json(rows);
  });
  app.post('/api/discharge-records', requireAuth, csrfCheck, requirePermission('residents.edit'), async (req, res) => {
    try {
      const { record, client } = await service.createDischarge(req.body || {}, req.session);
      await audit(req, 'discharge.create', 'discharge_records', record.id, client.name, { reason: record.reason });
      broadcast({ type: 'data_saved', user: req.session.displayName || req.session.username });
      broadcast({ type: 'discharge_records_updated' });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── 42 CFR Part 2 Consent (Phase 7) ──────────────────────────────
  app.get('/api/consent-records/:client_id', requireAuth, requirePermission('consent.manage'), async (req, res) => {
    const cid = parseInt(req.params.client_id);
    const rows = await service.listConsents(cid);
    await auditRead(req, 'consent_records', null, `Consents for client ${cid}`, { client_id: cid });
    res.json(rows);
  });
  app.post('/api/consent-records', requireAuth, csrfCheck, requirePermission('consent.manage'), async (req, res) => {
    try {
      const b = req.body || {};
      const rec = await service.createConsent(b, req.session);
      await audit(req, 'consent.create', 'consent_records', rec.id, b.recipient_name,
        { client_id: b.client_id, information_type: b.information_type, expires: b.expiration_date });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/consent-records/:id/revoke', requireAuth, csrfCheck, requirePermission('consent.manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { record, recipientName, clientId } = await service.revokeConsent(id, req.session);
      await audit(req, 'consent.revoke', 'consent_records', id, recipientName, { client_id: clientId });
      res.json({ ok: true, record });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get('/api/disclosures/:client_id', requireAuth, requirePermission('disclosures.view'), async (req, res) => {
    const cid = parseInt(req.params.client_id);
    const rows = await service.listDisclosures(cid);
    await auditRead(req, 'disclosures', null, `Disclosures for client ${cid}`, { client_id: cid });
    res.json(rows);
  });
  // Log an external disclosure — gated by requireConsent (valid consent on file).
  app.post('/api/disclosures', requireAuth, csrfCheck,
    requireConsent(req => req.body && req.body.client_id, 'all'), async (req, res) => {
    try {
      const b = req.body || {};
      const rec = await service.logDisclosure(b, req.session, req._consent);
      await audit(req, 'disclosure.log', 'disclosures', rec.id, b.recipient || '',
        { client_id: b.client_id, information_type: b.information_type, method: b.method });
      res.json({ ok: true, record: rec });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Phase 8: Supervisor unlock for clinical records ──────────────
  app.post('/api/:table/:id/unlock', requireAuth, csrfCheck, requirePermission('records.unlock'), async (req, res) => {
    try {
      const table = String(req.params.table || '');
      const id = parseInt(req.params.id);
      const { reason } = await service.unlockRecord(table, id, req.body || {}, req.session);
      await audit(req, 'record.unlock', table, id, '', { reason });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Structured Clinical Lite — notes / treatment-plans / assessments /
  //    discharge-summaries via one route factory; goals/content JSON-parsed;
  //    `locked` resources 400 on PUT/DELETE once status==='final'. ──────────
  function registerClinical(opts) {
    const { seg, perm, entity, required = [], jsonFields = [], locked = false, wsType, authorField = 'author_id' } = opts;
    const base = `/api/clinical/${seg}`;
    const ttype = seg.replace(/-/g, '_');

    app.get(base, requireAuth, requirePermission(perm), async (req, res) => {
      const clientId = req.query.clientId ? parseInt(req.query.clientId) : null;
      const rows = await entity.getAll(undefined, clientId);
      rows.forEach(r => _clinicalParse(r, jsonFields));
      await auditRead(req, ttype, null, `Clinical ${seg} list (${rows.length})`, clientId ? { clientId } : undefined);
      res.json(rows);
    });
    app.get(`${base}/:id`, requireAuth, requirePermission(perm), async (req, res) => {
      const row = await entity.getById(undefined, parseInt(req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found' });
      _clinicalParse(row, jsonFields);
      await auditRead(req, ttype, row.id, `Clinical ${seg} #${row.id}`);
      res.json(row);
    });
    app.post(base, requireAuth, csrfCheck, requirePermission(perm), async (req, res) => {
      const b = req.body || {};
      for (const f of required) { if (b[f] == null || b[f] === '') return res.status(400).json({ error: `${f} required` }); }
      const fields = { ...b, [authorField]: req.session.userId };
      const rec = await entity.create(undefined, fields);
      _clinicalParse(rec, jsonFields);
      await audit(req, `${wsType}.create`, ttype, rec.id, '');
      broadcast({ type: `${wsType}_created`, data: rec });
      res.json({ ok: true, record: rec });
    });
    app.put(`${base}/:id`, requireAuth, csrfCheck, requirePermission(perm), async (req, res) => {
      const id = parseInt(req.params.id);
      const existing = await entity.getById(undefined, id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (locked && existing.status === 'final') return res.status(400).json({ error: 'Record is finalised and can no longer be edited.' });
      const rec = await entity.update(undefined, id, req.body || {}, req.session.userId);
      _clinicalParse(rec, jsonFields);
      await audit(req, `${wsType}.update`, ttype, id, '');
      broadcast({ type: `${wsType}_updated`, data: rec });
      res.json({ ok: true, record: rec });
    });
    app.patch(`${base}/:id/sign`, requireAuth, csrfCheck, requirePermission(perm), async (req, res) => {
      const id = parseInt(req.params.id);
      const existing = await entity.getById(undefined, id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const rec = await entity.sign(undefined, id, req.session.userId);
      _clinicalParse(rec, jsonFields);
      await audit(req, `${wsType}.sign`, ttype, id, '');
      broadcast({ type: `${wsType}_signed`, data: rec });
      res.json({ ok: true, record: rec });
    });
    app.delete(`${base}/:id`, requireAuth, csrfCheck, requirePermission(perm), async (req, res) => {
      const id = parseInt(req.params.id);
      const existing = await entity.getById(undefined, id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (locked && existing.status === 'final') return res.status(400).json({ error: 'Record is finalised and cannot be deleted.' });
      await entity.delete(undefined, id, req.session.userId);
      await audit(req, `${wsType}.delete`, ttype, id, '');
      broadcast({ type: `${wsType}_deleted`, id });
      res.json({ ok: true });
    });
  }

  const cdb = repo.clinicalDb;
  registerClinical({ seg: 'notes',               perm: 'clinical.notes',       entity: cdb.notes,              required: ['client_id'], locked: true, wsType: 'clinical_note' });
  registerClinical({ seg: 'treatment-plans',     perm: 'clinical.treatment',   entity: cdb.treatmentPlans,     required: ['client_id'], jsonFields: ['goals'],   wsType: 'treatment_plan' });
  registerClinical({ seg: 'assessments',         perm: 'clinical.assessments', entity: cdb.assessments,        required: ['client_id'], jsonFields: ['content'], wsType: 'assessment' });
  registerClinical({ seg: 'discharge-summaries', perm: 'clinical.discharge',   entity: cdb.dischargeSummaries, required: ['client_id'], locked: true, wsType: 'discharge_summary' });

  // ── Group notes — PA attendance + clinician note/sign on ONE record.
  //    groups.log: attendance only (content/status stripped); clinical.groups:
  //    full note + sign; groups.view: read-only. ────────────────────────────
  const GN = cdb.groupNotes;
  const hasClinicalGroups = async (req) => (await userPerms(req)).includes('clinical.groups');

  app.get('/api/clinical/group-notes', requireAuth, requireAnyPermission('clinical.groups', 'groups.log', 'groups.view'), async (req, res) => {
    const clientId = req.query.clientId ? parseInt(req.query.clientId) : null;
    const rows = await GN.getAll(undefined, clientId);
    await auditRead(req, 'group_notes', null, `Group notes list (${rows.length})`, clientId ? { clientId } : undefined);
    res.json(rows);
  });
  app.get('/api/clinical/group-notes/:id', requireAuth, requireAnyPermission('clinical.groups', 'groups.log', 'groups.view'), async (req, res) => {
    const row = await GN.getById(undefined, parseInt(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    await auditRead(req, 'group_notes', row.id, `Group note #${row.id}`);
    res.json(row);
  });
  app.post('/api/clinical/group-notes', requireAuth, csrfCheck, requireAnyPermission('clinical.groups', 'groups.log'), async (req, res) => {
    const b = req.body || {};
    if (!b.group_name) return res.status(400).json({ error: 'group_name required' });
    const fields = { ...b, facilitator_id: req.session.userId };
    if (!await hasClinicalGroups(req)) { delete fields.content; delete fields.status; } // attendance-only
    const rec = await GN.create(undefined, fields);
    await audit(req, 'group_note.create', 'group_notes', rec.id, fields.group_name || '');
    broadcast({ type: 'group_note_created', data: rec });
    res.json({ ok: true, record: rec });
  });
  app.put('/api/clinical/group-notes/:id', requireAuth, csrfCheck, requireAnyPermission('clinical.groups', 'groups.log'), async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await GN.getById(undefined, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const clinical = await hasClinicalGroups(req);
    if (!clinical && existing.status === 'final') return res.status(400).json({ error: 'Finalised — only clinical staff can edit.' });
    const b = { ...req.body };
    if (!clinical) { delete b.content; delete b.status; } // attendance-only edit can't touch the note
    const rec = await GN.update(undefined, id, b, req.session.userId);
    await audit(req, 'group_note.update', 'group_notes', id, '');
    broadcast({ type: 'group_note_updated', data: rec });
    res.json({ ok: true, record: rec });
  });
  app.patch('/api/clinical/group-notes/:id/sign', requireAuth, csrfCheck, requirePermission('clinical.groups'), async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await GN.getById(undefined, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const rec = await GN.sign(undefined, id, req.session.userId);
    await audit(req, 'group_note.sign', 'group_notes', id, '');
    broadcast({ type: 'group_note_signed', data: rec });
    res.json({ ok: true, record: rec });
  });
  app.delete('/api/clinical/group-notes/:id', requireAuth, csrfCheck, requireAnyPermission('clinical.groups', 'groups.log'), async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await GN.getById(undefined, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!await hasClinicalGroups(req) && existing.status === 'final') return res.status(400).json({ error: 'Finalised — only clinical staff can delete.' });
    await GN.delete(undefined, id, req.session.userId);
    await audit(req, 'group_note.delete', 'group_notes', id, '');
    broadcast({ type: 'group_note_deleted', id });
    res.json({ ok: true });
  });
}

module.exports = { register };
