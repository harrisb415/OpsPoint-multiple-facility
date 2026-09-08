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
async function getFacilitySettings() {
  return {
    facility_name:          await db.getSetting('facility_name',          'OpsPoint'),
    wellness_interval_mins: await db.getSetting('wellness_interval_mins', 120),
    walk_interval_mins:     await db.getSetting('walk_interval_mins',     240),
    walk_areas:             await db.getSetting('walk_areas',             db.DEFAULT_WALK_AREAS),
    ua_panel:               await db.getSetting('ua_panel',               db.DEFAULT_UA_PANEL),
    wellness_schedule:      await db.getSetting('wellness_schedule',      []),
    walk_schedule:          await db.getSetting('walk_schedule',          []),
    shift_day_start:        await db.getSetting('shift_day_start',        '07:00'),
    shift_swing_start:      await db.getSetting('shift_swing_start',      '15:00'),
    shift_grave_start:      await db.getSetting('shift_grave_start',      '23:00'),
    ui_visibility:          await db.getSetting('ui_visibility',          { tabs: { staff: true, chores: true, passes: true, caseloads: true, mail: true, reports: true, violations: true }, buttons: { wellness: true, walkthrough: true } }),
    // Must be returned here, not just from saveFacilitySettings — the Admin
    // panel reads this endpoint, and an absent value made it fall back to the
    // built-in defaults, so removed statuses reappeared on every refresh.
    client_statuses:        await db.getSetting('client_statuses',        []),
    facility_theme:         await db.getSetting('facility_theme',         'indigo'),
  };
}

// Apply the provided settings (only those present) and return the re-read set.
async function saveFacilitySettings(b) {
  await db.setSetting('facility_name', b.facility_name.trim());
  if (b.wellness_interval_mins) await db.setSetting('wellness_interval_mins', parseInt(b.wellness_interval_mins));
  if (b.walk_interval_mins)     await db.setSetting('walk_interval_mins',     parseInt(b.walk_interval_mins));
  if (Array.isArray(b.walk_areas) && b.walk_areas.length) await db.setSetting('walk_areas', b.walk_areas.filter(a => a.trim()));
  if (Array.isArray(b.ua_panel))          await db.setSetting('ua_panel', b.ua_panel.filter(a => a.trim()));
  if (Array.isArray(b.wellness_schedule)) await db.setSetting('wellness_schedule', b.wellness_schedule);
  if (Array.isArray(b.walk_schedule))     await db.setSetting('walk_schedule', b.walk_schedule);
  if (b.shift_day_start && typeof b.shift_day_start === 'string')     await db.setSetting('shift_day_start',   b.shift_day_start.trim());
  if (b.shift_swing_start && typeof b.shift_swing_start === 'string') await db.setSetting('shift_swing_start', b.shift_swing_start.trim());
  if (b.shift_grave_start && typeof b.shift_grave_start === 'string') await db.setSetting('shift_grave_start', b.shift_grave_start.trim());
  if (b.ui_visibility && typeof b.ui_visibility === 'object') await db.setSetting('ui_visibility', b.ui_visibility);
  if (Array.isArray(b.client_statuses)) await db.setSetting('client_statuses', b.client_statuses);
  if (b.facility_theme) await db.setSetting('facility_theme', b.facility_theme);
  return {
    facility_name:          await db.getSetting('facility_name'),
    client_statuses:        await db.getSetting('client_statuses'),
    facility_theme:         await db.getSetting('facility_theme'),
    wellness_interval_mins: await db.getSetting('wellness_interval_mins'),
    walk_interval_mins:     await db.getSetting('walk_interval_mins'),
    walk_areas:             await db.getSetting('walk_areas'),
    ua_panel:               await db.getSetting('ua_panel'),
    wellness_schedule:      await db.getSetting('wellness_schedule'),
    walk_schedule:          await db.getSetting('walk_schedule'),
    shift_day_start:        await db.getSetting('shift_day_start'),
    shift_swing_start:      await db.getSetting('shift_swing_start'),
    shift_grave_start:      await db.getSetting('shift_grave_start'),
    ui_visibility:          await db.getSetting('ui_visibility'),
  };
}

// ── rooms (on clients table) ────────────────────────────────────────
async function roomsActive() {
  return await c.query(`SELECT * FROM clients WHERE is_active=1 ORDER BY CAST(room AS INTEGER), room`);
}
async function vacantRooms() {
  return await c.query(
    `SELECT id,room,sort_order FROM clients
     WHERE name='VACANT' AND is_active=1 AND is_special=0
     AND room NOT IN (
       SELECT room FROM clients WHERE name!='VACANT' AND is_active=1 AND is_special=0
     )
     ORDER BY CAST(room AS INTEGER), room`);
}
async function getClientId(id) { return await c.query1('SELECT id FROM clients WHERE id=?', [id]); }
async function getClientRoom(id) { return await c.query1('SELECT room FROM clients WHERE id=?', [id]); }
async function getClientFull(id) { return await c.query1('SELECT * FROM clients WHERE id=?', [id]); }
async function dupActiveRoom(room) { return await c.query1('SELECT id FROM clients WHERE room=? AND is_active=1', [room]); }
async function dupActiveRoomExcept(room, id) { return await c.query1('SELECT id FROM clients WHERE room=? AND is_active=1 AND id!=?', [room, id]); }
async function maxSortOrder() {
  const r = await c.query1('SELECT MAX(sort_order) as m FROM clients');
  return (r && r.m != null) ? r.m : null;
}
const ROOM_COLS = ['room', 'name', 'is_special', 'special_label'];
async function updateRoomFields(id, fields) {
  for (const col of ROOM_COLS) {
    if (fields[col] !== undefined) await c.run(`UPDATE clients SET ${col}=? WHERE id=?`, [fields[col], id]);
  }
}
async function insertRoom(f) {
  const info = await c.run(`INSERT INTO clients (room,name,is_active,is_special,special_label,sort_order)
    VALUES (?,?,1,?,?,?)`, [f.room, f.name, f.is_special, f.special_label, f.sort_order]);
  return await c.query1('SELECT * FROM clients WHERE id=?', [info.lastInsertRowid]);
}
async function deleteRoom(id) { await c.run('DELETE FROM clients WHERE id=?', [id]); }
async function setSortOrder(id, order) { await c.run('UPDATE clients SET sort_order=? WHERE id=?', [order, id]); }
async function deleteAllClients() { await c.run('DELETE FROM clients'); }
async function insertResetRoom(r, i) {
  await c.run(`INSERT INTO clients (room,name,is_active,is_special,special_label,sort_order) VALUES (?,?,1,?,?,?)`,
    [String(r.room), r.name || 'VACANT', r.is_special ? 1 : 0, r.special_label || null, i]);
}

// ── active-report intake log helpers — shared (server/db/reportLog) ──
const getActiveReportId = reportLog.getActiveReportId;
const insertLogEntry = reportLog.insertLogEntry;
const touchReport = reportLog.touchReport;

// ── EHR config (k/v) ────────────────────────────────────────────────
async function getEhrConfig() {
  return {
    program_tracks:         await db.getSetting('program_tracks',         []),
    program_phases:         await db.getSetting('program_phases',         []),
    incident_notifications: await db.getSetting('incident_notifications', {}),
    session_idle_mins:      parseInt(await db.getSetting('session_idle_mins', 30)) || 30,
  };
}
async function saveEhrConfig(b) {
  if (Array.isArray(b.program_tracks)) await db.setSetting('program_tracks', b.program_tracks.filter(s => String(s || '').trim()));
  if (Array.isArray(b.program_phases)) await db.setSetting('program_phases', b.program_phases);
  if (b.incident_notifications && typeof b.incident_notifications === 'object') await db.setSetting('incident_notifications', b.incident_notifications);
  if (b.session_idle_mins != null) {
    const m = Math.max(5, Math.min(240, parseInt(b.session_idle_mins) || 30));
    await db.setSetting('session_idle_mins', String(m));
  }
}

// Status keys referenced by saved reports — lets the service refuse a status
// removal that would orphan historical data. Delegates to db.js, which owns
// the reports.statuses JSON shape.
async function statusKeysInUse(opts) { return await db.statusKeysInUse(opts); }
async function currentStatuses() { return await db.getSetting('client_statuses', []) || []; }

module.exports = {
  getFacilitySettings, saveFacilitySettings, statusKeysInUse, currentStatuses,
  roomsActive, vacantRooms, getClientId, getClientRoom, getClientFull,
  dupActiveRoom, dupActiveRoomExcept, maxSortOrder, updateRoomFields, insertRoom,
  deleteRoom, setSortOrder, deleteAllClients, insertResetRoom,
  getActiveReportId, insertLogEntry, touchReport,
  getEhrConfig, saveEhrConfig,
};
