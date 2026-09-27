'use strict';
/**
 * Passes service — business logic for the weekend-passes domain.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 */
const repo = require('./repository');

// Pass lifecycle: Approved (granted, resident still on site) -> Out (departed)
// -> Returned. Extended is Out that has run past its return date.
//
// The resident's shift-report status is derived from this, not stored twice:
// ReportTab/DashboardHome map Out and Extended onto the 'pass' status, so an
// Approved pass correctly leaves them In Building until they actually leave.
const VALID_STATUS = ['Approved', 'Out', 'Extended', 'Returned'];

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function list() {
  return await repo.list();
}

// Create a pass. Returns the created row (for the response + audit label).
async function create(input = {}) {
  const { client_id, room, name, departure, return_date, ua_notes, notes, status } = input;
  if (!client_id || !name) throw httpError(400, 'client_id and name required');
  const client = await repo.getClientBrief(parseInt(client_id));
  if (!client) throw httpError(404, 'Client not found');
  if (ua_notes && ua_notes.length > 500) throw httpError(400, 'UA notes too long (max 500 chars)');
  if (notes && notes.length > 1000) throw httpError(400, 'Notes too long (max 1000 chars)');
  return await repo.insert({
    client_id: parseInt(client_id),
    room: room || client.room,
    name: name || client.name,
    // date columns: '' is not a date. SQLite accepted it as TEXT, Postgres
    // rejects it — and NULL is what "no departure yet" actually means.
    departure: departure || null,
    return_date: return_date || null,
    ua_notes: ua_notes || '',
    notes: notes || '',
    status: VALID_STATUS.includes(status) ? status : 'Approved',
  });
}

// The browser's IANA zone ('America/Los_Angeles'), or undefined when it is
// missing or not one Intl recognises. A hosted server runs in UTC, and
// formatting in its own zone wrote extension notes hours away from the times
// the Passes table shows for the very same pass.
function validZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return undefined;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; }
  catch (e) { return undefined; }
}

// One line per extension: when, by whom, and what the return date moved from
// and to. Kept human-readable because it is shown verbatim in the Notes column.
function appendExtensionNote(before, newReturn, actor, timeZone) {
  const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone };
  const fmt = (v) => {
    if (!v) return 'unset';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-US', opts);
  };
  const stamp = new Date().toLocaleString('en-US', opts);
  const who   = actor ? ` by ${actor}` : '';
  const line  = `[Extended ${stamp}${who}: return ${fmt(before.return_date)} -> ${fmt(newReturn)}]`;
  const prev  = (before.notes || '').trim();
  return prev ? [prev, line].join(String.fromCharCode(10)) : line;
}

// Update a pass. `canEditDetails` reflects the caller's passes.edit permission;
// status-only callers may change only the status field. `timeZone` is the
// browser's, used to write the extension note in local time. Returns
// { name } for the audit label, plus `extension` — the updated row — when
// this was an extension, so the route can announce it.
async function update(id, patch = {}, { canEditDetails, actor, timeZone } = {}) {
  const before = await repo.getById(id);
  if (!before) throw httpError(404, 'Not found');
  const { departure, return_date, ua_notes, notes, status } = patch;

  // Extending bundles a status change with a new return date. It is a
  // status-level action — the staff member marking a pass extended is the one
  // on shift — so it does not require passes.edit even though it writes
  // return_date. Any other detail change still does.
  const isExtend = status === 'Extended' && return_date !== undefined;
  if (isExtend && (!return_date || Number.isNaN(new Date(return_date).getTime()))) {
    throw httpError(400, 'A valid new return date and time is required');
  }

  const touchingNonStatusField =
    departure !== undefined || (return_date !== undefined && !isExtend) ||
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

  // Leave a trail on the pass itself so an extension is visible to whoever
  // reads it next, not only in the audit log. Appended rather than replacing,
  // so repeated extensions read as a history.
  if (isExtend) {
    fields.notes = appendExtensionNote(before, return_date, actor, validZone(timeZone));
    // The same extension as data. The note is free text anyone with
    // passes.edit can rewrite; the pass-extended notification reads these.
    fields.extended_at   = new Date().toISOString();
    fields.extended_by   = actor || '';
    fields.extended_from = before.return_date || null;
  }

  await repo.update(id, fields);

  const row = await repo.getById(id);
  return { name: row ? row.name : String(id), extension: isExtend ? row : null };
}

// Delete a pass. Returns { name } captured before deletion.
async function remove(id) {
  const row = await repo.getById(id);
  if (!row) throw httpError(404, 'Not found');
  await repo.remove(id);
  return { name: row.name };
}

async function getNotice() {
  const v = await repo.getNotice();
  return v == null ? '' : v;
}

// Persist the pass-notice board text. Returns the stored string (for audit).
async function setNotice(notice) {
  const str = String(notice || '');
  if (str.length > 1000) throw httpError(400, 'Notice too long (max 1000 chars)');
  await repo.setNotice(str);
  return str;
}

module.exports = { list, create, update, remove, getNotice, setNotice };
