'use strict';
/**
 * Active-report log helpers — the single home for the cross-domain "write a line
 * to the currently-active shift report" operation. Several domains (mail, groups,
 * clients, facility, reports) append a consolidated log entry to the active
 * report; rather than each repository carrying its own copy, they delegate here.
 *
 * Lives in the db layer (not a domain module) so no domain depends on another's
 * internals. insertLogEntry returns the run result so callers can read
 * lastInsertRowid (the reports PATCH needs it).
 */
const c = require('./connection');
const db = require('../../db');

function getActiveReportId() {
  return db.getSetting('active_report_id', null);
}
function insertLogEntry(reportId, time, text) {
  return c.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)', [reportId, time, text]);
}
function touchReport(reportId, iso) {
  c.run('UPDATE reports SET updated_at=? WHERE id=?', [iso, reportId]);
}

module.exports = { getActiveReportId, insertLogEntry, touchReport };
