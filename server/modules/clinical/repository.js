'use strict';
/**
 * Clinical repository — the clinical EHR tables (ua_records,
 * milestones, incidents, and — in later installments — discharge/consent/
 * disclosures + the Structured Clinical Lite set) are implemented in db.js with
 * locking/immutability baked in. This repository delegates to those helpers so
 * the clinical service/routes stay free of db wiring; it grows as more clinical
 * entities migrate.
 */
const db = require('../../../db');

// ── UA records ──────────────────────────────────────────────────────
const getUARecords = async (f) => await db.getUARecords(f);
const getUARecord = async (id) => await db.getUARecord(id);
const createUARecord = async (rec) => await db.createUARecord(rec);
const updateUARecord = async (id, patch) => await db.updateUARecord(id, patch);
const deleteUARecord = async (id) => await db.deleteUARecord(id);

// ── Med administration log ──────────────────────────────────────────

// ── Milestones ──────────────────────────────────────────────────────
const getMilestones = async (f) => await db.getMilestones(f);
const createMilestone = async (rec) => await db.createMilestone(rec);
const updateMilestone = async (id, patch) => await db.updateMilestone(id, patch);
const signoffMilestone = async (id, uid, name) => await db.signoffMilestone(id, uid, name);
const deleteMilestone = async (id) => await db.deleteMilestone(id);

// ── Incidents ───────────────────────────────────────────────────────
const getIncidents = async (f) => await db.getIncidents(f);
const createIncident = async (rec) => await db.createIncident(rec);
const updateIncident = async (id, patch) => await db.updateIncident(id, patch);
const reviewIncident = async (id, uid, name, notes, status) => await db.reviewIncident(id, uid, name, notes, status);
const deleteIncident = async (id) => await db.deleteIncident(id);

// severity-based required-notification policy (settings k/v)
const getIncidentNotifications = async () => await db.getSetting('incident_notifications', {});

// ── Discharge records (+ the cross-domain client-vacate / active-report log) ─
const getDischargeRecords = async (f) => await db.getDischargeRecords(f);
const createDischargeRecord = async (rec) => await db.createDischargeRecord(rec);
const getClientById = async (id) => await db.query1('SELECT * FROM clients WHERE id=?', [id]);
const dischargeClient = async (id, date) => await db.run('UPDATE clients SET is_active=0, discharge_date=? WHERE id=?', [date, id]);
const insertVacantRoom = async (room, sortOrder) => await db.run('INSERT INTO clients (room,name,is_active,is_special,sort_order) VALUES (?,?,1,0,?)', [room, 'VACANT', sortOrder]);
const getActiveReportId = async () => await db.getSetting('active_report_id', null);
const insertLogEntry = async (reportId, time, text) => await db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)', [reportId, time, text]);
const touchReport = async (reportId, iso) => await db.run('UPDATE reports SET updated_at=? WHERE id=?', [iso, reportId]);

// ── Consent records (42 CFR Part 2) ─────────────────────────────────
const getConsentRecords = async (cid) => await db.getConsentRecords(cid);
const getConsentRecord = async (id) => await db.getConsentRecord(id);
const createConsentRecord = async (rec) => await db.createConsentRecord(rec);
const revokeConsent = async (id, by) => await db.revokeConsent(id, by);
const getFacilityName = async () => await db.getSetting('facility_name', 'OpsPoint');

// ── Disclosures ─────────────────────────────────────────────────────
const getDisclosures = async (cid) => await db.getDisclosures(cid);
const logDisclosure = async (rec) => await db.logDisclosure(rec);

// ── Supervisor unlock ───────────────────────────────────────────────
const clinicalTables = () => db.CLINICAL_TABLES;
const isRecordLocked = async (table, id) => await db.isRecordLocked(table, id);
const unlockRecord = async (table, id, by, reason) => await db.unlockRecord(table, id, by, reason);

// ── Structured Clinical Lite entity bundle (notes/treatment-plans/assessments/
// discharge-summaries/group-notes) — each is a getAll/getById/create/update/
// sign/delete object implemented in db.js (clinicalDb). Used by the route factory.
const clinicalDb = db.clinicalDb;

module.exports = {
  getUARecords, getUARecord, createUARecord, updateUARecord, deleteUARecord,
  getMilestones, createMilestone, updateMilestone, signoffMilestone, deleteMilestone,
  getIncidents, createIncident, updateIncident, reviewIncident, deleteIncident,
  getIncidentNotifications,
  getDischargeRecords, createDischargeRecord, getClientById, dischargeClient,
  insertVacantRoom, getActiveReportId, insertLogEntry, touchReport,
  getConsentRecords, getConsentRecord, createConsentRecord, revokeConsent, getFacilityName,
  getDisclosures, logDisclosure,
  clinicalTables, isRecordLocked, unlockRecord,
  clinicalDb,
};
