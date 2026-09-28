'use strict';
/**
 * Reports repository — SQL for the core shift-report / data API domain
 * (reports, log_entries, and active_report_id).
 *
 * The big aggregate/serialization helpers (getAllData, upsertReport, savePhoto,
 * getPhotoB64) and the active_report_id setting still live in db.js and are
 * delegated here; everything row-level goes through server/db/connection.js.
 */
const c = require('../../db/connection');
const db = require('../../../db');
const reportLog = require('../../db/reportLog'); // shared active-report log helpers

// ── delegated aggregates / settings (byte-exact with the originals) ──
async function getAllData(perms) { return await db.getAllData(perms); }
async function upsertReport(r) { return await db.upsertReport(r); }
async function savePhoto(uri, fname) { return await db.savePhoto(uri, fname); }
async function getPhotoB64(p) { return await db.getPhotoB64(p); }
const getActiveReportId = reportLog.getActiveReportId; // shared (server/db/reportLog)
async function setActiveReportId(v) { await db.setSetting('active_report_id', v); }

// ── report state ────────────────────────────────────────────────────
async function isReportClosed(reportId) {
  const r = await c.query1('SELECT is_closed FROM reports WHERE id=?', [reportId]);
  return !!(r && r.is_closed);
}

// ── report PATCH helpers ────────────────────────────────────────────
const REPORT_JSON_COLS = ['statuses', 'comments', 'last_ua', 'last_room_search', 'issues', 'med_notes'];
// The fields a bulk save may overwrite, as stored (for keeping the ones the caller can't change).
async function getReportRow(id) {
  return await c.query1('SELECT id,is_closed,report_date,shift,mod_name,statuses,comments,last_ua,last_room_search,issues,med_notes FROM reports WHERE id=?', [id]);
}
async function getReportField(id, col) {
  if (!REPORT_JSON_COLS.includes(col)) throw new Error('bad column ' + col);
  const row = await c.query1(`SELECT ${col} FROM reports WHERE id=?`, [id]);
  return row ? row[col] : undefined; // undefined => report row not found
}
async function updateReportField(id, col, value, iso) {
  if (!REPORT_JSON_COLS.includes(col)) throw new Error('bad column ' + col);
  await c.run(`UPDATE reports SET ${col}=?,updated_at=? WHERE id=?`, [value, iso, id]);
}
const insertLogEntry = reportLog.insertLogEntry; // shared (server/db/reportLog)
const touchReport = reportLog.touchReport;       // shared (server/db/reportLog)
async function updateShiftData(id, report_date, shift, mod_name, iso) {
  await c.run(`UPDATE reports SET
    report_date=COALESCE(?,report_date),
    shift=COALESCE(?,shift),
    mod_name=COALESCE(?,mod_name),
    updated_at=? WHERE id=?`, [report_date, shift, mod_name, iso, id]);
}

// ── log entry delete ────────────────────────────────────────────────
async function getLogText(id) { return await c.query1('SELECT text FROM log_entries WHERE id=?', [id]); }
async function getLogWithReport(id) {
  return await c.query1('SELECT le.id, le.text, r.is_closed FROM log_entries le JOIN reports r ON r.id=le.report_id WHERE le.id=?', [id]);
}
async function deleteLog(id) { await c.run('DELETE FROM log_entries WHERE id=?', [id]); }

// ── report delete ───────────────────────────────────────────────────
async function getReportBrief(id) { return await c.query1('SELECT shift,report_date FROM reports WHERE id=?', [id]); }
async function deleteLogsForReport(id) { await c.run('DELETE FROM log_entries WHERE report_id=?', [id]); }
async function deleteReport(id) { await c.run('DELETE FROM reports WHERE id=?', [id]); }

// ── UA / log photo ──────────────────────────────────────────────────
async function getLogJoinReport(id) {
  return await c.query1('SELECT le.id, r.is_closed FROM log_entries le JOIN reports r ON r.id=le.report_id WHERE le.id=?', [id]);
}
async function setLogPhoto(id, p) { await c.run('UPDATE log_entries SET ua_photo=? WHERE id=?', [p, id]); }
async function resolveLogEntry(id) { return await c.query1('SELECT * FROM log_entries WHERE id=?', [id]) || null; }

module.exports = {
  getReportRow, getLogWithReport,
  getAllData, upsertReport, savePhoto, getPhotoB64, getActiveReportId, setActiveReportId,
  isReportClosed,
  getReportField, updateReportField, insertLogEntry, touchReport, updateShiftData,
  getLogText, deleteLog,
  getReportBrief, deleteLogsForReport, deleteReport,
  getLogJoinReport, setLogPhoto, resolveLogEntry,
};
