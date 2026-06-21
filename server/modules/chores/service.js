'use strict';
/**
 * Chores service — business logic for the chores domain.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 */
const repo = require('./repository');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function getMaster() {
  return repo.getMasterChores();
}

// Persist the filtered master chore list. Returns { count } = the raw input
// length (the original audited the pre-filter count).
function setMaster(chores) {
  if (!Array.isArray(chores)) throw httpError(400, 'chores must be array');
  repo.setMasterChores(chores.filter(c => c && c.trim()));
  return { count: chores.length };
}

// Assign/update a client's chore fields. Returns { label, chore } for the audit.
function assignChore(id, patch = {}) {
  if (!repo.clientExists(id)) throw httpError(404, 'Not found');
  const { chore, chore_time, chore_days, chore_day_shifts } = patch;
  const fields = {};
  if (chore !== undefined)            fields.chore = chore || '';
  if (chore_time !== undefined)       fields.chore_time = chore_time || '';
  if (chore_days !== undefined)       fields.chore_days = chore_days != null ? JSON.stringify(chore_days) : null;
  if (chore_day_shifts !== undefined) fields.chore_day_shifts = chore_day_shifts != null ? JSON.stringify(chore_day_shifts) : null;
  repo.updateClientChore(id, fields);

  const cc = repo.getClientNameRoom(id);
  return { label: cc ? (cc.name + ' Rm.' + cc.room) : String(id), chore: chore || '' };
}

// Chore log for a single date or a date range. `query` is req.query.
function getLog({ date, from, to } = {}) {
  if (from && to) return repo.getChoreLogRange(from, to);
  const d = date || new Date().toISOString().slice(0, 10);
  return repo.getChoreLogByDate(d);
}

// Upsert a chore-log completion. No return value needed.
function upsertLog({ client_id, log_date, initials } = {}) {
  if (!client_id || !log_date) throw httpError(400, 'client_id and log_date required');
  repo.upsertChoreLog(parseInt(client_id), log_date, initials || '');
}

module.exports = { getMaster, setMaster, assignChore, getLog, upsertLog };
