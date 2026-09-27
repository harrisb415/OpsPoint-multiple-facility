'use strict';
/**
 * Reports service — the core shift-report read/write/patch logic and log-entry
 * + report deletion. No SQL, no req/res. Per-section authorization takes a
 * resolved `perms` array (the route reads it from the DB via userPerms). All
 * the original VULN guards (closed-report seal, active-report ownership, time
 * validation, free-text sanitization, photo magic-bytes) are preserved.
 */
const repo = require('./repository');
const { sanitizeText, validTime } = require('../../lib/text');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function nowIso() { return new Date().toISOString(); }

async function getData(perms) {
  return await repo.getAllData(perms);
}

// POST /api/data — bulk save of reports + active_report_id.
// Returns { activeReportId } for the broadcast. May throw 403/400 mid-way
// (matching the original's partial-write-then-reject behaviour).
//
// Residents are not saved here. This used to accept a `clients` list and
// delete every resident missing from it, so one hand-built request from any
// account with residents.edit could empty the roster. No screen has sent a
// list since May 2026; residents change through /api/clients and
// /api/facility/rooms, one at a time, with their own validation and audit.
// A list is refused before anything is written.
async function saveData(d = {}, { perms = [] } = {}) {
  if (Array.isArray(d.clients) && d.clients.length > 0) {
    throw httpError(400, 'Residents are not saved through /api/data; use /api/clients or /api/facility/rooms');
  }
  if (Array.isArray(d.reports) && d.reports.length > 0) {
    const wantsClose = d.reports.some(r => r.is_closed);
    if (!perms.includes('reports.create')) throw httpError(403, 'Permission denied (reports.create required)');
    if (wantsClose && !perms.includes('reports.close')) throw httpError(403, 'Permission denied (reports.close required to close a shift)');
  }
  if (d.logos && !perms.includes('admin.settings')) {
    throw httpError(403, 'Permission denied (admin.settings required to change logos)');
  }

  if (Array.isArray(d.reports)) {
    for (const r of d.reports) {
      const closed = r.id && await repo.isReportClosed(r.id);
      if (closed && !r.is_closed) throw httpError(403, `Report ${r.id} is closed (sealed). Cannot modify.`);
      if (closed && r.is_closed) continue; // both agree closed — skip
      if (r.mod_name != null) r.mod_name = sanitizeText(r.mod_name, 100);
      if (Array.isArray(r.log_entries)) {
        for (const e of r.log_entries) {
          if (e.time && !validTime(e.time)) {
            throw httpError(400, `Invalid log entry time "${String(e.time).slice(0, 20)}" — expected format H:MM AM/PM`);
          }
          if (e.text != null) e.text = sanitizeText(e.text, 2000);
        }
      }
      if (r.shift != null) r.shift = sanitizeText(r.shift, 50);
      await repo.upsertReport(r);
    }
  }
  if (d.active_report_id !== undefined) await repo.setActiveReportId(d.active_report_id);
  return { activeReportId: await repo.getActiveReportId() };
}

// PATCH /api/data — optimistic per-field patch of the active report.
// Returns { rptId, logEntryId, safePatch, activeReportId }.
async function patchData(patch = {}, { perms = [] } = {}) {
  if (patch.statuses && !perms.includes('status.edit')) throw httpError(403, 'Permission denied');
  if (patch.log_entry && !perms.includes('log.add')) throw httpError(403, 'Permission denied');
  if (patch.issues !== undefined && !perms.includes('issues.edit')) throw httpError(403, 'Permission denied');
  if (patch.med_notes !== undefined && !perms.includes('issues.edit')) throw httpError(403, 'Permission denied');
  if (patch.shiftData && !perms.includes('reports.create')) throw httpError(403, 'Permission denied');
  if (patch.last_ua !== undefined && !perms.includes('ua.request')) throw httpError(403, 'Permission denied');
  if (patch.last_room_search !== undefined && !perms.includes('log.add')) throw httpError(403, 'Permission denied');

  const rptId = parseInt(patch.reportId);

  if (rptId) {
    const activeReportId = parseInt(await repo.getActiveReportId());
    if (!activeReportId || rptId !== activeReportId) throw httpError(403, 'Cannot patch a report that is not currently active');
    if (await repo.isReportClosed(rptId)) throw httpError(403, 'Report is closed (sealed). Cannot modify.');
  }

  if (patch.log_entry && patch.log_entry.time && !validTime(patch.log_entry.time)) {
    throw httpError(400, `Invalid log entry time "${String(patch.log_entry.time).slice(0, 20)}" — expected format H:MM AM/PM`);
  }
  if (patch.shiftData && typeof patch.shiftData === 'object') {
    if (patch.shiftData.mod_name != null) patch.shiftData.mod_name = sanitizeText(patch.shiftData.mod_name, 100);
    if (patch.shiftData.shift != null) patch.shiftData.shift = sanitizeText(patch.shiftData.shift, 50);
  }
  if (patch.log_entry && patch.log_entry.text != null) patch.log_entry.text = sanitizeText(patch.log_entry.text, 2000);

  let logEntryId = null;
  if (rptId) {
    if (patch.statuses) {
      const cur = await repo.getReportField(rptId, 'statuses');
      if (cur !== undefined) {
        let s = {}; try { s = JSON.parse(cur); } catch (e) { /* keep {} */ }
        Object.assign(s, patch.statuses);
        await repo.updateReportField(rptId, 'statuses', JSON.stringify(s), nowIso());
      }
    }
    if (patch.log_entry) {
      const e = patch.log_entry;
      const ins = await repo.insertLogEntry(rptId, e.time || '', e.text || '');
      logEntryId = ins.lastInsertRowid || null;
      await repo.touchReport(rptId, nowIso());
    }
    if (patch.shiftData) {
      const sd = patch.shiftData;
      if (sd.report_date || sd.shift || sd.mod_name) {
        await repo.updateShiftData(rptId, sd.report_date || null, sd.shift || null, sd.mod_name || null, nowIso());
      }
    }
    if (patch.issues !== undefined) await repo.updateReportField(rptId, 'issues', JSON.stringify(patch.issues), nowIso());
    if (patch.med_notes !== undefined) await repo.updateReportField(rptId, 'med_notes', JSON.stringify(patch.med_notes), nowIso());
    if (patch.last_ua && typeof patch.last_ua === 'object') {
      const cur = await repo.getReportField(rptId, 'last_ua');
      if (cur !== undefined) {
        let u = {}; try { u = JSON.parse(cur || '{}'); } catch (e) { /* keep {} */ }
        Object.assign(u, patch.last_ua);
        await repo.updateReportField(rptId, 'last_ua', JSON.stringify(u), nowIso());
      }
    }
    if (patch.last_room_search && typeof patch.last_room_search === 'object') {
      const cur = await repo.getReportField(rptId, 'last_room_search');
      if (cur !== undefined) {
        let u = {}; try { u = JSON.parse(cur || '{}'); } catch (e) { /* keep {} */ }
        Object.assign(u, patch.last_room_search);
        await repo.updateReportField(rptId, 'last_room_search', JSON.stringify(u), nowIso());
      }
    }
  }

  // Only relay safe, known fields — never echo raw user-controlled patch.
  const safePatch = {};
  if (patch.reportId) safePatch.reportId = parseInt(patch.reportId);
  if (patch.statuses && typeof patch.statuses === 'object') safePatch.statuses = patch.statuses;
  if (patch.log_entry && typeof patch.log_entry === 'object') {
    safePatch.log_entry = {
      time: String(patch.log_entry.time || '').slice(0, 20),
      text: String(patch.log_entry.text || '').slice(0, 2000),
    };
  }
  if (patch.shiftData && typeof patch.shiftData === 'object') {
    safePatch.shiftData = {
      report_date: patch.shiftData.report_date || null,
      shift: patch.shiftData.shift || null,
      mod_name: patch.shiftData.mod_name || null,
    };
  }
  if (patch.issues !== undefined) safePatch.issues = patch.issues;
  if (patch.med_notes !== undefined) safePatch.med_notes = patch.med_notes;
  if (patch.last_ua && typeof patch.last_ua === 'object') safePatch.last_ua = patch.last_ua;
  if (patch.last_room_search && typeof patch.last_room_search === 'object') safePatch.last_room_search = patch.last_room_search;

  return { rptId, logEntryId, safePatch, activeReportId: await repo.getActiveReportId() };
}

// DELETE /api/log/:id — returns { label } for the audit.
async function deleteLog(id) {
  const le = await repo.getLogText(id);
  await repo.deleteLog(id);
  return { label: le ? String(le.text || '').slice(0, 80) : String(id) };
}

// DELETE /api/reports/:id — 404 if missing; cascades log entries.
async function deleteReport(id) {
  const rpt = await repo.getReportBrief(id);
  if (!rpt) throw httpError(404, 'Report not found');
  await repo.deleteLogsForReport(id);
  await repo.deleteReport(id);
  return { label: (rpt.shift || '') + (rpt.report_date ? ' ' + rpt.report_date : '') };
}

// POST /api/log/:id/photo — validates + stores a UA photo. Returns { photo }.
async function saveLogPhoto(id, photo) {
  const le = await repo.getLogJoinReport(id);
  if (!le) throw httpError(404, 'Log entry not found');
  if (le.is_closed) throw httpError(403, 'Cannot modify a closed report');
  if (!photo) throw httpError(400, 'No photo');
  if (!photo.match(/^data:image\/(jpeg|jpg|png|gif|webp);base64,/i)) throw httpError(400, 'Invalid image format');
  if ((photo.split(',')[1] || '').length > 5592406) throw httpError(400, 'Image too large (max 4 MB)');
  let okImage = false;
  try {
    const bytes = Buffer.from(photo.split(',')[1].slice(0, 12), 'base64');
    const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    okImage = isJpeg || isPng || isGif || isWebp;
  } catch (e) { throw httpError(400, 'Invalid image data'); }
  if (!okImage) throw httpError(400, 'File does not appear to be an image');
  const fname = 'ua_' + id + '_' + Date.now() + '.jpg';
  const p = await repo.savePhoto(photo, fname);
  await repo.setLogPhoto(id, p);
  return { photo: p };
}

// GET /api/log/:id/photo — returns { photo } (base64) or throws 404.
async function getLogPhoto(id) {
  const e = await repo.resolveLogEntry(id);
  if (!e || !e.ua_photo) throw httpError(404, 'No photo');
  const b64 = await repo.getPhotoB64(e.ua_photo);
  if (!b64) throw httpError(404, 'File missing');
  return { photo: b64 };
}

module.exports = { getData, saveData, patchData, deleteLog, deleteReport, saveLogPhoto, getLogPhoto };
