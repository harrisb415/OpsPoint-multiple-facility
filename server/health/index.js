'use strict';
/**
 * server/health — "is this install healthy?", answered the same way everywhere:
 * the server (Admin › System health, GET /healthz, before an update, at every
 * start) and `node server/cli/opspoint.js doctor` in another process.
 *
 * Every check says what it found in plain words, and how to fix a failure.
 *   pass  fine
 *   warn  works, but needs attention
 *   fail  broken, or a safeguard is missing
 *   skip  not part of this kind of install
 * Only a CRITICAL failure — the database can't be reached — makes /healthz
 * answer 503. A load balancer takes a 503 instance out of service, which fixes
 * nothing for a stale backup and would only turn it into an outage.
 *
 * createDoctor() takes what a check may touch — the database connection,
 * settings, paths, and in the server the updater and push service — so the
 * same checks run in the server and in the command line.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROFILES, BY_NAME } = require('../settings/schema');
const { canonicalZone, parseDsn } = require('../settings');
const instances = require('./instances');
const parity = require('./schemaParity');

const HOUR = 3600 * 1000;
const BACKUP_MAX_AGE_MS = 26 * HOUR;        // a daily job gets two hours' slack
const DISK_MIN_FREE = 0.20;
const CERT_MIN_DAYS = 14;
const EXPENSIVE_TTL_MS = HOUR;              // schema comparison, update manifest
const HEALTHZ_TTL_MS = 15 * 1000;           // a load balancer polls far more often

// ── Words ───────────────────────────────────────────────────────────────────
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}
function every(ms) {
  const s = Math.round(ms / 1000);
  if (s < 120) return `every ${s} seconds`;
  const m = Math.round(s / 60);
  if (m < 120) return `every ${m} minutes`;
  return `every ${Math.round(m / 60)} hours`;
}
function gb(bytes) { return `${(bytes / 1073741824).toFixed(bytes < 10737418240 ? 1 : 0)} GB`; }
function oneLine(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300); }
function listOf(items, max = 4) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
}
// Audit timestamps: ISO with a zone on Postgres, local text from nowLocal()
// on SQLite ('YYYY-MM-DD HH:MM:SS', which Date reads as local time).
function auditMs(ts) {
  const s = String(ts || '').trim();
  if (!s) return NaN;
  return /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(s) ? Date.parse(s) : Date.parse(s.replace(' ', 'T'));
}
const localDay = (ms) => new Date(ms).toLocaleDateString('en-CA');

// ── The checks, in the order Admin lists them ──────────────────────────────
const CHECKS = [
  {
    id: 'timezone', label: 'Time zone',
    async run(ctx) {
      const tz = ctx.settings.timeZone();
      const bad = ctx.settingsProblems().find((p) => p.level === 'error' && (p.setting === 'TZ' || p.setting === 'PGTZ'));
      if (bad) return { status: 'fail', says: bad.message, fix: "Set TZ to the facility's time zone and restart OpsPoint." };
      const how = tz.explicit ? 'set by TZ' : "this machine's zone";
      if (!ctx.conn.isPg) return { status: 'pass', says: `${tz.name} (${how}).` };
      const row = await ctx.conn.query1('SHOW timezone');
      const raw = row ? String(Object.values(row)[0]) : '';
      if (canonicalZone(raw) !== tz.name) {
        return { status: 'fail', says: `The server runs in ${tz.name} but the database session is in ${raw || 'an unknown zone'}.`,
          fix: 'Remove PGTZ, or make it the same zone as TZ, and restart OpsPoint.' };
      }
      return { status: 'pass', says: `${tz.name} (${how}); the database session agrees.` };
    },
  },
  {
    id: 'database', label: 'Database',
    async run(ctx) {
      const t0 = Date.now();
      try { await ctx.conn.query1('SELECT 1 AS ok'); }
      catch (e) {
        return { status: 'fail', critical: true, says: `Can't reach the database: ${oneLine(e.message)}.`,
          fix: ctx.conn.isPg ? 'Check that Postgres is running and reachable, and that DATABASE_URL and PGSSLMODE are right.'
            : 'Check the data folder and the .dbkey file beside the database.' };
      }
      const ms = Date.now() - t0;
      if (!ctx.conn.isPg) return { status: 'pass', says: `SQLite (${path.basename(ctx.config.DB_PATH)}) answers in ${ms} ms; the code builds its schema at every start.` };
      const p = await ctx.parity();
      const where = `Postgres (${ctx.pgTarget()})`;
      if (p.error) return { status: 'warn', says: `${where} answers in ${ms} ms, but its schema couldn't be compared with the code's: ${p.error}.` };
      if (p.errors.length) {
        return { status: 'fail', says: `${where} answers, but it lacks ${p.errors.length} thing(s) this version uses: ${listOf(p.errors.map((e) => e.replace(/^facility: /, '')))}.`,
          fix: `Run \`node server/cli/opspoint.js migrate\` (or restart with OPSPOINT_MIGRATE=start); the newest file is ${ctx.newestMigration()}. If they are all recorded, a file was changed after it was applied.` };
      }
      return { status: 'pass', says: `${where} answers in ${ms} ms; every table and column this version uses exists.` };
    },
  },
  {
    id: 'migrations', label: 'Migrations',
    async run(ctx) {
      if (!ctx.conn.isPg) return { status: 'pass', says: 'None pending: SQLite schema changes apply themselves at every start.' };
      const runner = require('../db/runner');
      const st = await runner.status({ pool: ctx.conn.getDb(), app: 'facility' });
      const last = st.files.length ? st.files[st.files.length - 1].name : 'none';
      if (st.unrecorded) {
        return { status: 'warn', says: 'Nothing records which migrations this database has: it was migrated by hand.',
          fix: 'Restart OpsPoint (OPSPOINT_MIGRATE=start notes what is there once its schema matches the code), or run `node server/cli/opspoint.js migrate`.' };
      }
      if (st.pending.length) {
        return { status: 'fail', says: `Pending: ${listOf(st.pending.map((f) => f.name))}.`,
          fix: 'Restart OpsPoint (OPSPOINT_MIGRATE=start applies them), or run `node server/cli/opspoint.js migrate`.' };
      }
      if (st.changed.length) {
        return { status: 'warn', says: `All applied, but ${listOf(st.changed.map((f) => f.name))} changed after being applied, and an applied file never runs again.`,
          fix: 'Put the file back as it was, and make the change in a new migration file.' };
      }
      return { status: 'pass', says: `None pending: all ${st.files.length} are recorded, up to ${last}.` };
    },
  },
  {
    id: 'storage', label: 'File storage',
    async run(ctx) {
      const st = ctx.storage();
      const where = st.describe();
      if (st.kind === 'local' && !st.backend.hasFolder('photos/x')) {
        return { status: 'fail', says: `The photos folder in ${where} doesn't exist.`, fix: 'Start OpsPoint (it creates the folder), or check OPSPOINT_STORAGE_DIR.' };
      }
      let ms;
      try { ms = await st.probe(); }
      catch (e) {
        const fix = {
          local: 'Make sure the folder exists and the account OpsPoint runs as can write to it.',
          'azure-blob': 'Check that the container exists and that the managed identity (or the connection string) may write to it.',
          s3: 'Check that the bucket exists in that region and that the role or keys may put, get and delete objects in it.',
          gcs: 'Check that the bucket exists and that the service account may create, read and delete objects in it.',
        }[st.kind];
        return { status: 'fail', says: `Photos can't be saved in ${where}: ${oneLine(e.code === 'EACCES' || e.code === 'EPERM' ? e.code : e.message)}.`, fix };
      }
      return { status: 'pass', says: `A test file wrote, read back and deleted in ${where} (${ms} ms).` };
    },
  },
  {
    id: 'secrets', label: 'Secrets',
    async run(ctx) {
      const bad = ctx.settingsProblems().find((p) => p.level === 'error' && p.setting && BY_NAME[p.setting] && BY_NAME[p.setting].secret);
      if (bad) return { status: 'fail', says: bad.message };
      const parts = [];
      if (ctx.settings.get('SESSION_SECRET')) parts.push('session key (from the settings)');
      else {
        let ok = false;
        try { ok = fs.readFileSync(ctx.config.SECRET_FILE, 'utf8').trim().length > 0; } catch (e) { /* missing */ }
        if (!ok) {
          return { status: 'fail', says: `There is no session key: SESSION_SECRET is unset and ${ctx.config.SECRET_FILE} doesn't exist.`,
            fix: 'Start OpsPoint once (it makes the file), or set SESSION_SECRET.' };
        }
        parts.push('session key (in the data folder)');
      }
      if (ctx.conn.isPg) parts.push('database connection string');
      return { status: 'pass', says: `Present: ${parts.join(', ')}.` };
    },
  },
  {
    id: 'dbkey', label: 'Encryption key',
    async run(ctx) {
      if (ctx.conn.isPg) return { status: 'skip', says: 'Postgres: the database server encrypts at rest; OpsPoint keeps no key of its own.' };
      if (!ctx.settings.get('OPSPOINT_ENCRYPT')) {
        return { status: 'warn', says: 'The database is stored unencrypted (OPSPOINT_ENCRYPT=0).',
          fix: 'Remove OPSPOINT_ENCRYPT and restart: OpsPoint encrypts the database in place and keeps a safety copy.' };
      }
      const key = ctx.dbKey();
      if (!key) return { status: 'fail', says: `The database key is missing: ${ctx.dbKeyPath()} doesn't exist.`, fix: 'Restore the .dbkey file that belongs to this database.' };
      const c = await ctx.readSetting('dbkey_backup_confirmed', null);
      if (c && c.fp === key.fingerprint) {
        return { status: 'pass', says: `Stored somewhere else: confirmed by ${c.by || 'an admin'} on ${c.at || 'an earlier date'}.` };
      }
      const why = c && c.fp ? `The key changed after it was confirmed on ${c.at}` : 'Nobody has confirmed the key is stored somewhere else';
      return { status: 'fail', says: `${why}; without it the database and every backup of it are unreadable.`,
        fix: `Copy ${ctx.dbKeyPath()} somewhere off this machine (a password manager, or a USB key kept apart from the backups), then press "Key stored elsewhere".`,
        action: 'dbkey-confirm' };
    },
  },
  {
    id: 'backups', label: 'Backups',
    async run(ctx) {
      if (ctx.settings.get('OPSPOINT_BACKUPS') === 'provider') {
        return { status: 'pass', says: "Left to the platform's point-in-time restore (OPSPOINT_BACKUPS=provider), which OpsPoint can't see from here." };
      }
      if (!ctx.conn.isPg && !(await ctx.readSetting('backup_enabled', true))) {
        return { status: 'fail', says: 'Scheduled backups are switched off (the backup_enabled setting).', fix: 'Set backup_enabled back to true and restart OpsPoint.' };
      }
      const good = await ctx.conn.query1("SELECT id, ts FROM audit_log WHERE action='backup.create' ORDER BY id DESC LIMIT 1");
      const bad = await ctx.conn.query1("SELECT id, ts, detail FROM audit_log WHERE action='backup.failed' ORDER BY id DESC LIMIT 1");
      if (bad && (!good || Number(bad.id) > Number(good.id))) {
        const when = auditMs(bad.ts);
        let detail = '';
        try { const d = JSON.parse(bad.detail || '{}'); detail = d.error || ''; } catch (e) { detail = bad.detail || ''; }
        return { status: 'fail', says: `The last backup failed${Number.isFinite(when) ? ' ' + ago(ctx.now - when) : ''}${detail ? ': ' + oneLine(detail) : ''}.`,
          fix: 'Check the backup destination is reachable and has space, then watch the next run.' };
      }
      if (!good) {
        return { status: 'fail', says: 'No backup has been recorded yet.',
          fix: ctx.conn.isPg ? 'Schedule a pg_dump job that records each run in the audit log (scripts/opspoint-backup.sh does), or set OPSPOINT_BACKUPS=provider on a managed platform.'
            : 'The first scheduled backup runs 90 seconds after the server starts; check the server log if none appears.' };
      }
      const when = auditMs(good.ts);
      const age = ctx.now - when;
      if (!Number.isFinite(when) || age > BACKUP_MAX_AGE_MS) {
        return { status: 'fail', says: `The last backup was ${Number.isFinite(when) ? ago(age) : 'at an unreadable time'}; there should be one every day.`,
          fix: ctx.conn.isPg ? 'Check the pg_dump job (its timer and its log).' : 'Check the server log for [backup] lines; backups run every few hours while the server is up.' };
      }
      if (!ctx.conn.isPg) {
        const dir = await ctx.backupDir();
        if (path.parse(path.resolve(dir)).root === path.parse(path.resolve(ctx.config.DB_PATH)).root && !(await ctx.readSetting('backup_same_volume_ack', false))) {
          return { status: 'warn', says: `Last backup ${ago(age)}, but in ${dir}, on the same drive as the database: it survives mistakes, not a failed drive.`,
            fix: 'Point the backup_dir setting at another drive, or copy the backups off this machine.' };
        }
      }
      return { status: 'pass', says: `Last backup ${ago(age)}.` };
    },
  },
  {
    id: 'jobs', label: 'Background jobs',
    async run(ctx) {
      const live = (await ctx.instances()).filter((i) => i.live);
      if (!live.length) {
        return { status: 'fail', says: 'No running OpsPoint server has reported in for over two minutes.',
          fix: 'Start OpsPoint, or check its log if it keeps stopping.' };
      }
      const stalled = [], ok = [];
      for (const inst of live) {
        for (const [name, j] of Object.entries(inst.jobs || {})) {
          const since = ctx.now - (j.lastRun || j.registeredAt || ctx.now);
          const limit = 2 * (j.everyMs || 60000) + 60000;
          if (since > limit) stalled.push(`${j.label || name} (last ran ${j.lastRun ? ago(since) : 'never'}; runs ${every(j.everyMs)})`);
          else ok.push((j.label || name).toLowerCase());
        }
      }
      if (stalled.length) {
        return { status: 'fail', says: `Stalled: ${listOf(stalled)}.`,
          fix: 'Restart OpsPoint. On a managed platform keep at least one instance running with CPU always allocated.' };
      }
      return { status: 'pass', says: ok.length ? `All ${ok.length} ran on time: ${listOf([...new Set(ok)], 6)}.` : 'None scheduled.' };
    },
  },
  {
    id: 'disk', label: 'Disk space',
    async run(ctx) {
      if (ctx.profile.kind !== 'local') return { status: 'skip', says: 'The platform manages the disk.' };
      let st;
      try { st = fs.statfsSync(ctx.config.DATA_DIR); }
      catch (e) { return { status: 'warn', says: `Couldn't read the free space where the data folder is: ${oneLine(e.code || e.message)}.` }; }
      const total = Number(st.blocks) * Number(st.bsize), free = Number(st.bavail) * Number(st.bsize);
      const pct = total > 0 ? free / total : 0;
      const says = `${Math.round(pct * 100)}% free on the data folder's drive (${gb(free)} of ${gb(total)}).`;
      if (pct < DISK_MIN_FREE) return { status: 'fail', says, fix: 'Free up space, or move the data folder (OPSPOINT_DATA) to a bigger drive.' };
      return { status: 'pass', says };
    },
  },
  {
    id: 'certificate', label: 'Certificate',
    async run(ctx) {
      const certFile = path.join(ctx.config.DATA_DIR, 'cert.pem');
      if (!fs.existsSync(certFile)) return { status: 'skip', says: "OpsPoint has no certificate of its own: HTTPS is handled in front of it." };
      let cert;
      try { cert = new crypto.X509Certificate(fs.readFileSync(certFile)); }
      catch (e) { return { status: 'fail', says: `data/cert.pem can't be read as a certificate: ${oneLine(e.message)}.`, fix: 'Replace it (node generate_cert.js makes a self-signed one).' }; }
      const until = Date.parse(cert.validTo);
      const days = Math.floor((until - ctx.now) / 86400000);
      if (days < 0) return { status: 'fail', says: `The certificate expired ${ago(ctx.now - until)} (${localDay(until)}).`, fix: 'Renew it: put the new certificate in data/cert.pem and its key in data/key.pem, then restart.' };
      if (days < CERT_MIN_DAYS) return { status: 'fail', says: `The certificate expires in ${days} days (${localDay(until)}).`, fix: 'Renew it before then: put the new certificate in data/cert.pem and its key in data/key.pem, then restart.' };
      return { status: 'pass', says: `Valid for ${days} more days (until ${localDay(until)}).` };
    },
  },
  {
    id: 'push', label: 'Push alerts',
    async run(ctx) {
      const webpush = require('../lib/webpush');
      let pub = ctx.settings.get('VAPID_PUBLIC_KEY'), priv = ctx.settings.get('VAPID_PRIVATE_KEY'), from = 'the settings';
      if (!pub && !priv) {
        const file = path.join(ctx.config.DATA_DIR, 'vapid.json');
        try { const k = JSON.parse(fs.readFileSync(file, 'utf8')); pub = k.publicKey; priv = k.privateKey; from = 'the data folder'; }
        catch (e) { return { status: 'warn', says: 'No push keys yet: the server makes them at its next start.' }; }
      }
      if (!pub || !priv || !webpush.pairMatches(pub, priv)) {
        return { status: 'fail', says: `The push keys in ${from} are not one valid key pair, so no phone gets alerts.`,
          fix: 'Make a new pair with `node server/cli/opspoint.js keys` (phones then re-enable alerts once).' };
      }
      let phones = null;
      try { const r = await ctx.conn.query1('SELECT COUNT(*) AS c FROM push_subscriptions'); phones = Number(r.c); } catch (e) { /* older schema */ }
      return { status: 'pass', says: `Keys valid (from ${from})${phones === null ? '' : `; ${phones} phone${phones === 1 ? '' : 's'} subscribed`}.` };
    },
  },
  {
    id: 'updates', label: 'Update source',
    async run(ctx) {
      if (ctx.settings.get('OPSPOINT_UPDATES') !== 'in-app') return { status: 'skip', says: 'New versions arrive from the platform (OPSPOINT_UPDATES=platform).' };
      const u = await ctx.probeUpdates();
      if (u.error) {
        return { status: 'fail', says: `Can't check for updates: ${u.error}.`,
          fix: 'Check that this machine can reach the release site (or the HQ relay), or set OPSPOINT_UPDATES=platform if updates arrive another way.' };
      }
      if (!u.signed) return { status: 'fail', says: `The release manifest for v${u.latest} is not signed with the OpsPoint release key.`, fix: 'Leave it uninstalled and tell OpsPoint support.' };
      return { status: 'pass', says: `Release list reachable and signed; the newest is v${u.latest}${u.latest === u.current ? ', which this is' : ` (this is v${u.current})`}.` };
    },
  },
  {
    id: 'instances', label: 'Instance count',
    async run(ctx) {
      const live = (await ctx.instances()).filter((i) => i.live);
      if (!live.length) return { status: 'fail', says: 'No running OpsPoint server has reported in for over two minutes.', fix: 'Start OpsPoint.' };
      if (live.length === 1) {
        const i = live[0];
        return { status: 'pass', says: `One server running (${i.hostname}, process ${i.pid}, v${i.version || '?'}).` };
      }
      const who = live.map((i) => `${i.hostname} process ${i.pid}`);
      const says = `${live.length} servers are running: ${listOf(who)}. Timers, live updates and rate limits assume exactly one.`;
      if (ctx.profile.kind === 'local') return { status: 'warn', says, fix: 'Stop the extra one; two servers on one database double every alert.' };
      return { status: 'fail', says, fix: 'Keep the service at exactly one instance until scale-out lands (roadmap phase 10).' };
    },
  },
];

// ── The doctor ──────────────────────────────────────────────────────────────
/**
 * opts:
 *   conn          the database connection (query/query1/run, isPg)
 *   settings      a settings instance (server/settings forApp('facility'))
 *   config        { DATA_DIR, DB_PATH, SECRET_FILE, BASE }
 *   storage       optional: a server/storage instance (default: this process's)
 *   updater       optional: { probe() } — the release manifest
 *   beforeRun     optional async fn run first (the server writes its heartbeat)
 *   timeoutMs     per check (default 20 s; the schema comparison gets 120 s)
 */
function createDoctor(opts) {
  const { conn, settings, config } = opts;
  const cache = {};                 // expensive results: key -> { at, value }
  let last = null;                  // the latest full run
  let healthzLast = null;

  async function readSetting(key, def) {
    const row = await conn.query1('SELECT value FROM settings WHERE key=?', [key]);
    if (!row) return def;
    try { return JSON.parse(row.value); } catch (e) { return row.value; }
  }
  async function cached(key, fresh, compute) {
    const hit = cache[key];
    if (!fresh && hit && Date.now() - hit.at < EXPENSIVE_TTL_MS) return hit.value;
    const value = await compute();
    cache[key] = { at: Date.now(), value };
    return value;
  }
  function dbKeyPath() { return require('../db/dbcrypt').keyPathFor(config.DB_PATH); }

  async function run({ fresh = false, only = null } = {}) {
    const now = Date.now();
    if (opts.beforeRun) { try { await opts.beforeRun(); } catch (e) { /* the jobs check reports a missing heartbeat */ } }
    let _problems, _instances, _parity;
    const ctx = {
      now, conn, settings, config, fresh, readSetting,
      profile: PROFILES[settings.profile().name],
      storage: () => opts.storage || require('../storage').storage(),
      settingsProblems: () => (_problems ||= settings.check()),
      instances: () => (_instances ||= instances.list(conn, 'facility', now)),
      parity: () => (_parity ||= cached('parity', fresh, async () => {
        try { return parity.compare('facility', parity.codeSchema('facility'), await parity.pgSchemaVia(conn)); }
        catch (e) { return { error: oneLine(e.message), errors: [], warnings: [] }; }
      })),
      probeUpdates: () => cached('updates', fresh, async () => {
        if (!opts.updater || !opts.updater.probe) return { error: 'the updater is not loaded in this process' };
        try { return await opts.updater.probe(); } catch (e) { return { error: oneLine(e.message) }; }
      }),
      pgTarget: () => {
        const c = parseDsn(settings.get('DATABASE_URL') || '');
        return c ? `${c.host || 'localhost'}/${c.database || ''}` : 'DATABASE_URL';
      },
      newestMigration: () => {
        try { return fs.readdirSync(path.join(config.BASE, 'migrations', 'pg')).filter((f) => /^\d+_.*\.sql$/.test(f)).sort().pop() || 'none'; }
        catch (e) { return 'unknown'; }
      },
      dbKeyPath,
      dbKey: () => {
        try {
          const key = fs.readFileSync(dbKeyPath(), 'utf8').trim();
          return key ? { fingerprint: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) } : null;
        } catch (e) { return null; }
      },
      backupDir: async () => (await readSetting('backup_dir', null)) || path.join(path.dirname(config.DB_PATH), 'backups', 'scheduled'),
    };

    const list = only ? CHECKS.filter((c) => only.includes(c.id)) : CHECKS;
    const results = [];
    for (const c of list) {
      const t0 = Date.now();
      const limit = opts.timeoutMs || (c.id === 'database' || c.id === 'migrations' ? 120000 : 20000);
      let r;
      try {
        r = await Promise.race([
          c.run(ctx),
          new Promise((_, reject) => { const t = setTimeout(() => reject(new Error(`no answer in ${Math.round(limit / 1000)} seconds`)), limit); if (t.unref) t.unref(); }),
        ]);
      } catch (e) {
        r = { status: 'fail', says: `The check itself failed: ${oneLine(e.message)}.`, critical: c.id === 'database' };
      }
      results.push({ id: c.id, label: c.label, status: r.status, says: r.says, fix: r.fix || null, action: r.action || null, critical: !!r.critical, ms: Date.now() - t0 });
    }
    const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
    for (const r of results) summary[r.status]++;
    const out = { at: new Date(now).toISOString(), ok: !results.some((r) => r.critical && r.status === 'fail'), summary, results };
    if (!only) last = out;
    return out;
  }

  // For a load balancer or a platform probe: pass or fail per check and
  // nothing else — no words, settings, paths or versions. Cached for a few
  // seconds; the expensive parts reuse their hourly results.
  async function healthz() {
    if (!healthzLast || Date.now() - healthzLast.t > HEALTHZ_TTL_MS) {
      const r = await run();
      const checks = {};
      for (const x of r.results) if (x.status !== 'skip') checks[x.id] = x.status === 'fail' ? 'fail' : 'pass';
      healthzLast = { t: Date.now(), body: { ok: r.ok, checks } };
    }
    return healthzLast.body;
  }

  return { run, healthz, latest: () => last, readSetting, dbKeyPath };
}

// One line for a log: "all 13 pass" or "2 need attention: backups (…), …".
function summaryLine(r) {
  const bad = r.results.filter((x) => x.status === 'fail' || x.status === 'warn');
  if (!bad.length) return `all ${r.results.filter((x) => x.status !== 'skip').length} checks pass`;
  return `${bad.length} need${bad.length === 1 ? 's' : ''} attention: ` + bad.map((x) => `${x.label.toLowerCase()} (${x.status})`).join(', ');
}

module.exports = { createDoctor, summaryLine, CHECKS, _ago: ago, _auditMs: auditMs };
