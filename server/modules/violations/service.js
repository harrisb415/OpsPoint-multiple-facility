'use strict';
/**
 * Violations service — business logic for the violations domain.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 * Lifecycle: pending -> (assigned | waived); assigned -> completed. Any of
 * them can be voided, with a reason — infractions are never deleted.
 */
const repo = require('./repository');
const { nowLocal } = require('../../lib/time');
const { reasonText } = require('../../lib/text');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function counts() {
  return await repo.counts();
}

async function list(query = {}) {
  return await repo.listFiltered(query);
}

// Log a new violation. Returns { id, label, description } for the audit.
// staff_name is the staff member named on the infraction, typed in by hand
// like a UA's "Conducted by"; logged_by is the account that saved it.
async function create(body = {}, { actor } = {}) {
  const { client_id, client_name, room, violation_date, description, notes } = body;
  if (!client_id || !description) throw httpError(400, 'client_id and description required');
  const staff_name = String(body.staff_name || '').trim();
  if (!staff_name) throw httpError(400, 'Staff name is required');
  if (staff_name.length > 80) throw httpError(400, 'Staff name is too long (80 characters at most)');
  const v = await repo.insert({
    client_id,
    client_name: client_name || '',
    room: room || '',
    violation_date: violation_date || null,   // date column: '' is not a date
    description,
    notes: notes || '',
    staff_name,
    logged_by: actor,
  });
  return { id: v ? v.id : null, label: String(client_name || client_id), description };
}

// Review a pending violation: assign a consequence or waive it.
// Returns { clientName, action, consequence } for the audit.
async function review(id, body = {}, { actor } = {}) {
  const v = await repo.getById(id);
  if (!v) throw httpError(404, 'Not found');
  if (v.status !== 'pending') throw httpError(400, 'Violation is not pending review');
  const { action, consequence } = body;
  const now = nowLocal();
  if (action === 'waive') {
    await repo.waive(id, actor, now);
  } else {
    if (!consequence) throw httpError(400, 'consequence required');
    await repo.assign(id, consequence, actor, now);
  }
  return { clientName: v.client_name, action, consequence };
}

// Mark an assigned consequence complete. Returns { clientName } for the audit.
async function complete(id, { actor } = {}) {
  const v = await repo.getById(id);
  if (!v) throw httpError(404, 'Not found');
  if (v.status !== 'assigned') throw httpError(400, 'Violation must have an assigned consequence');
  await repo.complete(id, actor, nowLocal());
  return { clientName: v.client_name };
}

// Void an infraction, with a reason. Returns { clientName, detail } for the
// audit: what it was, and why it was voided.
async function voidViolation(id, { reason, actorId, actorName } = {}) {
  const v = await repo.getById(id);
  if (!v) throw httpError(404, 'Not found');
  if (v.voided_at) throw httpError(409, 'This infraction is already void');
  const why = reasonText(reason);
  if (!why) throw httpError(400, 'Say why this infraction is being voided');
  const done = await repo.voidRow(id, { at: new Date().toISOString(), byId: actorId || null, byName: actorName || '', reason: why });
  if (!done) throw httpError(409, 'This infraction is already void');
  return {
    clientName: v.client_name,
    detail: {
      reason: why, description: v.description, violation_date: v.violation_date || '',
      staff: v.staff_name || v.logged_by || '', status_before: v.status, consequence: v.consequence || '',
    },
  };
}

module.exports = { counts, list, create, review, complete, voidViolation };
