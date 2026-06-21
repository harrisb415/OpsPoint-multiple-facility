'use strict';
/**
 * Admin repository — the audit-log query lives in db.js (getAuditLog); delegated
 * here. Server restart is process/infra and stays in the composition root
 * (passed into the routes as a dependency).
 */
const db = require('../../../db');

function getAuditLog(opts) { return db.getAuditLog(opts); }

module.exports = { getAuditLog };
