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

async function getActiveReportId() {
  return await db.getSetting('active_report_id', null);
}
async function insertLogEntry(reportId, time, text) {
  return await c.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)', [reportId, time, text]);
}
async function touchReport(reportId, iso) {
  await c.run('UPDATE reports SET updated_at=? WHERE id=?', [iso, reportId]);
}
// A report that exists and isn't closed (sealed) takes new lines.
async function isReportOpen(reportId) {
  const r = await c.query1('SELECT is_closed FROM reports WHERE id=?', [reportId]);
  return !!r && !r.is_closed;
}
// Merge { clientId: 'Sep 28, 2026' } into the report's last-UA stamps.
async function stampLastUa(reportId, stamps, iso) {
  const row = await c.query1('SELECT last_ua FROM reports WHERE id=?', [reportId]);
  if (!row) return;
  let u = {};
  try { u = JSON.parse(row.last_ua || '{}') || {}; } catch (e) { /* keep {} */ }
  Object.assign(u, stamps);
  await c.run('UPDATE reports SET last_ua=?,updated_at=? WHERE id=?', [JSON.stringify(u), iso, reportId]);
}

module.exports = { getActiveReportId, insertLogEntry, touchReport, isReportOpen, stampLastUa };
