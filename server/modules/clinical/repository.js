'use strict';
/**
 * Clinical repository — the clinical EHR tables (ua_records, med_administration_log,
 * milestones, incidents, and — in later installments — discharge/consent/
 * disclosures + the Structured Clinical Lite set) are implemented in db.js with
 * locking/immutability baked in. This repository delegates to those helpers so
 * the clinical service/routes stay free of db wiring; it grows as more clinical
 * entities migrate.
 */
const db = require('../../../db');

// ── UA records ──────────────────────────────────────────────────────
const getUARecords = (f) => db.getUARecords(f);
const getUARecord = (id) => db.getUARecord(id);
const createUARecord = (rec) => db.createUARecord(rec);
const updateUARecord = (id, patch) => db.updateUARecord(id, patch);
const deleteUARecord = (id) => db.deleteUARecord(id);

// ── Med administration log ──────────────────────────────────────────
const getMedLog = (f) => db.getMedLog(f);
const createMedLog = (rec) => db.createMedLog(rec);
const updateMedLog = (id, patch) => db.updateMedLog(id, patch);
const deleteMedLog = (id) => db.deleteMedLog(id);

// ── Milestones ──────────────────────────────────────────────────────
const getMilestones = (f) => db.getMilestones(f);
const createMilestone = (rec) => db.createMilestone(rec);
const updateMilestone = (id, patch) => db.updateMilestone(id, patch);
const signoffMilestone = (id, uid, name) => db.signoffMilestone(id, uid, name);
const deleteMilestone = (id) => db.deleteMilestone(id);

// ── Incidents ───────────────────────────────────────────────────────
const getIncidents = (f) => db.getIncidents(f);
const createIncident = (rec) => db.createIncident(rec);
const updateIncident = (id, patch) => db.updateIncident(id, patch);
const reviewIncident = (id, uid, name, notes, status) => db.reviewIncident(id, uid, name, notes, status);
const deleteIncident = (id) => db.deleteIncident(id);

// severity-based required-notification policy (settings k/v)
const getIncidentNotifications = () => db.getSetting('incident_notifications', {});

// ── Discharge records (+ the cross-domain client-vacate / active-report log) ─
const getDischargeRecords = (f) => db.getDischargeRecords(f);
const createDischargeRecord = (rec) => db.createDischargeRecord(rec);
const getClientById = (id) => db.query1('SELECT * FROM clients WHERE id=?', [id]);
const dischargeClient = (id, date) => db.run('UPDATE clients SET is_active=0, discharge_date=? WHERE id=?', [date, id]);
const insertVacantRoom = (room, sortOrder) => db.run('INSERT INTO clients (room,name,is_active,is_special,sort_order) VALUES (?,?,1,0,?)', [room, 'VACANT', sortOrder]);
const getActiveReportId = () => db.getSetting('active_report_id', null);
const insertLogEntry = (reportId, time, text) => db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)', [reportId, time, text]);
const touchReport = (reportId, iso) => db.run('UPDATE reports SET updated_at=? WHERE id=?', [iso, reportId]);

// ── Consent records (42 CFR Part 2) ─────────────────────────────────
const getConsentRecords = (cid) => db.getConsentRecords(cid);
const getConsentRecord = (id) => db.getConsentRecord(id);
const createConsentRecord = (rec) => db.createConsentRecord(rec);
const revokeConsent = (id, by) => db.revokeConsent(id, by);
const getFacilityName = () => db.getSetting('facility_name', 'OpsPoint');

// ── Disclosures ─────────────────────────────────────────────────────
const getDisclosures = (cid) => db.getDisclosures(cid);
const logDisclosure = (rec) => db.logDisclosure(rec);

// ── Supervisor unlock ───────────────────────────────────────────────
const clinicalTables = () => db.CLINICAL_TABLES;
const isRecordLocked = (table, id) => db.isRecordLocked(table, id);
const unlockRecord = (table, id, by, reason) => db.unlockRecord(table, id, by, reason);

module.exports = {
  getUARecords, getUARecord, createUARecord, updateUARecord, deleteUARecord,
  getMedLog, createMedLog, updateMedLog, deleteMedLog,
  getMilestones, createMilestone, updateMilestone, signoffMilestone, deleteMilestone,
  getIncidents, createIncident, updateIncident, reviewIncident, deleteIncident,
  getIncidentNotifications,
  getDischargeRecords, createDischargeRecord, getClientById, dischargeClient,
  insertVacantRoom, getActiveReportId, insertLogEntry, touchReport,
  getConsentRecords, getConsentRecord, createConsentRecord, revokeConsent, getFacilityName,
  getDisclosures, logDisclosure,
  clinicalTables, isRecordLocked, unlockRecord,
};
