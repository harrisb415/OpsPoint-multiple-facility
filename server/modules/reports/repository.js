'use strict';
/**
 * Reports repository — SQL for the core shift-report / data API domain
 * (reports, log_entries, the clients bulk-sync, and active_report_id).
 *
 * The big aggregate/serialization helpers (getAllData, upsertReport, savePhoto,
 * getPhotoB64) and the active_report_id setting still live in db.js and are
 * delegated here; everything row-level goes through server/db/connection.js.
 */
const c = require('../../db/connection');
const db = require('../../../db');
const reportLog = require('../../db/reportLog'); // shared active-report log helpers

// ── delegated aggregates / settings (byte-exact with the originals) ──
function getAllData(perms) { return db.getAllData(perms); }
function upsertReport(r) { return db.upsertReport(r); }
function savePhoto(uri, fname) { return db.savePhoto(uri, fname); }
function getPhotoB64(p) { return db.getPhotoB64(p); }
const getActiveReportId = reportLog.getActiveReportId; // shared (server/db/reportLog)
function setActiveReportId(v) { db.setSetting('active_report_id', v); }

// ── report state ────────────────────────────────────────────────────
function isReportClosed(reportId) {
  const r = c.query1('SELECT is_closed FROM reports WHERE id=?', [reportId]);
  return !!(r && r.is_closed);
}

// ── clients bulk sync (POST /api/data) ──────────────────────────────
function allClientsBrief() { return c.query('SELECT id,name,room FROM clients'); }
function clientExists(id) { return c.query1('SELECT id FROM clients WHERE id=?', [id]); }
function deleteClient(id) { c.run('DELETE FROM clients WHERE id=?', [id]); }
function updateClientFull(f) {
  c.run(`UPDATE clients SET room=?,name=?,case_manager=?,phone=?,photo=?,
    intake_date=?,discharge_date=?,is_special=?,is_active=?,special_label=?,sort_order=? WHERE id=?`,
    [f.room, f.name, f.case_manager, f.phone, f.photo,
     f.intake_date, f.discharge_date, f.is_special, f.is_active, f.special_label, f.sort_order, f.id]);
}
function insertClientFull(f) {
  c.run(`INSERT INTO clients (id,room,name,case_manager,phone,photo,intake_date,
    discharge_date,is_special,is_active,special_label,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [f.id, f.room, f.name, f.case_manager, f.phone, f.photo, f.intake_date,
     f.discharge_date, f.is_special, f.is_active, f.special_label, f.sort_order]);
}

// ── report PATCH helpers ────────────────────────────────────────────
const REPORT_JSON_COLS = ['statuses', 'last_ua', 'last_room_search', 'issues', 'med_notes'];
function getReportField(id, col) {
  if (!REPORT_JSON_COLS.includes(col)) throw new Error('bad column ' + col);
  const row = c.query1(`SELECT ${col} FROM reports WHERE id=?`, [id]);
  return row ? row[col] : undefined; // undefined => report row not found
}
function updateReportField(id, col, value, iso) {
  if (!REPORT_JSON_COLS.includes(col)) throw new Error('bad column ' + col);
  c.run(`UPDATE reports SET ${col}=?,updated_at=? WHERE id=?`, [value, iso, id]);
}
const insertLogEntry = reportLog.insertLogEntry; // shared (server/db/reportLog)
const touchReport = reportLog.touchReport;       // shared (server/db/reportLog)
function updateShiftData(id, report_date, shift, mod_name, iso) {
  c.run(`UPDATE reports SET
    report_date=COALESCE(?,report_date),
    shift=COALESCE(?,shift),
    mod_name=COALESCE(?,mod_name),
    updated_at=? WHERE id=?`, [report_date, shift, mod_name, iso, id]);
}

// ── log entry delete ────────────────────────────────────────────────
function getLogText(id) { return c.query1('SELECT text FROM log_entries WHERE id=?', [id]); }
function deleteLog(id) { c.run('DELETE FROM log_entries WHERE id=?', [id]); }

// ── report delete ───────────────────────────────────────────────────
function getReportBrief(id) { return c.query1('SELECT shift,report_date FROM reports WHERE id=?', [id]); }
function deleteLogsForReport(id) { c.run('DELETE FROM log_entries WHERE report_id=?', [id]); }
function deleteReport(id) { c.run('DELETE FROM reports WHERE id=?', [id]); }

// ── UA / log photo ──────────────────────────────────────────────────
function getLogJoinReport(id) {
  return c.query1('SELECT le.id, r.is_closed FROM log_entries le JOIN reports r ON r.id=le.report_id WHERE le.id=?', [id]);
}
function setLogPhoto(id, p) { c.run('UPDATE log_entries SET ua_photo=? WHERE id=?', [p, id]); }
function resolveLogEntry(id) { return c.query1('SELECT * FROM log_entries WHERE id=?', [id]) || null; }

module.exports = {
  getAllData, upsertReport, savePhoto, getPhotoB64, getActiveReportId, setActiveReportId,
  isReportClosed,
  allClientsBrief, clientExists, deleteClient, updateClientFull, insertClientFull,
  getReportField, updateReportField, insertLogEntry, touchReport, updateShiftData,
  getLogText, deleteLog,
  getReportBrief, deleteLogsForReport, deleteReport,
  getLogJoinReport, setLogPhoto, resolveLogEntry,
};
