'use strict';
/**
 * Clients repository — the ONLY place that runs SQL for the clients domain.
 * Rooms and residents share the clients table (see CLAUDE.md room/client model).
 * All access via server/db/connection.js, except the photo disk-write which is
 * delegated to db.savePhoto for now (moves to storage/photoStore later) and the
 * consolidated active-report intake log entry (cross-domain, temporary home).
 */
const c = require('../../db/connection');
const db = require('../../../db');
const reportLog = require('../../db/reportLog'); // shared active-report log helpers

// ── occupancy / vacancy ─────────────────────────────────────────────
async function activeResidentInRoom(room) {
  return await c.query1(`SELECT name FROM clients WHERE room=? AND name!='VACANT' AND is_active=1 AND is_special=0`, [room]);
}
async function activeResidentInRoomExcept(room, id) {
  return await c.query1(`SELECT name FROM clients WHERE room=? AND name!='VACANT' AND is_active=1 AND is_special=0 AND id!=?`, [room, id]);
}
async function vacantInRoom(room) {
  return await c.query1(`SELECT id FROM clients WHERE room=? AND name='VACANT' AND is_active=1`, [room]);
}
async function deleteVacantForRoomExcept(room, id) {
  await c.run(`DELETE FROM clients WHERE room=? AND name='VACANT' AND id!=?`, [room, id]);
}
async function maxSortOrder() {
  const r = await c.query1('SELECT MAX(sort_order) AS m FROM clients');
  return (r && r.m != null) ? r.m : null;
}

// ── reads ────────────────────────────────────────────────────────────
async function getById(id) { return await c.query1('SELECT * FROM clients WHERE id=?', [id]); }
async function exists(id) { return !!await c.query1('SELECT id FROM clients WHERE id=?', [id]); }
async function getRoomActive(id) { return await c.query1('SELECT room,is_active FROM clients WHERE id=?', [id]); }
async function getBrief(id) { return await c.query1('SELECT id,name,room FROM clients WHERE id=?', [id]); }

// ── writes ───────────────────────────────────────────────────────────
// Re-occupy an existing VACANT row as a new resident (avoids duplicate rows).
async function reactivateVacant(id, f) {
  await c.run(`UPDATE clients SET name=?,case_manager=?,phone=?,intake_date=?,is_active=1,
          referral_source=?,program_track=?,emergency_contacts=?,intake_notes=? WHERE id=?`,
    [f.name, f.case_manager, f.phone, f.intake_date, f.referral_source, f.program_track, f.emergency_contacts, f.intake_notes, id]);
}
async function insertClient(f) {
  const info = await c.run(`INSERT INTO clients (room,name,case_manager,phone,intake_date,is_active,is_special,sort_order,
          referral_source,program_track,emergency_contacts,intake_notes)
    VALUES (?,?,?,?,?,1,0,?,?,?,?,?)`,
    [f.room, f.name, f.case_manager, f.phone, f.intake_date, f.sort_order, f.referral_source, f.program_track, f.emergency_contacts, f.intake_notes]);
  return info.lastInsertRowid;
}
async function setRoom(id, room) { await c.run('UPDATE clients SET room=? WHERE id=?', [room, id]); }

const UPDATE_COLUMNS = ['name', 'case_manager', 'phone', 'intake_date', 'discharge_date',
  'is_active', 'referral_source', 'program_track', 'emergency_contacts', 'intake_notes', 'photo'];
// Patch only the provided columns (room is handled separately by the service).
async function applyUpdates(id, fields) {
  for (const col of UPDATE_COLUMNS) {
    if (fields[col] !== undefined) await c.run(`UPDATE clients SET ${col}=? WHERE id=?`, [fields[col], id]);
  }
}

// photo disk write — delegated (transitional -> storage/photoStore)
async function savePhoto(dataUri, fname) { return await db.savePhoto(dataUri, fname); }

// ── active-report intake log helpers — shared (server/db/reportLog) ──
const getActiveReportId = reportLog.getActiveReportId;
const insertLogEntry = reportLog.insertLogEntry;
const touchReport = reportLog.touchReport;

module.exports = {
  activeResidentInRoom, activeResidentInRoomExcept, vacantInRoom, deleteVacantForRoomExcept,
  maxSortOrder, getById, exists, getRoomActive, getBrief,
  reactivateVacant, insertClient, setRoom, applyUpdates, savePhoto,
  getActiveReportId, insertLogEntry, touchReport,
};
