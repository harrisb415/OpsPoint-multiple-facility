'use strict';
/**
 * Clinical service — validation + actor stamping for the clinical EHR entities.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 * `session` (req.session) is passed in for the witnessed_by / created_by /
 * logged_by stamps. List methods return { rows, filter } so the route can write
 * the HIPAA read-audit with the record count + filter.
 */
const repo = require('./repository');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const actorName = (s) => s.displayName || s.username || '';

// ── UA records ──────────────────────────────────────────────────────
function listUA(query = {}) {
  const filter = {
    client_id: query.client_id ? parseInt(query.client_id) : null,
    result: query.result || null,
    from: query.from || null,
    to: query.to || null,
  };
  return { rows: repo.getUARecords(filter), filter };
}
function getUA(id) {
  const r = repo.getUARecord(id);
  if (!r) throw httpError(404, 'Not found');
  return r;
}
function createUA(b = {}, session) {
  if (!b.client_id && !b.is_interview) throw httpError(400, 'client_id required');
  if (!b.tested_at) throw httpError(400, 'tested_at required');
  return repo.createUARecord({
    ...b,
    witnessed_by_id: b.witnessed_by_id || session.userId,
    witnessed_by_name: b.witnessed_by_name || actorName(session),
    created_by_id: session.userId,
    created_by_name: actorName(session),
  });
}
function updateUA(id, b = {}) {
  const cur = repo.getUARecord(id);
  if (!cur) throw httpError(404, 'Not found');
  const record = repo.updateUARecord(id, b);
  return { record, clientName: cur.client_name, fields: Object.keys(b) };
}
function deleteUA(id) {
  const cur = repo.getUARecord(id);
  if (!cur) throw httpError(404, 'Not found');
  repo.deleteUARecord(id);
  return { clientName: cur.client_name };
}

// ── Med administration log ──────────────────────────────────────────
function listMed(query = {}) {
  const filter = {
    client_id: query.client_id ? parseInt(query.client_id) : null,
    report_id: query.report_id ? parseInt(query.report_id) : null,
    from: query.from || null,
  };
  return { rows: repo.getMedLog(filter), filter };
}
function createMed(b = {}, session) {
  if (!b.client_id) throw httpError(400, 'client_id required');
  if (!b.administered_at) throw httpError(400, 'administered_at required');
  if (!b.medication || !String(b.medication).trim()) throw httpError(400, 'medication required');
  return repo.createMedLog({
    ...b,
    witnessed_by_id: b.witnessed_by_id || session.userId,
    witnessed_by_name: b.witnessed_by_name || actorName(session),
    created_by_id: session.userId,
    created_by_name: actorName(session),
  });
}
function updateMed(id, b = {}) {
  const record = repo.updateMedLog(id, b);
  if (!record) throw httpError(404, 'Not found');
  return { record, clientName: record.client_name };
}
function deleteMed(id) {
  repo.deleteMedLog(id); // mirrors original: no 404 check
}

// ── Milestones ──────────────────────────────────────────────────────
function listMilestones(query = {}) {
  const filter = {
    client_id: query.client_id ? parseInt(query.client_id) : null,
    status: query.status || null,
  };
  return { rows: repo.getMilestones(filter), filter };
}
function createMilestone(b = {}, session) {
  if (!b.client_id) throw httpError(400, 'client_id required');
  if (!b.objective || !String(b.objective).trim()) throw httpError(400, 'objective required');
  return repo.createMilestone({ ...b, created_by_name: actorName(session) });
}
function updateMilestone(id, b = {}) {
  const record = repo.updateMilestone(id, b);
  if (!record) throw httpError(404, 'Not found');
  return { record, clientName: record.client_name };
}
function signoffMilestone(id, session) {
  const record = repo.signoffMilestone(id, session.userId, actorName(session));
  if (!record) throw httpError(404, 'Not found');
  return { record, clientName: record.client_name };
}
function deleteMilestone(id) {
  repo.deleteMilestone(id); // mirrors original: no 404 check
}

// ── Incidents ───────────────────────────────────────────────────────
function listIncidents(query = {}) {
  const filter = {
    client_id: query.client_id ? parseInt(query.client_id) : null,
    severity: query.severity || null,
    status: query.status || null,
  };
  return { rows: repo.getIncidents(filter), filter };
}
function createIncident(b = {}, session) {
  if (!b.client_id) throw httpError(400, 'client_id required');
  if (!b.incident_date) throw httpError(400, 'incident_date required');
  if (!b.narrative || !String(b.narrative).trim()) throw httpError(400, 'narrative required');
  const sev = String(b.severity || 'low').toLowerCase();
  if (!['low', 'medium', 'high', 'critical'].includes(sev)) throw httpError(400, 'severity must be low|medium|high|critical');
  // Server enforces the minimum required notifications for this severity.
  const policy = repo.getIncidentNotifications();
  const minReq = Array.isArray(policy[sev]) ? policy[sev] : [];
  const supplied = Array.isArray(b.notifications_required) ? b.notifications_required : [];
  const merged = Array.from(new Set([...minReq, ...supplied]));
  const record = repo.createIncident({
    ...b, severity: sev, notifications_required: merged,
    logged_by_id: session.userId,
    logged_by_name: actorName(session),
  });
  return { record, severity: sev, merged };
}
function updateIncident(id, b = {}) {
  const record = repo.updateIncident(id, b);
  if (!record) throw httpError(404, 'Not found');
  return { record, clientName: record.client_name };
}
function reviewIncident(id, b = {}, session) {
  const newStatus = ['reviewed', 'closed'].includes(b.status) ? b.status : 'reviewed';
  const record = repo.reviewIncident(id, session.userId, actorName(session), b.review_notes || '', newStatus);
  if (!record) throw httpError(404, 'Not found');
  return { record, clientName: record.client_name, status: newStatus };
}
function deleteIncident(id) {
  repo.deleteIncident(id); // mirrors original: no 404 check
}

module.exports = {
  listUA, getUA, createUA, updateUA, deleteUA,
  listMed, createMed, updateMed, deleteMed,
  listMilestones, createMilestone, updateMilestone, signoffMilestone, deleteMilestone,
  listIncidents, createIncident, updateIncident, reviewIncident, deleteIncident,
};
