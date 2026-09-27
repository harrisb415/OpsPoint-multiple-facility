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

async function getSettings() {
  return await repo.getFacilitySettings();
}

// Validate + save facility settings. Returns { settings, facilityName }.
// Tones map to a fixed badge palette on the client. Restricting to a set
// (rather than free hex) keeps every status legible and dark-mode safe.
const STATUS_TONES = ['green','blue','amber','purple','pink','red','orange','gray'];
const KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;

// The built-in statuses — also the whole of a new facility's seeded list.
// 'building' is the default state every read falls back to. 'pass' is laid
// over residents whose pass is Out or Extended (client/src/utils/statuses.js,
// effectiveStatuses), so the key has to exist for the Passes tab to work.
// 'hospital' and 'out' are the off-site buckets every facility gets. Labels
// and colours stay editable — only removal is blocked. Mirrors
// SYSTEM_STATUS_KEYS in client/src/utils/statuses.js.
const SYSTEM_STATUS_KEYS = ['building', 'pass', 'hospital', 'out'];

// Validate the editable status list. Keys are what live in reports.statuses,
// so this is stricter than a normal settings field: a bad key silently
// corrupts how historical shifts render.
async function validateStatuses(list) {
  if (!Array.isArray(list)) throw httpError(400, 'Statuses must be a list');
  if (list.length < 1 || list.length > 20) throw httpError(400, 'Between 1 and 20 statuses required');
  const seen = new Set();
  const clean = list.map((raw, i) => {
    const key   = String(raw?.key   || '').trim().toLowerCase();
    const label = String(raw?.label || '').trim();
    const tone  = String(raw?.tone  || 'gray').trim();
    if (!KEY_RE.test(key)) throw httpError(400, `Status ${i + 1}: id must start with a letter and use only lowercase letters, numbers or underscores`);
    if (seen.has(key))     throw httpError(400, `Duplicate status id "${key}"`);
    if (!label)            throw httpError(400, `Status "${key}" needs a label`);
    if (label.length > 40) throw httpError(400, `Status "${key}": label too long (max 40)`);
    if (!STATUS_TONES.includes(tone)) throw httpError(400, `Status "${key}": unknown colour`);
    seen.add(key);
    return { key, label, tone, ...(SYSTEM_STATUS_KEYS.includes(key) ? { system: true } : {}) };
  });

  // The system set must survive every edit.
  const missing = SYSTEM_STATUS_KEYS.filter(k => !seen.has(k));
  if (missing.length) {
    const labels = { building: 'In Building', pass: 'Weekend Pass', hospital: 'Hospital', out: 'Out / Other' };
    throw httpError(400, `These statuses are built in and cannot be removed: ${missing.map(k => labels[k] || k).join(', ')}. Rename or recolour them instead.`);
  }

  // A closed report is an immutable record — retiring a status it references
  // is fine. An OPEN shift is different: staff are using the value right now,
  // and pulling it would strand residents on a status that no longer exists.
  const inOpen  = await repo.statusKeysInUse({ openOnly: true });
  const blocked = inOpen.filter(k => k !== 'vacant' && !seen.has(k));
  if (blocked.length) {
    throw httpError(409,
      `Cannot remove ${blocked.map(k => `"${k}"`).join(', ')} — in use on the open shift report. ` +
      `Close that shift first, or rename the status instead.`);
  }

  // Anything dropped that closed reports still reference is archived rather
  // than deleted: hidden from the picker, but its label is kept so historical
  // shifts keep rendering 'Weekend Pass' instead of a raw 'pass' slug.
  const inAny    = new Set(await repo.statusKeysInUse());
  const previous = await repo.currentStatuses();
  for (const p of previous) {
    if (seen.has(p.key)) continue;         // still present, nothing to do
    if (!inAny.has(p.key)) continue;       // never used anywhere — really delete
    clean.push({ ...p, archived: true });  // used by history — retire it
  }

  // A system key promoted after it had already been retired must come back.
  for (const row of clean) if (row.system) delete row.archived;

  return clean;
}

// Allowlist for the brand theme. Mirrors THEME_KEYS in
// client/src/utils/themes.js — the colours live in client/src/index.css as
// :root[data-theme] blocks, so an unknown key here would store fine and then
// silently render as the default. Kept as a literal because the client list
// is an ESM module in a separate build; add a theme in both places.
const VALID_THEMES = ['indigo', 'blue', 'teal', 'emerald', 'rose', 'beacon'];

async function saveSettings(b = {}) {
  if (!b.facility_name || !b.facility_name.trim()) throw httpError(400, 'Facility name required');
  if (b.facility_name.trim().length > 200) throw httpError(400, 'Facility name too long (max 200 chars)');
  if (b.client_statuses !== undefined) b.client_statuses = await validateStatuses(b.client_statuses);
  if (b.facility_theme !== undefined) {
    if (!VALID_THEMES.includes(b.facility_theme)) throw httpError(400, 'Unknown theme');
  }
  const settings = await repo.saveFacilitySettings(b);
  return { settings, facilityName: b.facility_name.trim() };
}

async function listRooms() { return await repo.roomsActive(); }
async function listVacantRooms() { return await repo.vacantRooms(); }

// Edit a room. Returns { room } (current room number) for the audit.
async function updateRoom(id, b = {}) {
  if (!await repo.getClientId(id)) throw httpError(404, 'Not found');
  const { room, name, is_special, special_label } = b;
  if (room !== undefined) {
    const cur = await repo.getClientRoom(id);
    if (cur && String(room) !== String(cur.room)) {
      if (await repo.dupActiveRoomExcept(String(room), id)) {
        throw httpError(409, 'Room ' + room + ' already exists. Each room must have a unique number.');
      }
    }
  }
  const fields = {};
  if (room !== undefined) fields.room = String(room);
  if (name !== undefined) fields.name = name;
  if (is_special !== undefined) fields.is_special = is_special ? 1 : 0;
  if (special_label !== undefined) fields.special_label = special_label;
  await repo.updateRoomFields(id, fields);
  const fr = await repo.getClientRoom(id);
  return { room: fr ? fr.room : id };
}

// Add a room (vacant or named). Returns { client, room, name, is_special }.
async function createRoom(b = {}) {
  const { room, name, is_special, special_label } = b;
  if (!room) throw httpError(400, 'Room number required');
  if (await repo.dupActiveRoom(String(room))) throw httpError(409, 'Room ' + room + ' already exists. Each room must have a unique number.');
  const max = await repo.maxSortOrder();
  const sort_order = (max != null) ? max + 1 : 0;
  const client = await repo.insertRoom({ room: String(room), name: name || 'VACANT', is_special: is_special ? 1 : 0, special_label: special_label || null, sort_order });

  // intake log entry when a named, non-special resident is added
  if (name && name !== 'VACANT' && !is_special) {
    const activeId = await repo.getActiveReportId();
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
      await repo.insertLogEntry(activeId, ts, `New resident admitted: ${name}, Rm. ${String(room)}.${intakeStr}`);
      await repo.touchReport(activeId, new Date().toISOString());
    }
  }
  return { client, room: String(room), name: name || 'VACANT', is_special: !!is_special };
}

// Delete a room. Returns { room, name } for the audit.
async function deleteRoom(id) {
  const c = await repo.getClientFull(id);
  if (!c) throw httpError(404, 'Not found');
  if (c.is_active && !c.is_special && c.name !== 'VACANT') {
    throw httpError(400, 'Cannot delete active resident. Discharge first.');
  }
  await repo.deleteRoom(id);
  return { room: c.room, name: c.name };
}

async function reorder(order) {
  if (!Array.isArray(order)) throw httpError(400, 'order must be array');
  for (const [i, id] of (order).entries()) { await repo.setSortOrder(id, i); }
  return { count: order.length };
}

async function reset(rooms) {
  if (!Array.isArray(rooms)) throw httpError(400, 'rooms must be an array');
  await repo.deleteAllClients();
  for (const [i, r] of (rooms).entries()) { await repo.insertResetRoom(r, i); }
  return { count: rooms.length };
}

async function getEhrConfig() { return await repo.getEhrConfig(); }

// Save EHR config. Returns { fields } (the keys touched) for the audit.
async function saveEhrConfig(b = {}) {
  await repo.saveEhrConfig(b);
  return { fields: Object.keys(b) };
}

module.exports = {
  getSettings, saveSettings, listRooms, listVacantRooms,
  updateRoom, createRoom, deleteRoom, reorder, reset, getEhrConfig, saveEhrConfig,
};
