'use strict';
/**
 * Centralized, env-driven configuration (Phase 0 / 12-factor of the
 * modular-monolith refactor — see server/ARCHITECTURE.md).
 *
 * Every value falls back to the historical hard-coded default, so existing
 * single-box installs behave identically while cloud deployments can override
 * everything via environment variables. This is the ONE module that knows
 * where things live on disk and what the runtime knobs are.
 */
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const BASE     = path.resolve(__dirname, '..');                 // project root
const DATA_DIR = process.env.OPSPOINT_DATA || path.join(BASE, 'data');

const config = {
  BASE,
  DATA_DIR,
  PORT:           parseInt(process.env.PORT, 10) || 3000,
  // OPSPOINT_DB override lets tests/cloud point at an isolated database.
  DB_PATH:        process.env.OPSPOINT_DB || path.join(DATA_DIR, 'opspoint.db'),
  LEGACY_DB_PATH: path.join(DATA_DIR, 'shift.db'),
  REACT_DIST:     path.join(BASE, 'client', 'dist'),
  PHOTOS_DIR:     path.join(DATA_DIR, 'photos'),
  SECRET_FILE:    process.env.OPSPOINT_SECRET_FILE || path.join(DATA_DIR, 'secret.key'),
  SESSION_IDLE_DEFAULT_MINS: parseInt(process.env.OPSPOINT_IDLE_MINS, 10) || 30,
  SESSION_MAX_AGE_MS:        12 * 60 * 60 * 1000,
  JSON_LIMIT:                process.env.OPSPOINT_JSON_LIMIT || '50mb',
};

/**
 * Load (or first-time create) the session signing secret. Prefers the
 * SESSION_SECRET env var (cloud / 12-factor); otherwise reads the on-disk key
 * file, creating it with 0600 perms on first run (single-box install).
 */
config.loadSessionSecret = function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = config.SECRET_FILE;
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    try { fs.chmodSync(f, 0o600); } catch (e) {}
  }
  return fs.readFileSync(f, 'utf8').trim();
};

module.exports = config;
