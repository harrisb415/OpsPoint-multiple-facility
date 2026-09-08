'use strict';
/**
 * Groups service — business logic for the group-sessions domain.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 */
const repo = require('./repository');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function getMaster() {
  return await repo.getMasterGroups();
}

// Persist the filtered master group list. Returns { count } = raw input length
// (the original audited the pre-filter count).
async function setMaster(groups) {
  if (!Array.isArray(groups)) throw httpError(400, 'groups must be array');
  await repo.setMasterGroups(groups.filter(g => g && g.trim()));
  return { count: groups.length };
}

// List sessions (date or range) with attendance embedded.
async function listSessions({ date, from, to } = {}) {
  const sessions = await repo.getSessions({ date, from, to });
  for (const s of sessions) { s.attendance = await repo.getAttendance(s.id); }
  return sessions;
}

// Create a session, save attendance, and log a line to the active shift report.
// Returns { session }.
async function createSession(body = {}, { actorId, actorName } = {}) {
  if (!body.group_name) throw httpError(400, 'group_name required');
  if (!body.session_date) throw httpError(400, 'session_date required');
  const sess = await repo.createSession({
    session_date: body.session_date,
    group_name: body.group_name,
    time_of_day: body.time_of_day || '',
    facilitator: body.facilitator || '',
    notes: body.notes || '',
    created_by_id: actorId,
    created_by_name: actorName || '',
  });
  if (Array.isArray(body.attendance) && body.attendance.length > 0) {
    await repo.saveAttendance(sess.id, body.attendance);
  }
  const activeId = await repo.getActiveReportId();
  if (activeId) {
    const n = new Date(), h = n.getHours(), m = String(n.getMinutes()).padStart(2, '0');
    const ts = `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
    const att = Array.isArray(body.attendance) ? body.attendance : [];
    const present = att.filter(a => a.present).length;
    const total = att.length;
    const timePart = body.time_of_day ? ` (${body.time_of_day})` : '';
    const facPart = body.facilitator ? `. Facilitator: ${body.facilitator}.` : '';
    const cntPart = total > 0 ? ` — ${present}/${total} attended` : '';
    await repo.insertLogEntry(activeId, ts, `Group: ${body.group_name}${timePart}${cntPart}${facPart}`);
    await repo.touchReport(activeId, new Date().toISOString());
  }
  return { session: sess };
}

// Delete a session. Returns { groupName } for the audit.
async function deleteSession(id) {
  const s = await repo.getSessionBrief(id);
  if (!s) throw httpError(404, 'Not found');
  await repo.deleteSession(id);
  return { groupName: s.group_name };
}

module.exports = { getMaster, setMaster, listSessions, createSession, deleteSession };
