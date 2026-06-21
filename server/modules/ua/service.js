'use strict';
/**
 * UA service — business logic for the urinalysis domain (requests + draws).
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 */
const repo = require('./repository');
const { nowLocal } = require('../../lib/time');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function listPending() {
  return repo.listPending();
}

// Create a UA request (resident or interview). Returns audit fields.
function createRequest(body = {}, { actor } = {}) {
  const { client_id, client_name, room, is_interview, interview_name } = body;
  const isIntv = is_interview ? 1 : 0;
  const intvName = String(interview_name || '').slice(0, 200);
  if (!isIntv && !client_id) throw httpError(400, 'client_id required');
  if (isIntv && !intvName) throw httpError(400, 'interview_name required');
  repo.insertRequest({
    client_id: client_id || 0,
    client_name: client_name || '',
    room: room || '',
    requested_by: actor,
    is_interview: isIntv,
    interview_name: intvName,
    requested_at: nowLocal(),
  });
  return {
    targetId: client_id || null,
    label: isIntv ? intvName : (client_name || String(client_id)),
    room: room || '',
    isIntv,
  };
}

// Delete a still-pending request. Returns { label }.
function deleteRequest(idRaw) {
  const id = parseInt(idRaw, 10);
  if (isNaN(id)) throw httpError(400, 'Invalid id');
  const r = repo.getRequestBrief(id);
  if (!r) throw httpError(404, 'Not found');
  if (r.acknowledged) throw httpError(409, 'Request already acknowledged — cannot delete');
  repo.deleteRequest(id);
  return { label: r.client_name + (r.room ? ' Rm.' + r.room : '') };
}

// Acknowledge a request. Returns { label }.
function acknowledgeRequest(idRaw, { actor } = {}) {
  const id = parseInt(idRaw, 10);
  const r = repo.getRequestNameRoom(id);
  repo.acknowledgeRequest(id, actor, nowLocal());
  return { label: r ? (r.client_name + (r.room ? ' Rm.' + r.room : '')) : String(id) };
}

function getDraws(since) {
  return repo.getDraws(since);
}

function getRecentDrawn(days) {
  return repo.getRecentDrawnClientIds(days);
}

// Create a UA draw and queue a pending request per drawn resident.
// Returns { draw, count }.
function createDraw(residents, { actor, actorId } = {}) {
  if (!Array.isArray(residents) || residents.length === 0) throw httpError(400, 'residents required');
  const draw = repo.createDraw(actorId, actor, residents);
  residents.forEach(cl => {
    repo.insertRequest({
      client_id: cl.id || 0,
      client_name: cl.name || '',
      room: cl.room || '',
      requested_by: actor,
      is_interview: 0,
      interview_name: '',
      requested_at: nowLocal(),
    });
  });
  return { draw, count: residents.length };
}

module.exports = { listPending, createRequest, deleteRequest, acknowledgeRequest, getDraws, getRecentDrawn, createDraw };
