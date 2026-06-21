'use strict';
/**
 * Clinical-record guard middleware:
 *  - requireUnlocked(table): 403 if the named clinical record is past its 24h
 *    immutability window (a records.unlock holder must unlock it first).
 *  - requireConsent(clientIdFn, informationType): 42 CFR Part 2 gate for
 *    external-disclosure routes — 403 unless a valid consent is on file.
 *
 * Shared by the inline clinical routes and (as they migrate) the clinical
 * domain module, so it lives in middleware rather than the composition root.
 */
const db = require('../../db');
const { audit } = require('./audit');

function requireUnlocked(table) {
  return function (req, res, next) {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    if (db.isRecordLocked(table, id)) {
      return res.status(403).json({
        error: 'Record is locked (24h immutability window has elapsed). A supervisor must unlock it first.',
        code: 'RECORD_LOCKED',
      });
    }
    next();
  };
}

function requireConsent(clientIdFn, informationType) {
  return function (req, res, next) {
    try {
      const cid = parseInt(typeof clientIdFn === 'function' ? clientIdFn(req) : req.params.client_id);
      if (!cid) return res.status(400).json({ error: 'client_id required' });
      const consent = db.findActiveConsent(cid, informationType);
      if (!consent) {
        audit(req, 'consent.blocked', 'consent', cid, 'External disclosure blocked', { informationType });
        return res.status(403).json({
          error: '42 CFR Part 2: No valid consent on file for this disclosure. Obtain written consent first.',
          code: 'CONSENT_REQUIRED',
        });
      }
      req._consent = consent;
      next();
    } catch (e) {
      res.status(500).json({ error: 'Consent check failed' });
    }
  };
}

module.exports = { requireUnlocked, requireConsent };
