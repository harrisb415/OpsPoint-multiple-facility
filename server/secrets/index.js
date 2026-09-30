'use strict';
/**
 * server/secrets — the secrets OpsPoint keeps in files, and the rule that a
 * cloud profile keeps none.
 *
 * A secret is either a setting marked secret in server/settings/schema.js —
 * read with settings.get like any other: from the environment, a file the
 * environment names as NAME_FILE (a Docker secret), opspoint.config.json on
 * premises, or the provider's secret store (./store.js) — or a key an
 * on-premises install makes for itself the first time it starts:
 *
 *   the session key    OPSPOINT_SECRET_FILE (secret.key in the data folder)
 *   the push keys      vapid.json in the data folder
 *   the database key   .dbkey beside the SQLite file (unless OPSPOINT_DB_KEY)
 *   the HTTPS key      key.pem in the data folder, beside cert.pem
 *   a Google key file  GOOGLE_APPLICATION_CREDENTIALS
 *
 * Those files are read and written only through this module, which refuses
 * on a cloud profile (azure, aws, gcp): there every secret comes from the
 * platform's settings or its secret store, and none from the disk.
 * tests/secrets.test.js holds the rest of the code to that.
 */
const fs = require('fs');
const path = require('path');
const settingsModule = require('../settings');
const { PROFILES } = require('../settings/schema');

class SecretOnDiskError extends Error {
  constructor(message) { super(message); this.name = 'SecretOnDiskError'; this.code = 'EX_CONFIG'; }
}

// Is this a cloud profile? `s`: a settings instance, default this process's.
function onCloud(s) {
  return PROFILES[(s || settingsModule).profile().name].kind === 'managed';
}

// what: the file in words; setting: what to set instead, if anything.
function refuse({ what, setting, settings: s }) {
  const p = (s || settingsModule).profile().name;
  const instead = setting ? `: set ${setting} in ${PROFILES[p].where} or the provider's secret store instead` : '';
  throw new SecretOnDiskError(`Profile ${p} reads no secret from disk, so ${what} can't be used${instead}.`);
}

/** Read a secret file as text. Throws like fs (ENOENT…), and on a cloud profile. */
function readFile(file, about = {}) {
  if (onCloud(about.settings)) refuse({ what: file, ...about });
  return fs.readFileSync(file, 'utf8');
}

/** Is there a secret file? Never on a cloud profile, which looks for none. */
function exists(file, about = {}) {
  return !onCloud(about.settings) && fs.existsSync(file);
}

/**
 * Write a secret file readable by this account only (mode 0600; on Windows the
 * data folder's ACL, which the installer sets). Refused on a cloud profile.
 */
function writeFile(file, value, about = {}) {
  if (onCloud(about.settings)) refuse({ what: file, ...about });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (e) { /* Windows */ }
}

/**
 * The HTTPS certificate and key from a data folder, or null. Always null on a
 * cloud profile: its platform handles HTTPS in front of the app.
 */
function tlsFiles(dir, about = {}) {
  if (onCloud(about.settings)) return null;
  const cert = path.join(dir, 'cert.pem'), key = path.join(dir, 'key.pem');
  if (!fs.existsSync(cert) || !fs.existsSync(key)) return null;
  return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
}

module.exports = { readFile, writeFile, exists, tlsFiles, onCloud, SecretOnDiskError };
