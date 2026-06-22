'use strict';
/**
 * Facility repository — SQL for facility settings, room management, and the
 * EHR-config settings extension. Rooms live on the clients table. Settings are
 * the k/v store, so those reads/writes delegate to db.getSetting/setSetting
 * (byte-exact with the originals, incl. the DEFAULT_* constants). Row-level room
 * SQL goes through server/db/connection.js. The active-report intake log entry
 * is cross-domain (temporary home, like the other modules).
 */
const c = require('../../db/connection');
const db = require('../../../db');
const reportLog = require('../../db/reportLog'); // shared active-report log helpers

// ── facility settings (k/v) ─────────────────────────────────────────
function getFacilitySettings() {
  return {
    facility_name:          db.getSetting('facility_name',          'OpsPoint'),
    wellness_interval_mins: db.getSetting('wellness_interval_mins', 120),
    walk_interval_mins:     db.getSetting('walk_interval_mins',     240),
    walk_areas:             db.getSetting('walk_areas',             db.DEFAULT_WALK_AREAS),
    ua_panel:               db.getSetting('ua_panel',               db.DEFAULT_UA_PANEL),
    wellness_schedule:      db.getSetting('wellness_schedule',      []),
    walk_schedule:          db.getSetting('walk_schedule',          []),
    shift_day_start:        db.getSetting('shift_day_start',        '07:00'),
    shift_swing_start:      db.getSetting('shift_swing_start',      '15:00'),
    shift_grave_start:      db.getSetting('shift_grave_start',      '23:00'),
    ui_visibility:          db.getSetting('ui_visibility',          { tabs: { staff: true, chores: true, passes: true, caseloads: true, mail: true, reports: true, violations: true }, buttons: { wellness: true, walkthrough: true } }),
  };
}

// Apply the provided settings (only those present) and return the re-read set.
function saveFacilitySettings(b) {
  db.setSetting('facility_name', b.facility_name.trim());
  if (b.wellness_interval_mins) db.setSetting('wellness_interval_mins', parseInt(b.wellness_interval_mins));
  if (b.walk_interval_mins)     db.setSetting('walk_interval_mins',     parseInt(b.walk_interval_mins));
  if (Array.isArray(b.walk_areas) && b.walk_areas.length) db.setSetting('walk_areas', b.walk_areas.filter(a => a.trim()));
  if (Array.isArray(b.ua_panel))          db.setSetting('ua_panel', b.ua_panel.filter(a => a.trim()));
  if (Array.isArray(b.wellness_schedule)) db.setSetting('wellness_schedule', b.wellness_schedule);
  if (Array.isArray(b.walk_schedule))     db.setSetting('walk_schedule', b.walk_schedule);
  if (b.shift_day_start && typeof b.shift_day_start === 'string')     db.setSetting('shift_day_start',   b.shift_day_start.trim());
  if (b.shift_swing_start && typeof b.shift_swing_start === 'string') db.setSetting('shift_swing_start', b.shift_swing_start.trim());
  if (b.shift_grave_start && typeof b.shift_grave_start === 'string') db.setSetting('shift_grave_start', b.shift_grave_start.trim());
  if (b.ui_visibility && typeof b.ui_visibility === 'object') db.setSetting('ui_visibility', b.ui_visibility);
  return {
    facility_name:          db.getSetting('facility_name'),
    wellness_interval_mins: db.getSetting('wellness_interval_mins'),
    walk_interval_mins:     db.getSetting('walk_interval_mins'),
    walk_areas:             db.getSetting('walk_areas'),
    ua_panel:               db.getSetting('ua_panel'),
    wellness_schedule:      db.getSetting('wellness_schedule'),
    walk_schedule:          db.getSetting('walk_schedule'),
    shift_day_start:        db.getSetting('shift_day_start'),
    shift_swing_start:      db.getSetting('shift_swing_start'),
    shift_grave_start:      db.getSetting('shift_grave_start'),
    ui_visibility:          db.getSetting('ui_visibility'),
  };
}

// ── rooms (on clients table) ────────────────────────────────────────
function roomsActive() {
  return c.query(`SELECT * FROM clients WHERE is_active=1 ORDER BY CAST(room AS INTEGER), room`);
}
function vacantRooms() {
  return c.query(
    `SELECT id,room,sort_order FROM clients
     WHERE name='VACANT' AND is_active=1 AND is_special=0
     AND room NOT IN (
       SELECT room FROM clients WHERE name!='VACANT' AND is_active=1 AND is_special=0
     )
     ORDER BY CAST(room AS INTEGER), room`);
}
function getClientId(id) { return c.query1('SELECT id FROM clients WHERE id=?', [id]); }
function getClientRoom(id) { return c.query1('SELECT room FROM clients WHERE id=?', [id]); }
function getClientFull(id) { return c.query1('SELECT * FROM clients WHERE id=?', [id]); }
function dupActiveRoom(room) { return c.query1('SELECT id FROM clients WHERE room=? AND is_active=1', [room]); }
function dupActiveRoomExcept(room, id) { return c.query1('SELECT id FROM clients WHERE room=? AND is_active=1 AND id!=?', [room, id]); }
function maxSortOrder() {
  const r = c.query1('SELECT MAX(sort_order) as m FROM clients');
  return (r && r.m != null) ? r.m : null;
}
const ROOM_COLS = ['room', 'name', 'is_special', 'special_label'];
function updateRoomFields(id, fields) {
  for (const col of ROOM_COLS) {
    if (fields[col] !== undefined) c.run(`UPDATE clients SET ${col}=? WHERE id=?`, [fields[col], id]);
  }
}
function insertRoom(f) {
  const info = c.run(`INSERT INTO clients (room,name,is_active,is_special,special_label,sort_order)
    VALUES (?,?,1,?,?,?)`, [f.room, f.name, f.is_special, f.special_label, f.sort_order]);
  return c.query1('SELECT * FROM clients WHERE id=?', [info.lastInsertRowid]);
}
function deleteRoom(id) { c.run('DELETE FROM clients WHERE id=?', [id]); }
function setSortOrder(id, order) { c.run('UPDATE clients SET sort_order=? WHERE id=?', [order, id]); }
function deleteAllClients() { c.run('DELETE FROM clients'); }
function insertResetRoom(r, i) {
  c.run(`INSERT INTO clients (room,name,is_active,is_special,special_label,sort_order) VALUES (?,?,1,?,?,?)`,
    [String(r.room), r.name || 'VACANT', r.is_special ? 1 : 0, r.special_label || null, i]);
}

// ── active-report intake log helpers — shared (server/db/reportLog) ──
const getActiveReportId = reportLog.getActiveReportId;
const insertLogEntry = reportLog.insertLogEntry;
const touchReport = reportLog.touchReport;

// ── EHR config (k/v) ────────────────────────────────────────────────
function getEhrConfig() {
  return {
    program_tracks:         db.getSetting('program_tracks',         []),
    program_phases:         db.getSetting('program_phases',         []),
    incident_notifications: db.getSetting('incident_notifications', {}),
    session_idle_mins:      parseInt(db.getSetting('session_idle_mins', 30)) || 30,
  };
}
function saveEhrConfig(b) {
  if (Array.isArray(b.program_tracks)) db.setSetting('program_tracks', b.program_tracks.filter(s => String(s || '').trim()));
  if (Array.isArray(b.program_phases)) db.setSetting('program_phases', b.program_phases);
  if (b.incident_notifications && typeof b.incident_notifications === 'object') db.setSetting('incident_notifications', b.incident_notifications);
  if (b.session_idle_mins != null) {
    const m = Math.max(5, Math.min(240, parseInt(b.session_idle_mins) || 30));
    db.setSetting('session_idle_mins', String(m));
  }
}

module.exports = {
  getFacilitySettings, saveFacilitySettings,
  roomsActive, vacantRooms, getClientId, getClientRoom, getClientFull,
  dupActiveRoom, dupActiveRoomExcept, maxSortOrder, updateRoomFields, insertRoom,
  deleteRoom, setSortOrder, deleteAllClients, insertResetRoom,
  getActiveReportId, insertLogEntry, touchReport,
  getEhrConfig, saveEhrConfig,
};
