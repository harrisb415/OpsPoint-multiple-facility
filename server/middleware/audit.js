'use strict';
/** Audit helper — wraps db.auditLog with request context. Never throws. */
const db = require('../../db');

function audit(req, action, targetType, targetId, targetLabel, detail, override) {
  try {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    const actorId   = (override && override.actorId != null) ? override.actorId : (req.session && req.session.userId) || null;
    const actorName = (override && override.actorName) ? override.actorName : (req.session && (req.session.displayName || req.session.username)) || 'system';
    db.auditLog(actorId, actorName, ip, action, targetType || '', targetId != null ? String(targetId) : '', targetLabel || '', detail || '');
  } catch (e) {}
}

module.exports = { audit };
