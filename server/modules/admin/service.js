'use strict';
/**
 * Admin service — audit-log querying. No SQL, no req/res. Parses the query
 * params (comma-split action prefixes, bounded limit/offset) and reads via repo.
 */
const repo = require('./repository');

function getAuditLog(query = {}) {
  const { action, actorId, from, to, search, limit, offset } = query;
  const prefixes = action ? action.split(',').map(s => s.trim()).filter(Boolean) : [];
  return repo.getAuditLog({
    actionPrefixes: prefixes,
    actorId: actorId ? parseInt(actorId) : null,
    from: from || null,
    to: to || null,
    search: search || null,
    limit: Math.min(parseInt(limit) || 100, 500),
    offset: parseInt(offset) || 0,
  });
}

module.exports = { getAuditLog };
