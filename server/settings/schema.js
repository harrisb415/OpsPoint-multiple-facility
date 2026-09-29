'use strict';
/**
 * server/settings/schema.js — every setting OpsPoint reads from its
 * environment, declared once.
 *
 * Startup validation, `node server/cli/opspoint.js settings`, docs/SETTINGS.md
 * and (later) the installers and the setup wizard all read this list, so they
 * cannot drift apart. A setting has one name everywhere: the environment
 * variable, the key in opspoint.config.json, and the line in an installer's
 * answers file.
 *
 * Adding a setting: declare it here, read it with settings.get('NAME') (never
 * process.env directly), then regenerate the doc with
 *   node server/cli/opspoint.js settings docs > docs/SETTINGS.md
 * (tests/settings.test.js fails until the doc matches).
 *
 * Fields
 *   name      the environment variable, and the key in opspoint.config.json
 *   group     heading it is listed under
 *   scope     'shared'   both apps read it (facility and HQ)
 *             'facility' the facility app only
 *             'central'  HQ only
 *             'per-app'  both, each with its own value (PORT): the top level of
 *                        opspoint.config.json is the facility's, its "central"
 *                        object HQ's
 *   type      how the value is read: enum, int, bool, string, path, timezone,
 *             pgurl, trustProxy, host, size
 *   default   a value, { facility, central } for per-app, or ctx => value
 *   defaultText  how the docs show a default computed by a function
 *   secret    never printed, logged or returned by any endpoint
 *   envOnly   only the environment may set it (not the settings file)
 *   noun      what it is, as it reads inside "needs NAME, <noun>"
 *   summary   one or two sentences for the docs
 *   requiredIn            profiles that refuse to start without it
 *   requiredWhen          [setting, value]: needed whenever that setting has that value
 *   pairWith  the other half of a pair set together (the push keys)
 *   onlyIn    { profiles, values, because }: those profiles accept only these values
 *   readBy    code outside server/ that reads it itself (docs only)
 *   ask       { question, example }: how an installer or the wizard asks for it
 */
const path = require('path');

const MANAGED = ['azure', 'aws', 'gcp'];

// What changes when a deployment is one kind or another. A profile only sets
// defaults; any setting can still be set on its own.
const MANAGED_DEFAULTS = {
  OPSPOINT_DB_DRIVER:   'pg',        // the platform's disk is wiped on restart
  OPSPOINT_TRUST_PROXY: '1',         // one load balancer hop in front
  OPSPOINT_UPDATES:     'platform',  // new versions arrive as new deployments
};

const PROFILES = {
  'windows-local': {
    label: 'Windows, on-premises',
    summary: 'A facility PC or Windows Server; OpsPoint runs its own server.',
    kind: 'local',
    where: 'opspoint.config.json or the service environment',
    defaults: { OPSPOINT_OPEN_BROWSER: true },
  },
  'linux-local': {
    label: 'Linux, on-premises',
    summary: 'A Linux server, VM or container that OpsPoint runs itself (systemd or PM2).',
    kind: 'local',
    where: 'opspoint.config.json or the service environment',
    defaults: {},
  },
  azure: {
    label: 'Azure, managed',
    summary: 'App Service or Container Apps, with Azure Database for PostgreSQL.',
    kind: 'managed',
    where: 'the App Service or Container App settings',
    defaults: MANAGED_DEFAULTS,
  },
  aws: {
    label: 'AWS, managed',
    summary: 'ECS Fargate behind an Application Load Balancer, with RDS or Aurora PostgreSQL.',
    kind: 'managed',
    where: 'the ECS task definition',
    defaults: MANAGED_DEFAULTS,
  },
  gcp: {
    label: 'Google Cloud, managed',
    summary: 'Cloud Run (at least one instance, CPU always allocated), with Cloud SQL for PostgreSQL.',
    kind: 'managed',
    where: 'the Cloud Run service settings',
    defaults: MANAGED_DEFAULTS,
  },
  docker: {
    label: 'Docker',
    summary: 'Docker Compose on any Linux host: a Postgres container (or an external one) and a data volume.',
    kind: 'container',
    where: 'the compose file or its .env file',
    defaults: {
      OPSPOINT_DB_DRIVER:   'pg',
      OPSPOINT_TRUST_PROXY: 'loopback, uniquelocal',   // the proxy container is on the private Docker network
      OPSPOINT_UPDATES:     'platform',
    },
  },
};
const PROFILE_NAMES = Object.keys(PROFILES);

const SETTINGS = [
  // ── Deployment ────────────────────────────────────────────────────────────
  {
    name: 'OPSPOINT_PROFILE', group: 'Deployment', scope: 'shared', type: 'enum', values: PROFILE_NAMES,
    noun: 'the kind of deployment',
    summary: 'Which kind of deployment this is; it picks the defaults for everything else. ' +
             'Unset: windows-local on Windows, linux-local anywhere else.',
    ask: { question: 'Where is OpsPoint running?', example: 'linux-local' },
  },
  {
    name: 'OPSPOINT_CONFIG', group: 'Deployment', scope: 'shared', type: 'path', envOnly: true,
    noun: 'the settings file',
    summary: 'Where the settings file is. Unset: opspoint.config.json in the app folder, when there is one. ' +
             '"none" ignores any settings file (the tests and the permission audit use this).',
  },
  {
    name: 'TZ', group: 'Deployment', scope: 'shared', type: 'timezone',
    noun: "the facility's time zone (for example America/Chicago)",
    summary: "The facility's time zone, as an IANA name such as America/Los_Angeles. The server, the database " +
             'session and the facility must agree, or evening entries are filed under the next day. Required ' +
             'everywhere: unset is accepted only when the machine\'s own zone is a real one, never an implicit UTC.',
    ask: { question: 'Which time zone is the facility in?', example: 'America/Los_Angeles' },
  },

  // ── Server ────────────────────────────────────────────────────────────────
  {
    name: 'PORT', group: 'Server', scope: 'per-app', type: 'int', min: 1, max: 65535,
    default: { facility: 3000, central: 4000 },
    noun: 'the port to listen on',
    summary: 'The port the app listens on (the facility 3000, HQ 4000). Cloud platforms usually set it themselves.',
    ask: { question: 'Which port should OpsPoint listen on?', example: '3000' },
  },
  {
    name: 'OPSPOINT_BIND', group: 'Server', scope: 'facility', type: 'host', default: '0.0.0.0',
    noun: 'the address to listen on',
    summary: 'The network address the facility app listens on. 0.0.0.0 (every interface) lets staff phones reach ' +
             'it across the facility network; 127.0.0.1 makes it reachable only through a proxy on the same machine.',
  },
  {
    name: 'OPSPOINT_TRUST_PROXY', group: 'Server', scope: 'facility', type: 'trustProxy', default: 'loopback',
    noun: 'the proxies allowed to report the client address',
    summary: "Which proxies may tell the app a client's real address and whether its connection was HTTPS: " +
             'loopback (a proxy on the same machine), uniquelocal (private networks), an address or CIDR, or a ' +
             'hop count such as 1 behind a cloud load balancer. Wrong here means audit rows record the proxy, ' +
             'not the person.',
  },
  {
    name: 'OPSPOINT_DATA', group: 'Server', scope: 'facility', type: 'path',
    default: (ctx) => path.join(ctx.base, 'data'),
    defaultText: 'data, in the app folder',
    noun: 'the data folder',
    summary: 'The data folder: the SQLite database and its key, photos, backups, certificates and update files.',
  },
  {
    name: 'OPSPOINT_JSON_LIMIT', group: 'Server', scope: 'facility', type: 'size', default: '50mb',
    noun: 'the largest request accepted',
    summary: 'The largest request body accepted; photos arrive inside requests, so it is large.',
  },
  {
    name: 'OPSPOINT_IDLE_MINS', group: 'Server', scope: 'facility', type: 'int', min: 1, max: 1440, default: 30,
    noun: 'the idle sign-out time',
    summary: 'Minutes of inactivity before staff are signed out, until an admin sets it in Admin.',
  },
  {
    name: 'OPSPOINT_OPEN_BROWSER', group: 'Server', scope: 'facility', type: 'bool', default: false,
    noun: 'whether to open a browser at start',
    summary: 'Open the app in a browser on this machine when the server starts (on by default on windows-local).',
  },
  {
    name: 'OPSPOINT_UPDATES', group: 'Server', scope: 'facility', type: 'enum', values: ['in-app', 'platform'],
    default: 'in-app',
    noun: 'how new versions arrive',
    summary: 'How new versions arrive: in-app (Admin > System downloads, verifies and installs signed releases) ' +
             'or platform (a new container image or deployment; the in-app updater is switched off).',
    onlyIn: {
      profiles: [...MANAGED, 'docker'], values: ['platform'],
      because: 'the platform replaces the app\'s files on every deploy, so an update installed in place would be lost',
    },
  },

  // ── Database ──────────────────────────────────────────────────────────────
  {
    name: 'OPSPOINT_DB_DRIVER', group: 'Database', scope: 'shared', type: 'enum', values: ['sqlite', 'pg'],
    default: 'sqlite',
    noun: 'the database driver',
    summary: 'Which database: sqlite (an encrypted file in the data folder) or pg (PostgreSQL).',
    onlyIn: {
      profiles: MANAGED, values: ['pg'],
      because: 'a SQLite file on the platform\'s disk would be lost on every restart or redeploy',
    },
    ask: { question: 'Which database: SQLite (a file on this machine) or PostgreSQL?', example: 'sqlite' },
  },
  {
    name: 'OPSPOINT_DB', group: 'Database', scope: 'facility', type: 'path',
    default: (ctx) => path.join(ctx.get('OPSPOINT_DATA'), 'opspoint.db'),
    defaultText: 'opspoint.db, in the data folder',
    noun: 'the SQLite database file',
    summary: 'The SQLite database file (driver sqlite). Its encryption key is the .dbkey file beside it.',
  },
  {
    name: 'OPSPOINT_ENCRYPT', group: 'Database', scope: 'shared', type: 'bool', tokens: { 1: true, 0: false },
    default: true,
    noun: 'whether the SQLite file is encrypted',
    summary: 'Encrypt the SQLite database file: 1 (the default) or 0. With 0 an already encrypted database will ' +
             'not open; decrypt it deliberately instead.',
  },
  {
    name: 'DATABASE_URL', group: 'Database', scope: 'facility', type: 'pgurl', secret: true,
    requiredWhen: ['OPSPOINT_DB_DRIVER', 'pg'],
    noun: 'the facility\'s Postgres connection string',
    summary: 'The facility\'s PostgreSQL connection string, postgresql://user:password@host:5432/database (driver pg).',
    ask: { question: 'PostgreSQL connection string for the facility database', example: 'postgresql://opspoint:…@db:5432/opspoint' },
  },
  {
    name: 'PGSSLMODE', group: 'Database', scope: 'shared', type: 'enum',
    values: ['disable', 'require', 'verify-ca', 'verify-full'], default: 'verify-full',
    noun: 'the Postgres connection encryption',
    summary: 'Encryption for Postgres connections: verify-full (the default: encrypted, certificate checked), ' +
             'require (encrypted, certificate not checked) or disable (plain; only on one host or a private network).',
  },
  {
    name: 'PGSSLROOTCERT', group: 'Database', scope: 'shared', type: 'path',
    noun: 'the CA certificate for Postgres',
    summary: 'The CA certificate that signed the Postgres server\'s certificate, when it is not a public one ' +
             '(for example the Amazon RDS bundle).',
  },
  {
    name: 'PGPOOL_MAX', group: 'Database', scope: 'shared', type: 'int', min: 1, max: 1000, default: 10,
    noun: 'the most Postgres connections at once',
    summary: 'The most Postgres connections held open at once.',
  },
  {
    name: 'PGTZ', group: 'Database', scope: 'shared', type: 'timezone',
    noun: 'the Postgres session time zone',
    summary: 'The Postgres session time zone. Leave it unset so it follows TZ; if set, it must equal TZ.',
  },

  // ── Security ──────────────────────────────────────────────────────────────
  {
    name: 'SESSION_SECRET', group: 'Security', scope: 'facility', type: 'string', minLength: 32, secret: true,
    requiredIn: MANAGED,
    noun: 'the key that signs sign-in cookies (at least 32 random characters)',
    summary: 'The key that signs sign-in cookies. Unset: generated once into OPSPOINT_SECRET_FILE. Managed ' +
             'platforms must set it, because their disk is wiped on restart and everyone would be signed out.',
  },
  {
    name: 'OPSPOINT_SECRET_FILE', group: 'Security', scope: 'facility', type: 'path',
    default: (ctx) => path.join(ctx.get('OPSPOINT_DATA'), 'secret.key'),
    defaultText: 'secret.key, in the data folder',
    noun: 'the session key file',
    summary: 'Where the generated session key is kept when SESSION_SECRET is unset.',
  },

  // ── Push alerts ───────────────────────────────────────────────────────────
  {
    name: 'VAPID_PUBLIC_KEY', group: 'Push alerts', scope: 'facility', type: 'string', pairWith: 'VAPID_PRIVATE_KEY',
    requiredIn: MANAGED,
    noun: 'the push alert public key',
    summary: 'Push alert public key. Set it with VAPID_PRIVATE_KEY, or leave both unset to generate a pair into ' +
             'the data folder. Changing it cuts off every subscribed phone. Make a pair with ' +
             '`node server/cli/opspoint.js keys`.',
  },
  {
    name: 'VAPID_PRIVATE_KEY', group: 'Push alerts', scope: 'facility', type: 'string', secret: true,
    pairWith: 'VAPID_PUBLIC_KEY', requiredIn: MANAGED,
    noun: 'the push alert private key',
    summary: 'Push alert private key, the other half of VAPID_PUBLIC_KEY.',
  },
  {
    name: 'VAPID_SUBJECT', group: 'Push alerts', scope: 'facility', type: 'string', default: 'mailto:opspoint@localhost',
    pattern: /^(mailto:\S+@\S+|https:\/\/\S+)$/, patternText: 'a mailto: address or an https:// link',
    noun: 'the contact given to push services',
    summary: 'The contact push services are given, as mailto: or https:. A real address is better: some push ' +
             'services reject localhost.',
  },

  // ── Supervisor (bootstrap.js reads these itself) ──────────────────────────
  {
    name: 'OPSPOINT_HEALTH_PATH', group: 'Supervisor', scope: 'facility', type: 'string', default: '/api/health',
    pattern: /^\/\S*$/, patternText: 'a path starting with /', readBy: 'bootstrap.js',
    noun: 'the health path the supervisor polls',
    summary: 'The path bootstrap.js polls to decide that an updated server came up healthy.',
  },
  {
    name: 'OPSPOINT_VERIFY_TIMEOUT', group: 'Supervisor', scope: 'facility', type: 'int', min: 5000, max: 3600000,
    default: 90000, readBy: 'bootstrap.js',
    noun: 'how long the supervisor waits for an update',
    summary: 'Milliseconds bootstrap.js waits for an updated server to answer before rolling the update back.',
  },

  // ── HQ (central) ──────────────────────────────────────────────────────────
  {
    name: 'CENTRAL_DATA', group: 'HQ', scope: 'central', type: 'path',
    default: (ctx) => path.join(ctx.base, 'central', 'data'),
    defaultText: 'central/data, in the app folder',
    noun: "HQ's data folder",
    summary: "HQ's data folder: its SQLite database, certificates and update files.",
  },
  {
    name: 'CENTRAL_BIND', group: 'HQ', scope: 'central', type: 'host', default: '0.0.0.0',
    noun: 'the address HQ listens on',
    summary: 'The network address HQ listens on; 127.0.0.1 when a proxy on the same machine fronts it.',
  },
  {
    name: 'CENTRAL_DATABASE_URL', group: 'HQ', scope: 'central', type: 'pgurl', secret: true,
    requiredWhen: ['OPSPOINT_DB_DRIVER', 'pg'],
    noun: "HQ's own Postgres connection string (not the facility's)",
    summary: "HQ's PostgreSQL connection string (driver pg). HQ keeps its own database, never the facility's.",
  },
  {
    name: 'CENTRAL_ADMIN_PW', group: 'HQ', scope: 'central', type: 'string', secret: true,
    noun: "the first HQ admin's password",
    summary: "Password for HQ's first admin account on an empty HQ database; it must be changed at first sign-in. " +
             'Unset: a random one is printed once.',
  },
];

// Environment variables that are part of how OpsPoint's own pieces talk to
// each other, or of release tooling — not settings, but not typos either.
const INTERNAL_ENV = [
  'OPSPOINT_BOOTSTRAP',          // set by bootstrap.js for the server it supervises
  'OPSPOINT_BOOTSTRAP_BASE',     // test hooks for bootstrap.js
  'OPSPOINT_BOOTSTRAP_ENTRY',
  'OPSPOINT_BOOTSTRAP_DATA',
  'OPSPOINT_RELEASE_KEY',        // scripts/release.mjs (build machine only)
  'OPSPOINT_RELEASE_KEY_FILE',
];

const BY_NAME = Object.fromEntries(SETTINGS.map((s) => [s.name, s]));

module.exports = { PROFILES, PROFILE_NAMES, MANAGED, SETTINGS, BY_NAME, INTERNAL_ENV };
