'use strict';
/**
 * Passes service — business logic for the weekend-passes domain.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 */
const repo = require('./repository');

const VALID_STATUS = ['Out', 'Extended', 'Returned'];

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function list() {
  return repo.list();
}

// Create a pass. Returns the created row (for the response + audit label).
function create(input = {}) {
  const { client_id, room, name, departure, return_date, ua_notes, notes, status } = input;
  if (!client_id || !name) throw httpError(400, 'client_id and name required');
  const client = repo.getClientBrief(parseInt(client_id));
  if (!client) throw httpError(404, 'Client not found');
  if (ua_notes && ua_notes.length > 500) throw httpError(400, 'UA notes too long (max 500 chars)');
  if (notes && notes.length > 1000) throw httpError(400, 'Notes too long (max 1000 chars)');
  return repo.insert({
    client_id: parseInt(client_id),
    room: room || client.room,
    name: name || client.name,
    departure: departure || '',
    return_date: return_date || '',
    ua_notes: ua_notes || '',
    notes: notes || '',
    status: status || 'Out',
  });
}

// Update a pass. `canEditDetails` reflects the caller's passes.edit permission;
// status-only callers may change only the status field. Returns the pass name
// (for the audit label).
function update(id, patch = {}, { canEditDetails } = {}) {
  if (!repo.exists(id)) throw httpError(404, 'Not found');
  const { departure, return_date, ua_notes, notes, status } = patch;

  const touchingNonStatusField =
    departure !== undefined || return_date !== undefined ||
    ua_notes !== undefined || notes !== undefined;
  if (!canEditDetails && touchingNonStatusField) {
    throw httpError(403, 'Permission denied (passes.edit required to change pass details)');
  }

  const fields = {};
  if (departure !== undefined)   fields.departure = departure;
  if (return_date !== undefined) fields.return_date = return_date;
  if (ua_notes !== undefined)    fields.ua_notes = ua_notes;
  if (notes !== undefined)       fields.notes = notes;
  if (status !== undefined && VALID_STATUS.includes(status)) fields.status = status;
  repo.update(id, fields);

  const row = repo.getById(id);
  return row ? row.name : String(id);
}

// Delete a pass. Returns { name } captured before deletion.
function remove(id) {
  const row = repo.getById(id);
  if (!row) throw httpError(404, 'Not found');
  repo.remove(id);
  return { name: row.name };
}

function getNotice() {
  const v = repo.getNotice();
  return v == null ? '' : v;
}

// Persist the pass-notice board text. Returns the stored string (for audit).
function setNotice(notice) {
  const str = String(notice || '');
  if (str.length > 1000) throw httpError(400, 'Notice too long (max 1000 chars)');
  repo.setNotice(str);
  return str;
}

module.exports = { list, create, update, remove, getNotice, setNotice };
