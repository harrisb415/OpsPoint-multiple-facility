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

// PHI-read audit — logs that a record/list was viewed (HIPAA access logging).
function auditRead(req, table, targetId, label, detail) {
  audit(req, 'record.read', table, targetId, label || '', detail || '');
}

module.exports = { audit, auditRead };
