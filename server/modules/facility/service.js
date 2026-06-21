'use strict';
/**
 * Facility service — business logic for facility settings, rooms, and EHR config.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 */
const repo = require('./repository');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function getSettings() {
  return repo.getFacilitySettings();
}

// Validate + save facility settings. Returns { settings, facilityName }.
function saveSettings(b = {}) {
  if (!b.facility_name || !b.facility_name.trim()) throw httpError(400, 'Facility name required');
  if (b.facility_name.trim().length > 200) throw httpError(400, 'Facility name too long (max 200 chars)');
  const settings = repo.saveFacilitySettings(b);
  return { settings, facilityName: b.facility_name.trim() };
}

function listRooms() { return repo.roomsActive(); }
function listVacantRooms() { return repo.vacantRooms(); }

// Edit a room. Returns { room } (current room number) for the audit.
function updateRoom(id, b = {}) {
  if (!repo.getClientId(id)) throw httpError(404, 'Not found');
  const { room, name, is_special, special_label } = b;
  if (room !== undefined) {
    const cur = repo.getClientRoom(id);
    if (cur && String(room) !== String(cur.room)) {
      if (repo.dupActiveRoomExcept(String(room), id)) {
        throw httpError(409, 'Room ' + room + ' already exists. Each room must have a unique number.');
      }
    }
  }
  const fields = {};
  if (room !== undefined) fields.room = String(room);
  if (name !== undefined) fields.name = name;
  if (is_special !== undefined) fields.is_special = is_special ? 1 : 0;
  if (special_label !== undefined) fields.special_label = special_label;
  repo.updateRoomFields(id, fields);
  const fr = repo.getClientRoom(id);
  return { room: fr ? fr.room : id };
}

// Add a room (vacant or named). Returns { client, room, name, is_special }.
function createRoom(b = {}) {
  const { room, name, is_special, special_label } = b;
  if (!room) throw httpError(400, 'Room number required');
  if (repo.dupActiveRoom(String(room))) throw httpError(409, 'Room ' + room + ' already exists. Each room must have a unique number.');
  const max = repo.maxSortOrder();
  const sort_order = (max != null) ? max + 1 : 0;
  const client = repo.insertRoom({ room: String(room), name: name || 'VACANT', is_special: is_special ? 1 : 0, special_label: special_label || null, sort_order });

  // intake log entry when a named, non-special resident is added
  if (name && name !== 'VACANT' && !is_special) {
    const activeId = repo.getActiveReportId();
    if (activeId) {
      const n = new Date(), h = n.getHours(), m = String(n.getMinutes()).padStart(2, '0');
      const ts = `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
      let intakeStr = '';
      if (client && client.intake_date) {
        try {
          const d = new Date(client.intake_date + 'T12:00:00');
          intakeStr = ' Intake: ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '.';
        } catch (e) { /* ignore */ }
      }
      repo.insertLogEntry(activeId, ts, `New resident admitted: ${name}, Rm. ${String(room)}.${intakeStr}`);
      repo.touchReport(activeId, new Date().toISOString());
    }
  }
  return { client, room: String(room), name: name || 'VACANT', is_special: !!is_special };
}

// Delete a room. Returns { room, name } for the audit.
function deleteRoom(id) {
  const c = repo.getClientFull(id);
  if (!c) throw httpError(404, 'Not found');
  if (c.is_active && !c.is_special && c.name !== 'VACANT') {
    throw httpError(400, 'Cannot delete active resident. Discharge first.');
  }
  repo.deleteRoom(id);
  return { room: c.room, name: c.name };
}

function reorder(order) {
  if (!Array.isArray(order)) throw httpError(400, 'order must be array');
  order.forEach((id, i) => repo.setSortOrder(id, i));
  return { count: order.length };
}

function reset(rooms) {
  if (!Array.isArray(rooms)) throw httpError(400, 'rooms must be an array');
  repo.deleteAllClients();
  rooms.forEach((r, i) => repo.insertResetRoom(r, i));
  return { count: rooms.length };
}

function getEhrConfig() { return repo.getEhrConfig(); }

// Save EHR config. Returns { fields } (the keys touched) for the audit.
function saveEhrConfig(b = {}) {
  repo.saveEhrConfig(b);
  return { fields: Object.keys(b) };
}

module.exports = {
  getSettings, saveSettings, listRooms, listVacantRooms,
  updateRoom, createRoom, deleteRoom, reorder, reset, getEhrConfig, saveEhrConfig,
};
