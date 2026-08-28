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

// ── Discharge records ───────────────────────────────────────────────
// Compute days_in_program for a discharge record (was server.js _daysBetween).
function _daysBetween(a, b) {
  if (!a || !b) return 0;
  try {
    const da = new Date(a + 'T00:00:00');
    const dd = new Date(b + 'T00:00:00');
    return Math.max(0, Math.round((dd - da) / 86400000));
  } catch (e) { return 0; }
}

const DISCHARGE_REASONS = ['graduate', 'ama', 'therapeutic', 'administrative'];
const REASON_LABELS = { graduate: 'Graduate', ama: 'AMA', therapeutic: 'Therapeutic discharge', administrative: 'Administrative discharge' };

function listDischarges() { return repo.getDischargeRecords({}); }
function listDischargesForClient(cid) { return repo.getDischargeRecords({ client_id: cid }); }

// Create a discharge: record it, flip the client inactive, free the room with a
// VACANT placeholder, and log it to the active report. Returns { record, client }.
function createDischarge(b = {}, session) {
  if (!b.client_id) throw httpError(400, 'client_id required');
  if (!b.discharge_date) throw httpError(400, 'discharge_date required');
  if (!b.reason || !DISCHARGE_REASONS.includes(b.reason)) throw httpError(400, 'reason must be graduate|ama|therapeutic|administrative');
  const client = repo.getClientById(b.client_id);
  if (!client) throw httpError(404, 'Client not found');

  const record = repo.createDischargeRecord({
    ...b,
    client_name: b.client_name || client.name,
    room: b.room || client.room,
    program_track: b.program_track || client.program_track || '',
    intake_date: b.intake_date || client.intake_date || null,
    days_in_program: _daysBetween(client.intake_date, b.discharge_date),
    created_by_id: session.userId,
    created_by_name: actorName(session),
  });
  repo.dischargeClient(b.client_id, b.discharge_date);
  repo.insertVacantRoom(client.room, client.sort_order || 0);

  const activeId = repo.getActiveReportId();
  if (activeId) {
    const n = new Date(), h = n.getHours(), m = String(n.getMinutes()).padStart(2, '0');
    const ts = `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
    const rLabel = REASON_LABELS[b.reason] || b.reason;
    repo.insertLogEntry(activeId, ts, `Resident discharged: ${client.name}, Rm. ${client.room}. Reason: ${rLabel}.`);
    repo.touchReport(activeId, new Date().toISOString());
  }
  return { record, client };
}

// ── Consent records ─────────────────────────────────────────────────
function listConsents(cid) { return repo.getConsentRecords(cid); }
function createConsent(b = {}, session) {
  if (!b.client_id) throw httpError(400, 'client_id required');
  if (!b.recipient_name) throw httpError(400, 'recipient_name required');
  if (!b.purpose) throw httpError(400, 'purpose required');
  if (!b.effective_date) throw httpError(400, 'effective_date required');
  return repo.createConsentRecord({
    ...b,
    program_name: b.program_name || repo.getFacilityName(),
    created_by_id: session.userId,
    created_by_name: actorName(session),
  });
}
function revokeConsent(id, session) {
  const cur = repo.getConsentRecord(id);
  if (!cur) throw httpError(404, 'Not found');
  const record = repo.revokeConsent(id, actorName(session));
  return { record, recipientName: cur.recipient_name, clientId: cur.client_id };
}

// ── Disclosures ─────────────────────────────────────────────────────
function listDisclosures(cid) { return repo.getDisclosures(cid); }
// `consent` is req._consent set by requireConsent middleware.
function logDisclosure(b = {}, session, consent) {
  return repo.logDisclosure({
    ...b,
    consent_id: b.consent_id || (consent && consent.id) || null,
    disclosed_by_id: session.userId,
    disclosed_by_name: actorName(session),
  });
}

// ── Supervisor unlock ───────────────────────────────────────────────
function unlockRecord(table, id, b = {}, session) {
  if (!repo.clinicalTables().includes(table)) throw httpError(400, 'Invalid table');
  const reason = (b && b.reason) || '';
  if (!reason || !String(reason).trim()) throw httpError(400, 'Reason required to unlock a sealed record');
  if (!repo.isRecordLocked(table, id)) throw httpError(400, 'Record is not locked');
  repo.unlockRecord(table, id, actorName(session), reason);
  return { reason };
}

module.exports = {
  listUA, getUA, createUA, updateUA, deleteUA,
  listMilestones, createMilestone, updateMilestone, signoffMilestone, deleteMilestone,
  listIncidents, createIncident, updateIncident, reviewIncident, deleteIncident,
  listDischarges, listDischargesForClient, createDischarge,
  listConsents, createConsent, revokeConsent,
  listDisclosures, logDisclosure, unlockRecord,
};
