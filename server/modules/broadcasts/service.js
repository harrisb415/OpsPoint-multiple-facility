'use strict';
/**
 * Broadcasts service — staff announcements. No SQL, no req/res.
 * Validation failures throw an Error carrying `.status`.
 */
const repo = require('./repository');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function list(hours) {
  return repo.recent(parseInt(hours) || 24);
}

// Create an announcement. Returns the created message.
function create(rawMessage, { actorId, actorName } = {}) {
  const text = String(rawMessage || '').trim().slice(0, 500);
  if (!text) throw httpError(400, 'message required');
  return repo.create(actorId, actorName, text);
}

module.exports = { list, create };
