'use strict';
/**
 * Violations service — business logic for the violations domain.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 * Lifecycle: pending -> (assigned | waived); assigned -> completed.
 */
const repo = require('./repository');
const { nowLocal } = require('../../lib/time');

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
async function create(body = {}, { actor } = {}) {
  const { client_id, client_name, room, violation_date, description, notes } = body;
  if (!client_id || !description) throw httpError(400, 'client_id and description required');
  const v = await repo.insert({
    client_id,
    client_name: client_name || '',
    room: room || '',
    violation_date: violation_date || '',
    description,
    notes: notes || '',
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

// Delete a violation. Returns { clientName } for the audit.
async function remove(id) {
  const v = await repo.getClientName(id);
  if (!v) throw httpError(404, 'Not found');
  await repo.remove(id);
  return { clientName: v.client_name };
}

module.exports = { counts, list, create, review, complete, remove };
