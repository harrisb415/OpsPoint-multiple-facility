'use strict';
/**
 * Clients service — business logic for residents/rooms on the clients table.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 */
const repo = require('./repository');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Validate an inbound data-URI photo by magic bytes; returns the stored path,
// or null if absent/invalid (matching the original "clear photo on bad input").
function processPhoto(photo, id) {
  let pval = null;
  if (photo && typeof photo === 'string' && photo.startsWith('data:image/')) {
    const b64Part = photo.split(',')[1] || '';
    if (b64Part.length <= 5592406) {
      try {
        const bytes = Buffer.from(b64Part.slice(0, 12), 'base64');
        const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
        const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
        const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
        if (isJpeg || isPng || isGif || isWebp) {
          const ext = isGif ? 'gif' : isPng ? 'png' : isWebp ? 'webp' : 'jpg';
          pval = repo.savePhoto(photo, `client_${id}.${ext}`);
        }
      } catch (e) { /* ignore — leaves pval null */ }
    }
  }
  return pval;
}

// Create a resident (re-occupying a VACANT row when one exists for the room).
// Returns { id, client, label }.
function create(body = {}) {
  const { room, name, case_manager, phone, intake_date,
    referral_source, program_track, emergency_contacts, intake_notes } = body;
  if (!name || !String(name).trim()) throw httpError(400, 'Name is required');
  if (!room || !String(room).trim()) throw httpError(400, 'Room is required');
  const occ = repo.activeResidentInRoom(String(room));
  if (occ) throw httpError(409, 'Room ' + room + ' is already occupied by ' + occ.name);

  const common = {
    name: String(name).trim(),
    case_manager: case_manager || '',
    phone: phone || '',
    intake_date: intake_date || null,
    referral_source: referral_source || '',
    program_track: program_track || '',
    emergency_contacts: Array.isArray(emergency_contacts) ? JSON.stringify(emergency_contacts) : '[]',
    intake_notes: intake_notes || '',
  };

  let resultId;
  const vacant = repo.vacantInRoom(String(room));
  if (vacant) {
    repo.reactivateVacant(vacant.id, common);
    resultId = vacant.id;
  } else {
    const max = repo.maxSortOrder();
    resultId = repo.insertClient({ room: String(room), ...common, sort_order: (max != null ? max : 0) + 1 });
  }

  // intake log entry on the active shift report
  const activeId = repo.getActiveReportId();
  if (activeId) {
    const n = new Date(), h = n.getHours(), m = String(n.getMinutes()).padStart(2, '0');
    const ts = `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
    let intakeStr = '';
    if (intake_date) {
      try {
        const d = new Date(intake_date + 'T12:00:00');
        intakeStr = ' Intake: ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '.';
      } catch (e) { /* ignore */ }
    }
    repo.insertLogEntry(activeId, ts, `Resident admitted: ${String(name).trim()}, Rm. ${String(room)}.${intakeStr}`);
    repo.touchReport(activeId, new Date().toISOString());
  }

  const client = resultId ? repo.getById(resultId) : null;
  return { id: resultId, client, label: String(name).trim() + ' Rm.' + String(room) };
}

// Update a resident. Returns { client, label }.
function update(idRaw, body = {}) {
  const id = parseInt(idRaw, 10);
  if (!repo.exists(id)) throw httpError(404, 'Not found');
  const { room, name, case_manager, phone, intake_date, discharge_date, photo, is_active,
    referral_source, program_track, emergency_contacts, intake_notes } = body;
  if (name !== undefined && !name.trim()) throw httpError(400, 'Name cannot be empty');

  // Room change: conflict check + clear the target room's VACANT placeholder.
  if (room !== undefined) {
    const cur = repo.getRoomActive(id);
    if (cur && String(room) !== String(cur.room)) {
      const occ = repo.activeResidentInRoomExcept(String(room), id);
      if (occ) throw httpError(409, 'Room ' + room + ' is already occupied by ' + occ.name);
    }
    const becomingActive = is_active !== undefined ? !!is_active : !!(cur && cur.is_active);
    if (becomingActive) repo.deleteVacantForRoomExcept(String(room), id);
    repo.setRoom(id, String(room));
  }

  const fields = {};
  if (name !== undefined)            fields.name = name.trim();
  if (case_manager !== undefined)    fields.case_manager = case_manager;
  if (phone !== undefined)           fields.phone = phone;
  if (intake_date !== undefined)     fields.intake_date = intake_date || null;
  if (discharge_date !== undefined)  fields.discharge_date = discharge_date || null;
  if (is_active !== undefined)       fields.is_active = is_active ? 1 : 0;
  if (referral_source !== undefined) fields.referral_source = String(referral_source || '');
  if (program_track !== undefined)   fields.program_track = String(program_track || '');
  if (emergency_contacts !== undefined) fields.emergency_contacts = JSON.stringify(Array.isArray(emergency_contacts) ? emergency_contacts : []);
  if (intake_notes !== undefined)    fields.intake_notes = String(intake_notes || '');
  if (photo !== undefined)           fields.photo = processPhoto(photo, id);
  repo.applyUpdates(id, fields);

  const client = repo.getById(id);
  return { client, label: client ? (client.name + ' Rm.' + client.room) : String(id) };
}

// Resolve a client for the profile-view audit gate. Returns { id, name, room }.
function getProfileTarget(idRaw) {
  const id = parseInt(idRaw, 10);
  if (isNaN(id)) throw httpError(400, 'Invalid id');
  const cl = repo.getBrief(id);
  if (!cl) throw httpError(404, 'Not found');
  return cl;
}

module.exports = { create, update, getProfileTarget };
