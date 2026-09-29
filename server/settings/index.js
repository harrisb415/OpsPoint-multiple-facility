'use strict';
/**
 * server/settings — where every setting's value comes from, and the check that
 * refuses to start on a missing or contradictory one.
 *
 * Layers, later wins:
 *   1. the built-in default         (schema.js)
 *   2. the profile's default        (schema.js PROFILES)
 *   3. opspoint.config.json         (the app folder, or the file OPSPOINT_CONFIG names)
 *   4. environment variables        (read live, so a test that sets one sees it)
 *   (5. the provider's secret store — roadmap phase 5)
 *
 * Read a value with settings.get('NAME'), never process.env directly. A value
 * that does not parse throws rather than falling back to a default: refusing to
 * guess is the point (a mistyped driver must not quietly open SQLite).
 *
 * Entry points call startupCheck() before anything else, so a bad setting stops
 * the server with one sentence before it creates a folder, a key or a database.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { PROFILES, SETTINGS, BY_NAME, INTERNAL_ENV } = require('./schema');

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
    default:
      throw new Error(`settings schema: ${def.name} has unknown type ${def.type}`);
  }
}

// The sentence for a value that didn't parse. Secrets never echo their value.
function parseProblem(def, layer, error) {
  const where = layer.kind === 'file' ? ` in ${layer.source}` : '';
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
  "No setting has a value its profile can't use: SQLite on azure, aws or gcp, or the in-app updater on those and docker.",
  "TZ is a zone Node knows (an unknown one silently becomes UTC), it is set on the managed and docker profiles, and when it is unset the machine's own zone is not UTC; the process's clock runs in TZ, and PGTZ, if set, equals it.",
  'The push keys are both set or both unset, and are one key pair.',
  "PGSSLROOTCERT exists; a managed profile never connects to Postgres unencrypted (except over a local socket); HQ's database is not the facility's.",
  "On a managed or docker profile the app listens on every interface, not on 127.0.0.1, which the platform can't reach.",
];
const WARNING_CHECKS = [
  'An OPSPOINT_ or CENTRAL_ environment variable that is not a setting (probably a typo).',
  'A settings file holding secrets that other accounts can read (Linux and macOS).',
  'PGSSLMODE=disable to a database on another host.',
  'DATABASE_URL set while the driver is sqlite (it is ignored).',
  'An abbreviated TZ such as EST, which may ignore daylight saving.',
  'Photos kept in the data folder on a managed platform, until the file storage port (roadmap phase 3).',
];

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

  let _file;
  const file = () => (_file === undefined ? (_file = loadFile({ env, base, readFile, statFile, platform })) : _file);
  const inApp = (def) => def.scope === 'shared' || def.scope === 'per-app' || def.scope === app;

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
    return out;
  }

  function resolve(name) {
    const def = BY_NAME[name];
    if (!def) throw new Error(`settings: unknown setting ${name}`);
    const layers = layersOf(def);
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

    const val = {}, bad = {};
    for (const def of defs) {
      let layers = [];
      try { layers = layersOf(def); } catch (e) { /* a default that leans on a bad setting: reported there */ }
      for (const layer of layers) {
        if (layer.kind !== 'file' && layer.kind !== 'env') continue;
        const r = parseValue(def, layer.raw);
        if (r.error) { error(def.name, parseProblem(def, layer, r.error)); bad[def.name] = true; }
      }
      try { val[def.name] = resolve(def.name).value; } catch (e) { val[def.name] = null; bad[def.name] = true; }
    }
    const missing = (name) => val[name] == null && !bad[name];

    // Required settings.
    for (const def of defs) {
      if (!missing(def.name)) continue;
      if (def.requiredIn && def.requiredIn.includes(p)) {
        if (def.pairWith && missing(def.pairWith)) {
          if (ALL_NAMES.indexOf(def.name) < ALL_NAMES.indexOf(def.pairWith)) {   // one sentence for the pair
            const other = BY_NAME[def.pairWith];
            error(def.name, `Profile ${p} needs ${def.name} and ${other.name}, the push alert keys (make a pair with \`node server/cli/opspoint.js keys\`): set them in ${where}, since keys made on the fly change at every restart and cut off every phone.`);
          }
        } else {
          error(def.name, `Profile ${p} needs ${def.name}, ${def.noun}: set it in ${where}.`);
        }
      }
      if (def.requiredWhen) {
        const [other, value] = def.requiredWhen;
        if (val[other] === value) error(def.name, `${other}=${value} needs ${def.name}, ${def.noun}: set it in ${where}.`);
      }
    }

    // Values a profile can't use.
    for (const def of defs) {
      if (!def.onlyIn || !def.onlyIn.profiles.includes(p) || val[def.name] == null) continue;
      if (!def.onlyIn.values.includes(val[def.name])) {
        error(def.name, `Profile ${p} can't use ${def.name}=${val[def.name]}, because ${def.onlyIn.because}: set ${def.name}=${def.onlyIn.values[0]}.`);
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

    // Until the file storage port lands (roadmap phase 3), photos live in the
    // data folder, which a managed platform wipes.
    if (P.kind === 'managed' && app === 'facility') {
      warning(null, 'Photos are still saved in the data folder, which this platform wipes on restart; storing them in the provider\'s storage arrives in a later version.');
    }

    // A variable that looks like ours but isn't one: a typo would otherwise be
    // ignored without a word.
    for (const k of Object.keys(env)) {
      if (!/^(OPSPOINT|CENTRAL)_/.test(k) || has(BY_NAME, k) || INTERNAL_ENV.includes(k)) continue;
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
      settings: rows,
      problems: check(),
    };
  }

  // The raw settings-file value of a setting for this app (used to copy TZ into
  // process.env before anything computes a local date).
  function fileValue(name) { return fileRaw(name); }

  return { app, get, source, profile, timeZone, check, describe, fileValue };
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
// A private key determines its public key; derive it and compare.
function vapidPairMatches(pub, priv) {
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(String(priv), 'base64url'));
    return ecdh.getPublicKey().equals(Buffer.from(String(pub), 'base64url'));
  } catch (e) { return false; }
}

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

/**
 * Run the check for this process and stop on an error: one sentence per
 * problem, exit code 78. Warnings print and startup carries on. Written with
 * fs.writeSync so the reason survives process.exit on a Windows pipe.
 */
function startupCheck(s = current()) {
  const problems = s.check();
  for (const w of problems.filter((x) => x.level === 'warning')) writeStderr(`  Settings: ${w.message}\n`);
  const errors = problems.filter((x) => x.level === 'error');
  if (errors.length) {
    const who = s.app === 'central' ? 'OpsPoint HQ' : 'OpsPoint';
    writeStderr(`\n  ${who} can't start: ${errors[0].message}\n` +
      errors.slice(1).map((e) => `  Also: ${e.message}\n`).join('') + '\n');
    process.exit(EX_CONFIG);
  }
  const prof = s.profile(), tz = s.timeZone();
  process.stdout.write(`  Settings: profile ${prof.name}${prof.inferred ? ' (inferred)' : ''}, time zone ${tz.name}` +
    `${tz.explicit ? '' : " (this machine's)"}\n`);
  return problems;
}

module.exports = {
  get: (name) => current().get(name),
  source: (name) => current().source(name),
  profile: () => current().profile(),
  timeZone: () => current().timeZone(),
  check: () => current().check(),
  describe: () => current().describe(),
  forApp, useApp, createSettings, startupCheck, parseValue, canonicalZone,
  SettingsError, EX_CONFIG, BASE, CHECKS, WARNING_CHECKS,
};
