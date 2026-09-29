'use strict';
/**
 * Paths and runtime knobs for the facility server, in one place.
 *
 * The values come from server/settings (declared once in
 * server/settings/schema.js: built-in default, profile default,
 * opspoint.config.json, environment). The defaults are the historical
 * hard-coded ones, so a single-box install with no settings behaves exactly as
 * before. This is the ONE module that knows where things live on disk.
 */
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const settings = require('./settings');

const BASE     = settings.BASE;                              // project root
const DATA_DIR = settings.get('OPSPOINT_DATA');

const config = {
  BASE,
  DATA_DIR,
  PORT:           settings.get('PORT'),
  // OPSPOINT_DB lets tests and scripts point at an isolated database.
  DB_PATH:        settings.get('OPSPOINT_DB'),
  LEGACY_DB_PATH: path.join(DATA_DIR, 'shift.db'),
  REACT_DIST:     path.join(BASE, 'client', 'dist'),
  PHOTOS_DIR:     path.join(DATA_DIR, 'photos'),
  SECRET_FILE:    settings.get('OPSPOINT_SECRET_FILE'),
  SESSION_IDLE_DEFAULT_MINS: settings.get('OPSPOINT_IDLE_MINS'),
  SESSION_MAX_AGE_MS:        12 * 60 * 60 * 1000,
  JSON_LIMIT:                settings.get('OPSPOINT_JSON_LIMIT'),
  // Which upstream hops may set X-Forwarded-For / X-Forwarded-Proto.
  //
  // 'loopback' (the default) is correct for both on-premises modes without
  // configuration:
  //   - behind a same-box reverse proxy (nginx or cloudflared terminating TLS,
  //     as in the hosted deployment) the peer IS loopback, so the forwarded
  //     client IP and scheme are honoured — req.ip becomes the real client and
  //     cookie.secure:'auto' resolves to true;
  //   - installed on a facility LAN with no proxy, peers are never loopback,
  //     so a client cannot forge its own address by sending the header.
  // The managed profiles default to 1 hop (the platform's load balancer) and
  // docker to 'loopback, uniquelocal' (its proxy container). A number is a hop
  // count; settings turns "1" into 1, since Express would read the string as
  // the address 0.0.0.1.
  TRUST_PROXY:               settings.get('OPSPOINT_TRUST_PROXY'),

  // Interface to listen on. Defaults to every interface, which is required for
  // the on-premise case: staff phones reach the mobile UI across the facility
  // LAN, and binding loopback there would take that away.
  //
  // A hosted deployment sitting behind a same-box proxy should set
  // OPSPOINT_BIND=127.0.0.1, so the app is unreachable except through the proxy
  // even if a firewall rule is later added by mistake. Defence in depth: the
  // firewall is the control, this makes a firewall error non-fatal.
  BIND_ADDR:                 settings.get('OPSPOINT_BIND'),
};

/**
 * Load (or first-time create) the session signing secret. Prefers the
 * SESSION_SECRET setting (cloud / 12-factor); otherwise reads the on-disk key
 * file, creating it with 0600 perms on first run (single-box install).
 */
config.loadSessionSecret = function loadSessionSecret() {
  const fromSettings = settings.get('SESSION_SECRET');
  if (fromSettings) return fromSettings;
  const f = config.SECRET_FILE;
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    try { fs.chmodSync(f, 0o600); } catch (e) {}
  }
  return fs.readFileSync(f, 'utf8').trim();
};

module.exports = config;
