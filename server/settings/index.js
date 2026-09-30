'use strict';
/**
 * server/settings — where every setting's value comes from, and the check that
 * refuses to start on a missing or contradictory one.
 *
 * Layers, later wins:
 *   1. the built-in default         (schema.js)
 *   2. the profile's default        (schema.js PROFILES)
 *   3. opspoint.config.json         (the app folder, or the file OPSPOINT_CONFIG names)
 *   4. environment variables        (read live, so a test that sets one sees it);
 *                                   for a secret also NAME_FILE, a file holding
 *                                   the value (a Docker secret)
 *   5. the provider's secret store  (OPSPOINT_SECRETS: Key Vault, Secrets Manager,
 *                                   Secret Manager), read once by startupCheck()
 *
 * Read a value with settings.get('NAME'), never process.env directly. A value
 * that does not parse throws rather than falling back to a default: refusing to
 * guess is the point (a mistyped driver must not quietly open SQLite).
 *
 * Entry points call startupCheck() before anything else, so a bad setting stops
 * the server with one sentence before it creates a folder, a key or a database.
 * On a cloud profile (azure, aws, gcp) no secret comes from disk: a secret in
 * the settings file or a NAME_FILE stops startup instead (server/secrets holds
 * the rest of the app to the same rule).
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { PROFILES, SETTINGS, BY_NAME, INTERNAL_ENV, STORE_NAMES } = require('./schema');

const BASE = path.resolve(__dirname, '..', '..');
const EX_CONFIG = 78;   // sysexits.h: configuration error — bootstrap.js stops relaunching on it
const ALL_NAMES = SETTINGS.map((s) => s.name);
const BOOL_TOKENS = { true: true, false: false, yes: true, no: false, on: true, off: false, 1: true, 0: false };

class SettingsError extends Error {
  constructor(message, setting) { super(message); this.name = 'SettingsError'; this.setting = setting || null; }
}

// ── Small helpers ───────────────────────────────────────────────────────────
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const blank = (v) => v === undefined || v === null || v === '';
function orList(items) {
  const q = items.map(String);
  return q.length < 2 ? q.join('') : `${q.slice(0, -1).join(', ')} or ${q[q.length - 1]}`;
}
function distance(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}
// The one candidate close enough to be what was meant, or null.
function closest(word, candidates) {
  const w = String(word).toLowerCase();
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const dd = distance(w, String(c).toLowerCase());
    if (dd < bestD) { best = c; bestD = dd; }
  }
  return best !== null && bestD > 0 && bestD <= Math.max(2, Math.floor(w.length / 4)) ? best : null;
}
const didYouMean = (word, candidates) => { const c = closest(word, candidates); return c ? `; did you mean ${c}?` : ''; };
const meant = (word, candidates) => { const c = closest(word, candidates); return c ? ` (did you mean ${c}?)` : ''; };

// ── Time zones ──────────────────────────────────────────────────────────────
// Node falls back to UTC, without a word, for a TZ it doesn't know (it reports
// Etc/Unknown), so a zone is only as good as Intl says it is.
function canonicalZone(tz) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }).resolvedOptions().timeZone; }
  catch (e) { return null; }
}
const isUtc = (canonical) => !canonical || canonical === 'UTC' || canonical === 'Etc/Unknown';
let _zones;
function knownZones() {
  if (!_zones) { try { _zones = Intl.supportedValuesOf('timeZone').concat('UTC'); } catch (e) { _zones = ['UTC']; } }
  return _zones;
}

// ── Parsing ─────────────────────────────────────────────────────────────────
// Returns { value } or { error } where error reads after the setting's name:
// "PORT must be …", "DATABASE_URL isn't …". Blank means unset.
function parseValue(def, raw) {
  if (blank(raw)) return { value: null };
  if (typeof raw === 'object') return { error: 'must be a single value, not a list or an object' };
  const s = String(raw).trim();
  switch (def.type) {
    case 'enum': {
      const v = s.toLowerCase();
      return def.values.includes(v) ? { value: v } : { error: `must be ${orList(def.values)}` };
    }
    case 'int': {
      const range = `a whole number from ${def.min} to ${def.max}`;
      if (!/^-?\d+$/.test(s)) return { error: `must be ${range}` };
      const n = parseInt(s, 10);
      return n < def.min || n > def.max ? { error: `must be ${range}` } : { value: n };
    }
    case 'bool': {
      if (typeof raw === 'boolean') return { value: raw };
      const tokens = def.tokens || BOOL_TOKENS;
      const k = s.toLowerCase();
      if (has(tokens, k)) return { value: tokens[k] };
      return { error: `must be ${def.tokens ? orList(Object.keys(def.tokens).sort().reverse()) : 'yes or no'}` };
    }
    case 'string':
      if (def.minLength && s.length < def.minLength) return { error: `must be at least ${def.minLength} characters` };
      if (def.pattern && !def.pattern.test(s)) return { error: `must be ${def.patternText}` };
      return { value: s };
    case 'path':
      return { value: s };
    case 'timezone':
      return canonicalZone(s) ? { value: s } : { error: "isn't a time zone OpsPoint knows" };
    case 'pgurl':
      return /^postgres(ql)?:\/\//i.test(s) && parseDsn(s)
        ? { value: s } : { error: "isn't a Postgres connection string (postgresql://user:password@host:5432/database)" };
    case 'trustProxy': {
      // A bare number is a hop count. Express would otherwise read the string
      // "1" as the IP address 0.0.0.1 and trust nothing useful.
      if (typeof raw === 'number' || /^\d+$/.test(s)) return { value: parseInt(s, 10) };
      if (s.toLowerCase() === 'false') return { value: false };
      if (s.toLowerCase() === 'true') {
        return { error: "can't be true: that believes every client's own claim about its address; name the proxy (loopback, uniquelocal, an address or CIDR) or give a hop count" };
      }
      try { require('express')().set('trust proxy', s); }
      catch (e) { return { error: 'must be loopback, linklocal, uniquelocal, proxy addresses or CIDRs (comma-separated), or a hop count' }; }
      return { value: s };
    }
    case 'host':
      return net.isIP(s) || /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(s)
        ? { value: s } : { error: 'must be an address such as 0.0.0.0 or 127.0.0.1' };
    case 'size':
      return /^\d+(\.\d+)?\s*(b|kb|mb|gb)?$/i.test(s) ? { value: s } : { error: 'must be a size such as 50mb' };
    case 'url': {
      let ok = /^https?:\/\/[^/\s]+/i.test(s);
      if (ok) { try { new URL(s); } catch (e) { ok = false; } }
      return ok ? { value: s.replace(/\/+$/, '') } : { error: 'must be an address such as http://127.0.0.1:9000' };
    }
    default:
      throw new Error(`settings schema: ${def.name} has unknown type ${def.type}`);
  }
}

// The sentence for a value that didn't parse. Secrets never echo their value.
function parseProblem(def, layer, error) {
  const where = layer.kind === 'file' || layer.kind === 'store' ? ` in ${layer.source}`
    : layer.kind === 'envfile' ? ` (from the file ${layer.source} names)` : '';
  let got = '';
  if (!def.secret) {
    const shown = typeof layer.raw === 'object' ? JSON.stringify(layer.raw) : String(layer.raw);
    let hint = '';
    if (def.type === 'enum') hint = didYouMean(String(layer.raw).trim(), def.values);
    if (def.type === 'timezone') hint = didYouMean(String(layer.raw).trim(), knownZones());
    got = ` (got '${shown.length > 80 ? shown.slice(0, 77) + '...' : shown}'${hint})`;
  }
  return `${def.name}${where} ${error}${got}.`;
}

// ── The settings file ───────────────────────────────────────────────────────
function loadFile({ env, base, readFile, statFile, platform }) {
  const empty = { path: null, label: null, values: {}, central: {}, unknown: [], envOnly: [] };
  const named = blank(env.OPSPOINT_CONFIG) ? null : String(env.OPSPOINT_CONFIG).trim();
  if (named && named.toLowerCase() === 'none') return { ...empty, disabled: true };
  const p = named ? path.resolve(named) : path.join(base, 'opspoint.config.json');
  const label = named ? p : 'opspoint.config.json';
  let text;
  try { text = readFile(p); }
  catch (e) {
    if (e && e.code === 'ENOENT') return named ? { ...empty, path: p, label, error: `OPSPOINT_CONFIG points at ${p}, which doesn't exist.` } : empty;
    return { ...empty, path: p, label, error: `${label} can't be read (${(e && (e.code || e.message)) || 'error'}).` };
  }
  let json;
  try { json = JSON.parse(String(text).replace(/^\uFEFF/, '')); }
  catch (e) { return { ...empty, path: p, label, error: `${label} isn't valid JSON (${e.message}).` }; }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ...empty, path: p, label, error: `${label} must hold one JSON object of settings, such as {"TZ": "America/Chicago"}.` };
  }
  const out = { ...empty, path: p, label, values: {}, central: {}, unknown: [], envOnly: [] };
  const take = (obj, into, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$schema' || k.startsWith('_')) continue;       // an editor schema link, or a comment
      if (!prefix && k === 'central') {
        if (v && typeof v === 'object' && !Array.isArray(v)) take(v, out.central, 'central.');
        else out.error = out.error || `${label}: "central" must be an object of HQ settings.`;
        continue;
      }
      if (!BY_NAME[k]) { out.unknown.push(prefix + k); continue; }
      if (BY_NAME[k].envOnly) { out.envOnly.push(k); continue; }
      into[k] = v;
    }
  };
  take(json, out.values, '');
  // A file holding secrets must not be readable by other accounts (POSIX only;
  // Windows keeps permissions in ACLs, which the installer sets).
  const holdsSecret = [out.values, out.central].some((o) => Object.keys(o).some((k) => BY_NAME[k].secret && !blank(o[k])));
  if (holdsSecret && platform !== 'win32') {
    try { if ((statFile(p).mode & 0o077) !== 0) out.exposed = true; } catch (e) { /* no stat, no warning */ }
  }
  return out;
}

// What check() looks at beyond each value's own type. docs/SETTINGS.md lists
// these, so change them together with the rules below.
const CHECKS = [
  'The settings file is readable, valid JSON, one object, and holds only settings OpsPoint knows; a misspelt one stops startup with a suggestion.',
  'Every setting the profile requires is set (on azure, aws and gcp: SESSION_SECRET and the push keys), and every setting another one requires (DATABASE_URL with OPSPOINT_DB_DRIVER=pg; HQ\'s CENTRAL_DATABASE_URL likewise).',
  "No setting has a value its profile can't use: SQLite or photos on the local disk on azure, aws or gcp, or the in-app updater on those and docker.",
  "TZ is a zone Node knows (an unknown one silently becomes UTC), it is set on the managed and docker profiles, and when it is unset the machine's own zone is not UTC; the process's clock runs in TZ, and PGTZ, if set, equals it.",
  'The push keys are both set or both unset, and are one key pair.',
  "PGSSLROOTCERT exists; a managed profile never connects to Postgres unencrypted (except over a local socket); HQ's database is not the facility's.",
  'File storage has what it needs: an account or a connection string for azure-blob, a bucket for s3 and gcs, AWS keys in pairs, and an existing Google key file if one is named.',
  "On a managed or docker profile the app listens on every interface, not on 127.0.0.1, which the platform can't reach.",
  'On azure, aws and gcp no secret comes from disk: not from opspoint.config.json, not from a NAME_FILE, and no Google key file.',
  'A secret is set as NAME or as NAME_FILE, not both, and the file NAME_FILE names can be read and is not empty.',
  'The secret store has what it needs: a Key Vault address (https://<name>.vault.azure.net) for azure-key-vault, a secret name and a region for aws-secrets-manager; and it can be read at start (a store that refuses stops startup, one that is unreachable exits 1 so the platform retries).',
];
const WARNING_CHECKS = [
  'An OPSPOINT_ or CENTRAL_ environment variable that is not a setting (probably a typo).',
  'A settings file holding secrets that other accounts can read (Linux and macOS).',
  'PGSSLMODE=disable to a database on another host.',
  'DATABASE_URL set while the driver is sqlite (it is ignored), or OPSPOINT_DB_KEY while it is pg or encryption is off.',
  'A Key Vault address or Secrets Manager secret set while OPSPOINT_SECRETS is local (it is ignored).',
  'An abbreviated TZ such as EST, which may ignore daylight saving.',
];

// ── The secret store's words ────────────────────────────────────────────────
// A setting's name in Key Vault and Secret Manager: lowercase with dashes
// (neither allows an underscore everywhere), after an optional prefix.
const secretName = (name, prefix = '') => `${prefix || ''}${name.toLowerCase().replace(/_/g, '-')}`;
const STORE_LABELS = {
  'azure-key-vault': 'Azure Key Vault', 'aws-secrets-manager': 'AWS Secrets Manager', 'gcp-secret-manager': 'Google Secret Manager',
};
// Where a secret would go in the configured store, for "set it in …, or …".
function storeWhere(kind, names, val) {
  const n = names.map((x) => secretName(x, val.OPSPOINT_SECRETS_PREFIX));
  const one = names.length === 1;
  if (kind === 'azure-key-vault') return `as the secret${one ? '' : 's'} ${orAnd(n)} in Azure Key Vault`;
  if (kind === 'gcp-secret-manager') return `as the secret${one ? '' : 's'} ${orAnd(n)} in Secret Manager`;
  if (kind === 'aws-secrets-manager') return `as ${orAnd(names)} in the Secrets Manager secret ${val.AWS_SECRETS_MANAGER_ID || 'AWS_SECRETS_MANAGER_ID names'}`;
  return '';
}
function orAnd(items) { return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`; }
// A Key Vault address: https://<name>.vault.azure.net (or a sovereign cloud's),
// or a test double on this machine. The managed identity's token goes there.
const VAULT_HOST = /^[a-z0-9-]{3,24}\.vault\.(azure\.net|azure\.cn|usgovcloudapi\.net|microsoftazure\.de)$/i;
function vaultProblem(url) {
  let u;
  try { u = new URL(url); } catch (e) { return true; }
  if (isLoopbackHost(u.hostname.replace(/^\[|\]$/g, ''))) return false;
  return u.protocol !== 'https:' || !VAULT_HOST.test(u.hostname) || (u.pathname !== '/' && u.pathname !== '');
}
// The region an ARN names (arn:aws:secretsmanager:us-west-2:…), or null.
const arnRegion = (id) => { const m = /^arn:aws[a-z-]*:secretsmanager:([a-z0-9-]+):/.exec(String(id || '')); return m ? m[1] : null; };

// ── One app's settings ──────────────────────────────────────────────────────
function createSettings(opts = {}) {
  const app = opts.app || 'facility';
  if (app !== 'facility' && app !== 'central') throw new Error(`settings: unknown app ${app}`);
  const env = opts.env || process.env;
  const base = opts.base || BASE;
  const platform = opts.platform || process.platform;
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const statFile = opts.statFile || ((p) => fs.statSync(p));
  const exists = opts.exists || ((p) => fs.existsSync(p));
  // The zone this process's clock runs in: the machine's when TZ is unset.
  const processZone = opts.processZone || (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  // Values this module copied from the settings file into process.env (TZ), so
  // they are still reported as coming from the file.
  const copied = opts.copiedFromFile || {};
  // The secret store's values once loadSecrets() has read them:
  // { kind, label, values } — or { kind, label, failed: true }.
  let store = opts.store || null;

  let _file;
  const file = () => (_file === undefined ? (_file = loadFile({ env, base, readFile, statFile, platform })) : _file);
  const inApp = (def) => def.scope === 'shared' || def.scope === 'per-app' || def.scope === app;
  const onCloud = () => PROFILES[profile().name].kind === 'managed';

  // A secret named by NAME_FILE: read once (a Docker secret doesn't change
  // while the process runs), never on a cloud profile.
  const _secretFiles = {};
  function secretFileLayer(def) {
    const named = envRaw(`${def.name}_FILE`);
    if (named === undefined) return null;
    const source = `${def.name}_FILE`, p = path.resolve(String(named).trim());
    if (onCloud()) return { kind: 'envfile', source, path: p, refused: true };
    if (!has(_secretFiles, def.name) || _secretFiles[def.name].path !== p) {
      let raw, error = null;
      try {
        raw = String(readFile(p));
        if (!raw.trim()) { error = 'is empty'; raw = undefined; }
      } catch (e) { error = `can't be read (${(e && (e.code || e.message)) || 'error'})`; }
      _secretFiles[def.name] = { kind: 'envfile', source, path: p, raw, error };
    }
    return _secretFiles[def.name];
  }

  function envRaw(name) {
    const v = env[name];
    if (blank(v)) return undefined;
    if (has(copied, name) && v === copied[name]) return undefined;   // ours, from the file
    return v;
  }
  function fileRaw(name) {
    const f = file();
    if (app === 'central' && has(f.central, name)) return blank(f.central[name]) ? undefined : f.central[name];
    if (app === 'central' && BY_NAME[name].scope === 'per-app') return undefined;   // top level is the facility's
    return has(f.values, name) && !blank(f.values[name]) ? f.values[name] : undefined;
  }

  function profile() {
    const e = envRaw('OPSPOINT_PROFILE');
    const raw = e !== undefined ? e : fileRaw('OPSPOINT_PROFILE');
    const inferred = platform === 'win32' ? 'windows-local' : 'linux-local';
    if (raw === undefined) return { name: inferred, source: 'inferred', inferred: true };
    const v = String(raw).trim().toLowerCase();
    if (has(PROFILES, v)) return { name: v, source: e !== undefined ? 'environment' : file().label };
    return { name: inferred, source: 'inferred', inferred: true, invalid: String(raw) };
  }

  function layersOf(def) {
    const out = [];
    let d = def.default;
    if (typeof d === 'function') d = d({ base, app, get });
    else if (def.scope === 'per-app' && d && typeof d === 'object') d = d[app];
    if (!blank(d)) out.push({ kind: 'default', source: 'default', raw: d });
    const p = profile().name;
    const pd = PROFILES[p].defaults;
    if (has(pd, def.name)) out.push({ kind: 'profile', source: `profile ${p}`, raw: pd[def.name] });
    const fv = fileRaw(def.name);
    if (fv !== undefined) out.push({ kind: 'file', source: file().label, raw: fv });
    const ev = envRaw(def.name);
    if (ev !== undefined) out.push({ kind: 'env', source: 'environment', raw: ev });
    if (def.secret) { const sf = secretFileLayer(def); if (sf) out.push(sf); }
    if (store && store.values && has(store.values, def.name) && !blank(store.values[def.name])) {
      out.push({ kind: 'store', source: store.label, raw: store.values[def.name] });
    }
    return out;
  }

  function resolve(name) {
    const def = BY_NAME[name];
    if (!def) throw new Error(`settings: unknown setting ${name}`);
    // A NAME_FILE that was refused or can't be read gives no value (check() says why).
    const layers = layersOf(def).filter((l) => l.raw !== undefined);
    const top = layers[layers.length - 1];
    if (!top) return { value: null, source: 'unset' };
    const r = parseValue(def, top.raw);
    if (r.error) throw new SettingsError(parseProblem(def, top, r.error), name);
    return { value: r.value, source: top.source };
  }
  function get(name) { return resolve(name).value; }
  function source(name) { return resolve(name).source; }

  // The zone the app will actually run in, and where that came from.
  function timeZone() {
    let tz = null, src = 'this machine';
    try { const r = resolve('TZ'); if (r.value) { tz = r.value; src = r.source; } } catch (e) { /* reported by check() */ }
    const name = canonicalZone(tz || processZone()) || String(tz || processZone());
    return { name, source: src, explicit: !!tz };
  }

  // Every problem, as one sentence each. Never throws.
  function check() {
    const problems = [];
    const error = (setting, message) => problems.push({ level: 'error', setting, message });
    const warning = (setting, message) => problems.push({ level: 'warning', setting, message });

    const f = file();
    if (f.error) error('OPSPOINT_CONFIG', f.error);
    for (const k of f.unknown) error(null, `${f.label} has a setting OpsPoint doesn't know: ${k}${meant(k.replace(/^central\./, ''), ALL_NAMES)}.`);
    for (const k of f.envOnly) error(k, `${k} can only be set in the environment, not in ${f.label}.`);
    if (f.exposed) warning(null, `${f.label} holds secrets and other accounts can read it: run chmod 600 ${f.path}.`);

    // An unknown OPSPOINT_PROFILE is reported with the other values that don't
    // parse (below); the checks carry on with the inferred profile meanwhile.
    const p = profile().name, P = PROFILES[p], where = P.where;
    const defs = SETTINGS.filter(inApp);

    const cloud = P.kind === 'managed';
    const val = {}, bad = {};
    for (const def of defs) {
      let layers = [];
      try { layers = layersOf(def); } catch (e) { /* a default that leans on a bad setting: reported there */ }
      for (const layer of layers) {
        if (layer.kind === 'envfile' && (layer.refused || layer.error)) {
          error(def.name, layer.refused
            ? `Profile ${p} reads no secret from disk, so ${layer.source} can't be used: set ${def.name} in ${where}${STORE_NAMES.includes(def.name) ? " or the provider's secret store" : ''} instead.`
            : `${layer.source} names ${layer.path}, which ${layer.error}.`);
          bad[def.name] = true;
          continue;
        }
        if (layer.kind === 'default' || layer.kind === 'profile') continue;
        const r = parseValue(def, layer.raw);
        if (r.error) { error(def.name, parseProblem(def, layer, r.error)); bad[def.name] = true; }
      }
      if (layers.some((l) => l.kind === 'env') && layers.some((l) => l.kind === 'envfile')) {
        error(def.name, `${def.name} and ${def.name}_FILE are both set: keep one.`);
        bad[def.name] = true;
      }
      // The settings file is on the server's disk; a cloud profile keeps no secret there.
      if (cloud && def.secret && layers.some((l) => l.kind === 'file')) {
        error(def.name, `Profile ${p} keeps no secret on disk, so ${def.name} can't be in ${f.label}: move it to ${where}${STORE_NAMES.includes(def.name) ? " or the provider's secret store" : ''}.`);
        bad[def.name] = true;
      }
      try { val[def.name] = resolve(def.name).value; } catch (e) { val[def.name] = null; bad[def.name] = true; }
    }
    const missing = (name) => val[name] == null && !bad[name];

    // Required settings. With a secret store configured, a secret may live
    // there instead; while the store couldn't be read, its secrets are not
    // reported missing on top of that.
    const kind = val.OPSPOINT_SECRETS && val.OPSPOINT_SECRETS !== 'local' ? val.OPSPOINT_SECRETS : null;
    const inStore = (name) => kind && STORE_NAMES.includes(name);
    const orStore = (names) => (names.every(inStore) ? `, or ${storeWhere(kind, names, val)}` : '');
    for (const def of defs) {
      if (!missing(def.name)) continue;
      if (store && store.failed && inStore(def.name)) continue;
      if (def.requiredIn && def.requiredIn.includes(p)) {
        if (def.pairWith && missing(def.pairWith)) {
          if (ALL_NAMES.indexOf(def.name) < ALL_NAMES.indexOf(def.pairWith)) {   // one sentence for the pair
            const other = BY_NAME[def.pairWith];
            error(def.name, `Profile ${p} needs ${def.name} and ${other.name}, the push alert keys (make a pair with \`node server/cli/opspoint.js keys\`): set them in ${where}${orStore([def.name, other.name])}, since keys made on the fly change at every restart and cut off every phone.`);
          }
        } else {
          error(def.name, `Profile ${p} needs ${def.name}, ${def.noun}: set it in ${where}${orStore([def.name])}.`);
        }
      }
      if (def.requiredWhen) {
        const [other, value] = def.requiredWhen;
        if (val[other] === value) error(def.name, `${other}=${value} needs ${def.name}, ${def.noun}: set it in ${where}${orStore([def.name])}.`);
      }
    }

    // Values a profile can't use.
    for (const def of defs) {
      if (!def.onlyIn || !def.onlyIn.profiles.includes(p) || val[def.name] == null) continue;
      if (!def.onlyIn.values.includes(val[def.name])) {
        const instead = (def.onlyIn.suggest && def.onlyIn.suggest[p]) || def.onlyIn.values[0];
        error(def.name, `Profile ${p} can't use ${def.name}=${val[def.name]}, because ${def.onlyIn.because}: set ${def.name}=${instead}.`);
      }
    }

    // Time zone. Unset is fine only on a machine whose own zone is real; an
    // implicit UTC is the default that filed evening entries under tomorrow.
    if (missing('TZ')) {
      if (P.kind !== 'local') {
        error('TZ', `Profile ${p} needs TZ, ${BY_NAME.TZ.noun}: set it in ${where}.`);
      } else if (isUtc(canonicalZone(processZone()))) {
        error('TZ', `OpsPoint needs TZ, ${BY_NAME.TZ.noun}, because this machine's clock is on UTC and would file evening entries under the next day: set it in ${where}.`);
      }
    } else if (val.TZ) {
      const want = canonicalZone(val.TZ), runs = canonicalZone(processZone());
      if (runs !== want) {
        error('TZ', `TZ is ${val.TZ} but this process's clock runs in ${runs || 'an unknown zone'}: start OpsPoint with TZ=${val.TZ} in its environment.`);
      }
      if (!val.TZ.includes('/') && want !== 'UTC') {
        warning('TZ', `TZ=${val.TZ} is an abbreviation that may ignore daylight saving: use the facility's city zone, such as America/New_York.`);
      }
    }
    if (val.PGTZ) {
      const tz = canonicalZone(val.TZ || processZone()), pg = canonicalZone(val.PGTZ);
      if (tz !== pg) error('PGTZ', `PGTZ (${val.PGTZ}) and TZ (${val.TZ || tz}) disagree, so the database would read times in a different zone than the server: remove PGTZ or make them match.`);
    }

    // Push keys: both or neither, and the two halves of one pair.
    if (app === 'facility') {
      const pub = val.VAPID_PUBLIC_KEY, priv = val.VAPID_PRIVATE_KEY;
      if (!!pub !== !!priv && !(bad.VAPID_PUBLIC_KEY || bad.VAPID_PRIVATE_KEY)) {
        const [set, unset] = pub ? ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] : ['VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY'];
        if (!(BY_NAME[unset].requiredIn || []).includes(p)) {
          error(unset, `${set} is set without ${unset}: set both push alert keys, or neither to use the pair in the data folder.`);
        }
      } else if (pub && priv && !vapidPairMatches(pub, priv)) {
        error('VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not one key pair: make a new pair with `node server/cli/opspoint.js keys`.');
      }
    }

    // Database.
    const pg = val.OPSPOINT_DB_DRIVER === 'pg';
    const urlName = app === 'central' ? 'CENTRAL_DATABASE_URL' : 'DATABASE_URL';
    if (!pg && val[urlName]) {
      warning(urlName, `${urlName} is set but the database driver is sqlite, so it is ignored.`);
    }
    if (pg && val.PGSSLROOTCERT && !exists(val.PGSSLROOTCERT)) {
      error('PGSSLROOTCERT', `PGSSLROOTCERT points at ${val.PGSSLROOTCERT}, which doesn't exist.`);
    }
    if (pg && val.PGSSLMODE === 'disable' && val[urlName]) {
      if (P.kind === 'managed' && !isSocketDsn(val[urlName])) {
        error('PGSSLMODE', `Profile ${p} needs an encrypted database connection, because its Postgres is reached over the network: set PGSSLMODE=require or verify-full.`);
      } else if (P.kind !== 'managed' && !isSocketDsn(val[urlName]) && !isLoopbackDsn(val[urlName])) {
        warning('PGSSLMODE', 'PGSSLMODE=disable sends database traffic unencrypted, which is only safe on one host or a private network.');
      }
    }
    if (app === 'central' && pg && val.CENTRAL_DATABASE_URL) {
      let facilityUrl = null;
      try { facilityUrl = createSettings({ ...opts, app: 'facility' }).get('DATABASE_URL'); } catch (e) { /* its own check reports it */ }
      if (facilityUrl && sameDatabase(facilityUrl, val.CENTRAL_DATABASE_URL)) {
        error('CENTRAL_DATABASE_URL', 'CENTRAL_DATABASE_URL points at the same database as DATABASE_URL: HQ needs its own database (for example opscentral), or its tables would land among the facility\'s.');
      }
    }

    // Listening address on a platform that routes to the container from outside.
    const bindName = app === 'central' ? 'CENTRAL_BIND' : 'OPSPOINT_BIND';
    if (P.kind !== 'local' && val[bindName] && isLoopbackHost(val[bindName])) {
      error(bindName, `Profile ${p} must listen on every interface (${bindName}=0.0.0.0): on ${val[bindName]} the platform can't reach the app.`);
    }

    // File storage (server/storage): what each cloud backend needs to reach its
    // bucket or container.
    if (app === 'facility') {
      const storage = val.OPSPOINT_STORAGE;
      if (storage === 'azure-blob' && !val.AZURE_STORAGE_ACCOUNT && !val.AZURE_STORAGE_CONNECTION_STRING && !bad.AZURE_STORAGE_ACCOUNT && !bad.AZURE_STORAGE_CONNECTION_STRING) {
        error('AZURE_STORAGE_ACCOUNT', `OPSPOINT_STORAGE=azure-blob needs AZURE_STORAGE_ACCOUNT (reached with the app's managed identity) or AZURE_STORAGE_CONNECTION_STRING: set it in ${where}.`);
      }
      if (storage === 'azure-blob' && val.AZURE_STORAGE_CONNECTION_STRING && !/AccountName=[^;]+/i.test(val.AZURE_STORAGE_CONNECTION_STRING)) {
        error('AZURE_STORAGE_CONNECTION_STRING', "AZURE_STORAGE_CONNECTION_STRING doesn't name an account (AccountName=…): copy it again from the storage account's Access keys.");
      }
    }

    // Cloud credentials (file storage and the secret store both use them).
    if (!!val.AWS_ACCESS_KEY_ID !== !!val.AWS_SECRET_ACCESS_KEY && !bad.AWS_ACCESS_KEY_ID && !bad.AWS_SECRET_ACCESS_KEY) {
      const [set, unset] = val.AWS_ACCESS_KEY_ID ? ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] : ['AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID'];
      error(unset, `${set} is set without ${unset}: set both, or neither to use the role the platform provides.`);
    }
    if (val.GOOGLE_APPLICATION_CREDENTIALS) {
      if (cloud) {
        error('GOOGLE_APPLICATION_CREDENTIALS', `Profile ${p} reads no secret from disk, so GOOGLE_APPLICATION_CREDENTIALS (a key file) can't be used: remove it, and let the service use its own service account.`);
      } else if ((val.OPSPOINT_STORAGE === 'gcs' || val.OPSPOINT_SECRETS === 'gcp-secret-manager') && !exists(val.GOOGLE_APPLICATION_CREDENTIALS)) {
        error('GOOGLE_APPLICATION_CREDENTIALS', `GOOGLE_APPLICATION_CREDENTIALS points at ${val.GOOGLE_APPLICATION_CREDENTIALS}, which doesn't exist.`);
      }
    }

    // The secret store (server/secrets/store.js).
    if (val.OPSPOINT_SECRETS === 'azure-key-vault' && val.AZURE_KEY_VAULT_URL && vaultProblem(val.AZURE_KEY_VAULT_URL)) {
      error('AZURE_KEY_VAULT_URL', `AZURE_KEY_VAULT_URL must be a Key Vault's address, such as https://sunrise-kv.vault.azure.net (got '${val.AZURE_KEY_VAULT_URL}').`);
    }
    if (val.OPSPOINT_SECRETS === 'aws-secrets-manager' && val.AWS_SECRETS_MANAGER_ID && !val.AWS_REGION && !arnRegion(val.AWS_SECRETS_MANAGER_ID) && !bad.AWS_REGION) {
      error('AWS_REGION', `OPSPOINT_SECRETS=aws-secrets-manager needs AWS_REGION, ${BY_NAME.AWS_REGION.noun} (ECS sets it), or the secret's full ARN in AWS_SECRETS_MANAGER_ID: set it in ${where}.`);
    }
    if (val.OPSPOINT_SECRETS === 'local') {
      for (const n of ['AZURE_KEY_VAULT_URL', 'AWS_SECRETS_MANAGER_ID']) {
        if (val[n]) warning(n, `${n} is set but OPSPOINT_SECRETS is local, so it is ignored.`);
      }
    }
    if (app === 'facility' && val.OPSPOINT_DB_KEY && (pg || !val.OPSPOINT_ENCRYPT)) {
      warning('OPSPOINT_DB_KEY', `OPSPOINT_DB_KEY is set but ${pg ? 'the database driver is pg' : 'encryption is off (OPSPOINT_ENCRYPT=0)'}, so it is ignored.`);
    }

    // A variable that looks like ours but isn't one: a typo would otherwise be
    // ignored without a word.
    for (const k of Object.keys(env)) {
      if (!/^(OPSPOINT|CENTRAL)_/.test(k) || /^OPSPOINT_TEST_/.test(k) || has(BY_NAME, k) || INTERNAL_ENV.includes(k)) continue;
      const fileOf = /_FILE$/.test(k) && BY_NAME[k.slice(0, -5)];
      if (fileOf && fileOf.secret) continue;                           // CENTRAL_ADMIN_PW_FILE and the like
      warning(null, `${k} isn't a setting OpsPoint knows, so it is ignored${meant(k, ALL_NAMES)}.`);
    }
    return problems;
  }

  // Every setting for this app, its value (secrets hidden) and where it came from.
  function describe() {
    const f = file();
    const rows = SETTINGS.filter(inApp).map((def) => {
      let r;
      try { r = resolve(def.name); } catch (e) { r = { value: null, source: 'invalid' }; }
      let shown;
      if (r.source === 'invalid') shown = '(invalid)';
      else if (r.value == null) shown = def.name === 'TZ' ? `(not set: this machine's zone, ${canonicalZone(processZone())})` : '(not set)';
      else if (def.secret) shown = '(set, hidden)';
      else shown = String(r.value);
      return { name: def.name, group: def.group, value: shown, source: r.source, secret: !!def.secret };
    });
    return {
      app,
      profile: profile(),
      file: f.disabled ? { disabled: true } : { path: f.path, label: f.label, found: !!f.path && !f.error },
      timeZone: timeZone(),
      secrets: storeInfo(),
      settings: rows,
      problems: check(),
    };
  }

  // The raw settings-file value of a setting for this app (used to copy TZ into
  // process.env before anything computes a local date).
  function fileValue(name) { return fileRaw(name); }

  // The secret store's layer (loadSecrets() sets it), and what it holds in
  // words: { kind, label, loaded, failed, names } — names only, never a value.
  function setStore(st) { store = st || null; }
  function storeInfo() {
    let kind = 'local';
    try { kind = get('OPSPOINT_SECRETS') || 'local'; } catch (e) { /* check() reports it */ }
    if (kind === 'local') return { kind };
    if (!store) return { kind, label: STORE_LABELS[kind], loaded: false };
    return { kind, label: store.label, loaded: !store.failed, failed: !!store.failed,
      names: store.values ? Object.keys(store.values).sort() : [] };
  }

  return { app, get, source, profile, timeZone, check, describe, fileValue, setStore, storeInfo };
}

function isLoopbackHost(h) {
  const s = String(h).trim().toLowerCase();
  return s === 'localhost' || s === '::1' || /^127\./.test(s);
}
// Read a connection string the way node-postgres will. (WHATWG URL rejects the
// unix-socket form postgresql://user:pw@/db?host=/cloudsql/…, which pg accepts.)
let _pgcs;
function parseDsn(dsn) {
  try {
    // pg's own parser, found from pg so a differently hoisted install still has it.
    if (!_pgcs) _pgcs = require(require.resolve('pg-connection-string', { paths: [path.dirname(require.resolve('pg'))] }));
    return _pgcs.parse(String(dsn));
  } catch (e) { return null; }
}
function dsnParts(dsn) {
  const c = parseDsn(dsn);
  if (!c) return null;
  return {
    host: String(c.host || 'localhost').toLowerCase(),
    port: String(c.port || '5432'),
    db: String(c.database || ''),
    // "-c search_path=central_test" puts HQ in its own schema of the same
    // database (scripts/pg-audit.sh does), which is a different place.
    options: String(c.options || '').trim(),
  };
}
const isSocketDsn = (dsn) => { const d = dsnParts(dsn); return !!d && d.host.startsWith('/'); };
const isLoopbackDsn = (dsn) => { const d = dsnParts(dsn); return !!d && isLoopbackHost(d.host); };
function sameDatabase(a, b) {
  const x = dsnParts(a), y = dsnParts(b);
  return !!x && !!y && x.host === y.host && x.port === y.port && x.db === y.db && x.options === y.options;
}
const vapidPairMatches = (pub, priv) => require('../lib/webpush').pairMatches(pub, priv);

// ── This process ────────────────────────────────────────────────────────────
const _instances = {};
const _copied = {};          // what this module copied from the settings file into process.env
let _app = 'facility';

function forApp(app) {
  if (!_instances[app]) {
    const s = createSettings({ app, copiedFromFile: _copied });
    copyFileTimeZone(s);
    _instances[app] = s;
  }
  return _instances[app];
}
// Node takes its time zone only from process.env.TZ, so a TZ given in the
// settings file is copied there on first use — before anything computes a
// local date. The environment still wins: a TZ someone set is never replaced.
function copyFileTimeZone(s) {
  const v = s.fileValue('TZ');
  if (v === undefined) return;
  const cur = process.env.TZ;
  if (!blank(cur) && cur !== _copied.TZ) return;
  const tz = String(v).trim();
  if (!canonicalZone(tz)) return;     // check() reports it; don't hand Node a zone it would treat as UTC
  if (cur !== tz) process.env.TZ = tz;
  _copied.TZ = tz;
}
// Which app this process is (HQ's server.js calls useApp('central') first).
function useApp(app) { _app = app; return forApp(app); }
const current = () => forApp(_app);

function writeStderr(text) { try { fs.writeSync(2, text); } catch (e) { /* nothing better to do */ } }

// ── The secret store ────────────────────────────────────────────────────────
const FETCHER = path.join(__dirname, '..', 'secrets', 'store.js');
// The settings that reach the store (they can't come from it).
const STORE_SETTINGS = SETTINGS.filter((d) => d.group === 'Secrets' || d.group === 'Cloud credentials').map((d) => d.name);

/**
 * Read the secret store OPSPOINT_SECRETS names, once, into this app's settings
 * as their top layer. It runs in a child process (server/secrets/store.js) so
 * that everything reading settings can stay synchronous; the values come back
 * over a pipe and are held in memory only — never in process.env, so a child
 * this process starts doesn't inherit them.
 * Returns { ok: true, kind, label, count } or { ok: false, message, exitCode }:
 * 78 when the store refused (a missing secret, no access), 1 when it couldn't
 * be reached, so the platform starts the app again later.
 */
function loadSecrets(s = current(), { env = process.env, timeoutMs = 60000 } = {}) {
  let kind;
  try { kind = s.get('OPSPOINT_SECRETS'); } catch (e) { return { ok: true, kind: null }; }   // check() reports the value
  if (!kind || kind === 'local') return { ok: true, kind: 'local' };
  const label = STORE_LABELS[kind];
  // What reaches the store is itself wrong or missing: check() says what, and
  // the secrets the store would have held aren't reported missing on top.
  if (s.check().some((p) => p.level === 'error' && STORE_SETTINGS.includes(p.setting))) {
    s.setStore({ kind, label, failed: true });
    return { ok: true, kind, skipped: true };
  }
  let out;
  try {
    out = require('child_process').execFileSync(process.execPath, [FETCHER, '--app', s.app], {
      env, timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 20,
    });
  } catch (e) {
    s.setStore({ kind, label, failed: true });
    const why = e.status == null ? `no answer in ${Math.round(timeoutMs / 1000)} seconds` : `its reader stopped (exit code ${e.status})`;
    return { ok: false, kind, message: `${label} can't be read: ${why}.`, exitCode: 1 };
  }
  let r;
  try { r = JSON.parse(String(out)); } catch (e) { r = { ok: false, error: `${label} can't be read: its reader gave no answer.` }; }
  if (!r.ok) {
    s.setStore({ kind, label: r.label || label, failed: true });
    return { ok: false, kind, message: r.error, exitCode: r.config ? EX_CONFIG : 1 };
  }
  s.setStore({ kind, label: r.label, values: r.values });
  return { ok: true, kind, label: r.label, count: Object.keys(r.values).length };
}

/**
 * Read the secret store, run the check for this process and stop on an error:
 * one sentence per problem, exit code 78 (or 1 when only the store was out of
 * reach). Warnings print and startup carries on. Written with fs.writeSync so
 * the reason survives process.exit on a Windows pipe.
 */
function startupCheck(s = current()) {
  const loaded = loadSecrets(s);
  const problems = s.check();
  for (const w of problems.filter((x) => x.level === 'warning')) writeStderr(`  Settings: ${w.message}\n`);
  const errors = problems.filter((x) => x.level === 'error');
  if (!loaded.ok) errors.unshift({ level: 'error', setting: 'OPSPOINT_SECRETS', message: loaded.message });
  if (errors.length) {
    const who = s.app === 'central' ? 'OpsPoint HQ' : 'OpsPoint';
    writeStderr(`\n  ${who} can't start: ${errors[0].message}\n` +
      errors.slice(1).map((e) => `  Also: ${e.message}\n`).join('') + '\n');
    process.exit(!loaded.ok && errors.length === 1 ? loaded.exitCode : EX_CONFIG);
  }
  const prof = s.profile(), tz = s.timeZone();
  const secrets = loaded.label ? `; ${loaded.count} secret${loaded.count === 1 ? '' : 's'} from ${loaded.label}` : '';
  process.stdout.write(`  Settings: profile ${prof.name}${prof.inferred ? ' (inferred)' : ''}, time zone ${tz.name}` +
    `${tz.explicit ? '' : " (this machine's)"}${secrets}\n`);
  return problems;
}

module.exports = {
  get: (name) => current().get(name),
  source: (name) => current().source(name),
  profile: () => current().profile(),
  timeZone: () => current().timeZone(),
  check: () => current().check(),
  describe: () => current().describe(),
  storeInfo: () => current().storeInfo(),
  forApp, useApp, createSettings, startupCheck, loadSecrets, parseValue, canonicalZone, parseDsn, secretName, meant,
  SettingsError, EX_CONFIG, BASE, CHECKS, WARNING_CHECKS, STORE_LABELS,
};
