'use strict';
/**
 * Clinical service — validation + actor stamping for the clinical EHR entities.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 * `session` (req.session) is passed in for the witnessed_by / created_by /
 * logged_by stamps. List methods return { rows, filter } so the route can write
 * the HIPAA read-audit with the record count + filter.
 */
const repo = require('./repository');
const reportLog = require('../../db/reportLog');
const { sanitizeText, validTime, reasonText } = require('../../lib/text');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const actorName = (s) => s.displayName || s.username || '';

// ── UA records ──────────────────────────────────────────────────────
async function listUA(query = {}) {
  const filter = {
    client_id: query.client_id ? parseInt(query.client_id) : null,
    result: query.result || null,
    from: query.from || null,
    to: query.to || null,
  };
  return { rows: await repo.getUARecords(filter), filter };
}
async function getUA(id) {
  const r = await repo.getUARecord(id);
  if (!r) throw httpError(404, 'Not found');
  return r;
}
const UA_REASONS = { suspicious: 'Suspicion', random: 'Random', return_from_pass: 'Return from pass', cm_request: 'CM request', other: 'Other' };
const UA_METHODS = { observed: 'Observed', unobserved: 'Unobserved', lab: 'Lab' };

// The shift-log line for a recorded UA, worded as the UA form used to write
// it. Built from the record's own fields (panel codes, known reasons and
// methods only), so recording a UA is no way to write an arbitrary line.
function uaLogText(b, subject) {
  const results = b.panel_results && typeof b.panel_results === 'object' ? b.panel_results : {};
  const pos = [], neg = [], nt = [];
  for (const [code, v] of Object.entries(results)) {
    if (/^[A-Za-z0-9-]{1,12}$/.test(code)) (v === 'pos' ? pos : v === 'na' ? nt : neg).push(code);
  }
  const parts = [pos.length && `POS: ${pos.join(', ')}`, neg.length && `NEG: ${neg.join(', ')}`, nt.length && `NT: ${nt.join(', ')}`].filter(Boolean);
  const reason = UA_REASONS[b.reason] || (b.is_interview ? 'Interview' : '');
  const by = String(b.witnessed_by_name || '').trim().slice(0, 80);
  const suffix = ` — by ${by} [${[reason, UA_METHODS[b.collection_method] || ''].filter(Boolean).join(', ')}]`;
  return !pos.length && !nt.length
    ? `${subject} — UA: All NEG${suffix}`
    : `${subject} — UA: ${parts.join(' | ') || 'No results entered'}${suffix}`;
}
const uaDateStamp = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Resolves { record, log }. With `log_time`, the UA's line in the open shift
// log and the resident's last-UA stamp are written as part of recording it,
// so "Record UA results" alone covers a UA: no separate log.add or
// ua.request, and no refused second request leaving half a record behind.
// No open report: the record is saved without a line (log is null).
async function createUA(b = {}, session) {
  if (!b.client_id && !b.is_interview) throw httpError(400, 'client_id required');
  if (!b.tested_at) throw httpError(400, 'tested_at required');

  let log = null;
  if (b.log_time != null) {
    const time = String(b.log_time);
    if (!validTime(time)) throw httpError(400, `Invalid log entry time "${time.slice(0, 20)}" — expected format H:MM AM/PM`);
    const rptId = parseInt(await reportLog.getActiveReportId());
    if (rptId && await reportLog.isReportOpen(rptId)) {
      const client = b.is_interview ? null : await repo.getClientById(b.client_id);
      const subject = b.is_interview
        ? (String(b.client_name || '').trim().slice(0, 100) || 'Interview')
        : `${client ? client.name : (b.client_name || 'Unknown')} (Rm. ${client ? client.room : (b.room || '?')})`;
      const text = sanitizeText(uaLogText(b, subject), 2000);
      const ins = await reportLog.insertLogEntry(rptId, time, text);
      const iso = new Date().toISOString();
      await reportLog.touchReport(rptId, iso);
      const lastUa = b.is_interview ? null : { [parseInt(b.client_id)]: uaDateStamp() };
      if (lastUa) await reportLog.stampLastUa(rptId, lastUa, iso);
      log = {
        rptId,
        logEntryId: (ins && ins.lastInsertRowid) || null,
        patch: { reportId: rptId, log_entry: { time, text }, ...(lastUa ? { last_ua: lastUa } : {}) },
      };
    }
  }

  const record = await repo.createUARecord({
    ...b,
    log_entry_id: log ? log.logEntryId : (b.log_entry_id || null),
    witnessed_by_id: b.witnessed_by_id || session.userId,
    witnessed_by_name: b.witnessed_by_name || actorName(session),
    created_by_id: session.userId,
    created_by_name: actorName(session),
  });
  return { record, log };
}
async function updateUA(id, b = {}) {
  const cur = await repo.getUARecord(id);
  if (!cur) throw httpError(404, 'Not found');
  if (cur.voided_at) throw httpError(409, 'This UA result is void and can no longer be changed');
  const record = await repo.updateUARecord(id, b);
  return { record, clientName: cur.client_name, fields: Object.keys(b) };
}

// Void a UA result (it is never deleted): the record and its shift-log line
// stay, marked void with who, when and why. ua.void, a reason required; sealed
// records can be voided too — finding a mistake later is the point.
function voidStamp(reason, session) {
  const why = String(reason == null ? '' : reason).replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!why) throw httpError(400, 'Say why this UA result is being voided');
  return { at: new Date().toISOString(), byId: session.userId, byName: actorName(session), reason: why.slice(0, 500) };
}
async function voidUA(id, reason, session) {
  const cur = await repo.getUARecord(id);
  if (!cur) throw httpError(404, 'Not found');
  if (cur.voided_at) throw httpError(409, 'This UA result is already void');
  const v = voidStamp(reason, session);
  await repo.voidUARecord(id, v);
  if (cur.log_entry_id) await repo.voidLogEntry(cur.log_entry_id, v);
  return { record: await repo.getUARecord(id), clientName: cur.client_name, logEntryId: cur.log_entry_id || null };
}
// The Report tab voids a UA line: its record too, when it has one.
async function voidUALine(logId, reason, session) {
  const le = await repo.getLogEntry(logId);
  if (!le) throw httpError(404, 'Log entry not found');
  if (le.voided_at) throw httpError(409, 'This UA entry is already void');
  const rec = await repo.uaRecordForLogEntry(logId);
  if (rec) return voidUA(rec.id, reason, session);
  if (!/\s—\sUA:/i.test(le.text || '')) throw httpError(400, 'Only UA entries are voided; other lines are deleted');
  const v = voidStamp(reason, session);
  await repo.voidLogEntry(logId, v);
  return { record: null, clientName: String(le.text || '').split(' — ')[0], logEntryId: logId };
}

// ── Milestones ──────────────────────────────────────────────────────
async function listMilestones(query = {}) {
  const filter = {
    client_id: query.client_id ? parseInt(query.client_id) : null,
    status: query.status || null,
  };
  return { rows: await repo.getMilestones(filter), filter };
}
async function createMilestone(b = {}, session) {
  if (!b.client_id) throw httpError(400, 'client_id required');
  if (!b.objective || !String(b.objective).trim()) throw httpError(400, 'objective required');
  return await repo.createMilestone({ ...b, created_by_name: actorName(session) });
}
async function updateMilestone(id, b = {}) {
  const record = await repo.updateMilestone(id, b);
  if (!record) throw httpError(404, 'Not found');
  return { record, clientName: record.client_name };
}
async function signoffMilestone(id, session) {
  const record = await repo.signoffMilestone(id, session.userId, actorName(session));
  if (!record) throw httpError(404, 'Not found');
  return { record, clientName: record.client_name };
}
async function deleteMilestone(id) {
  await repo.deleteMilestone(id); // mirrors original: no 404 check
}

// ── Incidents ───────────────────────────────────────────────────────
async function listIncidents(query = {}) {
  const filter = {
    client_id: query.client_id ? parseInt(query.client_id) : null,
    severity: query.severity || null,
    status: query.status || null,
  };
  return { rows: await repo.getIncidents(filter), filter };
}
async function createIncident(b = {}, session) {
  if (!b.client_id) throw httpError(400, 'client_id required');
  if (!b.incident_date) throw httpError(400, 'incident_date required');
  if (!b.narrative || !String(b.narrative).trim()) throw httpError(400, 'narrative required');
  const sev = String(b.severity || 'low').toLowerCase();
  if (!['low', 'medium', 'high', 'critical'].includes(sev)) throw httpError(400, 'severity must be low|medium|high|critical');
  // Server enforces the minimum required notifications for this severity.
  const policy = await repo.getIncidentNotifications();
  const minReq = Array.isArray(policy[sev]) ? policy[sev] : [];
  const supplied = Array.isArray(b.notifications_required) ? b.notifications_required : [];
  const merged = Array.from(new Set([...minReq, ...supplied]));
  const record = await repo.createIncident({
    ...b, severity: sev, notifications_required: merged,
    logged_by_id: session.userId,
    logged_by_name: actorName(session),
  });
  return { record, severity: sev, merged };
}
// A voided incident report is kept as it was: no edits, no review.
async function notVoided(id) {
  const cur = await repo.getIncident(id);
  if (!cur) throw httpError(404, 'Not found');
  if (cur.voided_at) throw httpError(409, 'This incident report was voided and can no longer be changed.');
  return cur;
}
async function updateIncident(id, b = {}) {
  await notVoided(id);
  const record = await repo.updateIncident(id, b);
  if (!record) throw httpError(404, 'Not found');
  return { record, clientName: record.client_name };
}
async function reviewIncident(id, b = {}, session) {
  await notVoided(id);
  const newStatus = ['reviewed', 'closed'].includes(b.status) ? b.status : 'reviewed';
  const record = await repo.reviewIncident(id, session.userId, actorName(session), b.review_notes || '', newStatus);
  if (!record) throw httpError(404, 'Not found');
  return { record, clientName: record.client_name, status: newStatus };
}
// Incident reports are never deleted: a mistaken one is voided, with a
// reason, and stays on file. Allowed after the 24-hour edit lock too, since
// voiding changes nothing the report says. Returns { clientName, detail } for
// the audit — the audit log only: incidents are clinical, so nothing goes in
// the shift log.
async function voidIncident(id, b = {}, session) {
  const cur = await repo.getIncident(id);
  if (!cur) throw httpError(404, 'Not found');
  if (cur.voided_at) throw httpError(409, 'This incident report is already void');
  const why = reasonText(b.reason);
  if (!why) throw httpError(400, 'Say why this incident report is being voided');
  const done = await repo.voidIncident(id, { at: new Date().toISOString(), byId: session.userId, byName: actorName(session), reason: why });
  if (!done) throw httpError(409, 'This incident report is already void');
  // The API takes a client_id alone, so the stored name can be blank.
  const clientName = cur.client_name || ((await repo.getClientById(cur.client_id)) || {}).name || '';
  return {
    clientName,
    detail: { reason: why, resident: clientName, incident_date: cur.incident_date, severity: cur.severity, status_before: cur.status },
  };
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

async function listDischarges() { return await repo.getDischargeRecords({}); }
async function listDischargesForClient(cid) { return await repo.getDischargeRecords({ client_id: cid }); }

// Create a discharge: record it, flip the client inactive, free the room with a
// VACANT placeholder, and log it to the active report. Returns { record, client }.
async function createDischarge(b = {}, session) {
  if (!b.client_id) throw httpError(400, 'client_id required');
  if (!b.discharge_date) throw httpError(400, 'discharge_date required');
  if (!b.reason || !DISCHARGE_REASONS.includes(b.reason)) throw httpError(400, 'reason must be graduate|ama|therapeutic|administrative');
  const client = await repo.getClientById(b.client_id);
  if (!client) throw httpError(404, 'Client not found');

  const record = await repo.createDischargeRecord({
    ...b,
    client_name: b.client_name || client.name,
    room: b.room || client.room,
    program_track: b.program_track || client.program_track || '',
    intake_date: b.intake_date || client.intake_date || null,
    days_in_program: _daysBetween(client.intake_date, b.discharge_date),
    created_by_id: session.userId,
    created_by_name: actorName(session),
  });
  await repo.dischargeClient(b.client_id, b.discharge_date);
  await repo.insertVacantRoom(client.room, client.sort_order || 0);

  const activeId = await repo.getActiveReportId();
  if (activeId) {
    const n = new Date(), h = n.getHours(), m = String(n.getMinutes()).padStart(2, '0');
    const ts = `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
    const rLabel = REASON_LABELS[b.reason] || b.reason;
    await repo.insertLogEntry(activeId, ts, `Resident discharged: ${client.name}, Rm. ${client.room}. Reason: ${rLabel}.`);
    await repo.touchReport(activeId, new Date().toISOString());
  }
  return { record, client };
}

// ── Consent records ─────────────────────────────────────────────────
async function listConsents(cid) { return await repo.getConsentRecords(cid); }
async function createConsent(b = {}, session) {
  if (!b.client_id) throw httpError(400, 'client_id required');
  if (!b.recipient_name) throw httpError(400, 'recipient_name required');
  if (!b.purpose) throw httpError(400, 'purpose required');
  if (!b.effective_date) throw httpError(400, 'effective_date required');
  return await repo.createConsentRecord({
    ...b,
    program_name: b.program_name || await repo.getFacilityName(),
    created_by_id: session.userId,
    created_by_name: actorName(session),
  });
}
async function revokeConsent(id, session) {
  const cur = await repo.getConsentRecord(id);
  if (!cur) throw httpError(404, 'Not found');
  const record = await repo.revokeConsent(id, actorName(session));
  return { record, recipientName: cur.recipient_name, clientId: cur.client_id };
}

// ── Disclosures ─────────────────────────────────────────────────────
async function listDisclosures(cid) { return await repo.getDisclosures(cid); }
// `consent` is req._consent set by requireConsent middleware.
async function logDisclosure(b = {}, session, consent) {
  return await repo.logDisclosure({
    ...b,
    consent_id: b.consent_id || (consent && consent.id) || null,
    disclosed_by_id: session.userId,
    disclosed_by_name: actorName(session),
  });
}

// ── Supervisor unlock ───────────────────────────────────────────────
async function unlockRecord(table, id, b = {}, session) {
  if (!(await repo.clinicalTables()).includes(table)) throw httpError(400, 'Invalid table');
  const reason = (b && b.reason) || '';
  if (!reason || !String(reason).trim()) throw httpError(400, 'Reason required to unlock a sealed record');
  if (!await repo.isRecordLocked(table, id)) throw httpError(400, 'Record is not locked');
  await repo.unlockRecord(table, id, actorName(session), reason);
  return { reason };
}

module.exports = {
  listUA, getUA, createUA, updateUA, voidUA, voidUALine,
  listMilestones, createMilestone, updateMilestone, signoffMilestone, deleteMilestone,
  listIncidents, createIncident, updateIncident, reviewIncident, voidIncident,
  listDischarges, listDischargesForClient, createDischarge,
  listConsents, createConsent, revokeConsent,
  listDisclosures, logDisclosure, unlockRecord,
};
