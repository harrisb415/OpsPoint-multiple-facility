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

module.exports = {
  getUARecords, getUARecord, createUARecord, updateUARecord, deleteUARecord,
  getMedLog, createMedLog, updateMedLog, deleteMedLog,
  getMilestones, createMilestone, updateMilestone, signoffMilestone, deleteMilestone,
  getIncidents, createIncident, updateIncident, reviewIncident, deleteIncident,
  getIncidentNotifications,
};
