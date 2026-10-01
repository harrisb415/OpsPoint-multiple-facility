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
 *             pgurl, trustProxy, host, size, url
 *   default   a value, { facility, central } for per-app, or ctx => value
 *   defaultText  how the docs show a default computed by a function
 *   secret    never printed, logged or returned by any endpoint. It may also
 *             come from a file named by NAME_FILE (a Docker secret) and, unless
 *             it is a cloud credential, from the secret store (STORE_NAMES)
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
  OPSPOINT_BACKUPS:     'provider',  // the platform's point-in-time restore
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
    summary: 'App Service or Container Apps, with Azure Database for PostgreSQL and Blob Storage.',
    kind: 'managed',
    where: 'the App Service or Container App settings',
    defaults: { ...MANAGED_DEFAULTS, OPSPOINT_STORAGE: 'azure-blob' },
  },
  aws: {
    label: 'AWS, managed',
    summary: 'ECS Fargate behind an Application Load Balancer, with RDS or Aurora PostgreSQL and S3.',
    kind: 'managed',
    where: 'the ECS task definition',
    defaults: { ...MANAGED_DEFAULTS, OPSPOINT_STORAGE: 's3' },
  },
  gcp: {
    label: 'Google Cloud, managed',
    summary: 'Cloud Run (at least one instance, CPU always allocated), with Cloud SQL for PostgreSQL and Cloud Storage.',
    kind: 'managed',
    where: 'the Cloud Run service settings',
    defaults: { ...MANAGED_DEFAULTS, OPSPOINT_STORAGE: 'gcs' },
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
    summary: 'The SQLite database file (driver sqlite). Its encryption key is OPSPOINT_DB_KEY, or else the .dbkey ' +
             'file beside it.',
  },
  {
    name: 'OPSPOINT_ENCRYPT', group: 'Database', scope: 'shared', type: 'bool', tokens: { 1: true, 0: false },
    default: true,
    noun: 'whether the SQLite file is encrypted',
    summary: 'Encrypt the SQLite database file: 1 (the default) or 0. With 0 an already encrypted database will ' +
             'not open; decrypt it deliberately instead.',
  },
  {
    name: 'OPSPOINT_DB_KEY', group: 'Database', scope: 'facility', type: 'string', minLength: 32, secret: true,
    noun: 'the SQLite encryption key',
    summary: 'The key the SQLite database is encrypted with, kept away from the data folder (a secret store, or ' +
             'a Docker secret through OPSPOINT_DB_KEY_FILE), so a copy of that folder alone reads as noise. Unset: ' +
             'the .dbkey file beside the database, made on first start. Set it before the first start, or to the ' +
             'contents of the existing .dbkey; OpsPoint refuses to start while the two differ.',
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
    name: 'OPSPOINT_MIGRATE', group: 'Database', scope: 'shared', type: 'enum', values: ['start', 'off'], default: 'start',
    noun: 'when Postgres migrations run',
    summary: 'When the Postgres schema changes in migrations/pg/ are applied: start (by OpsPoint as it starts, one ' +
             'instance at a time) or off (a deploy step runs `node server/cli/opspoint.js migrate` first, and OpsPoint ' +
             'refuses to start while one is missing). SQLite needs neither: the code builds its schema at every start.',
  },
  {
    name: 'PGTZ', group: 'Database', scope: 'shared', type: 'timezone',
    noun: 'the Postgres session time zone',
    summary: 'The Postgres session time zone. Leave it unset so it follows TZ; if set, it must equal TZ.',
  },

  // ── File storage (server/storage) ─────────────────────────────────────────
  {
    name: 'OPSPOINT_STORAGE', group: 'File storage', scope: 'facility', type: 'enum',
    values: ['local', 'azure-blob', 's3', 'gcs'], default: 'local',
    noun: 'where photos are stored',
    summary: 'Where photos (residents, UA cups) are stored: local (a folder on this machine), azure-blob (Azure Blob ' +
             'Storage), s3 (Amazon S3, or an S3-compatible service) or gcs (Google Cloud Storage).',
    onlyIn: {
      profiles: MANAGED, values: ['azure-blob', 's3', 'gcs'], suggest: { azure: 'azure-blob', aws: 's3', gcp: 'gcs' },
      because: 'the platform wipes its disk on every restart or redeploy, and the photos with it',
    },
    ask: { question: 'Where should photos be stored?', example: 'local' },
  },
  {
    name: 'OPSPOINT_STORAGE_DIR', group: 'File storage', scope: 'facility', type: 'path',
    default: (ctx) => path.dirname(ctx.get('OPSPOINT_DB')),
    defaultText: 'the folder the SQLite database is in (the data folder)',
    noun: 'the folder for stored files',
    summary: 'For local storage: the folder whose photos/ subfolder holds the photos.',
  },
  {
    name: 'OPSPOINT_STORAGE_PREFIX', group: 'File storage', scope: 'facility', type: 'string',
    pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*\/?$/,
    patternText: 'a name such as sunrise/ (letters, digits, dot, dash, underscore and /)',
    noun: 'the prefix for stored file names',
    summary: 'For cloud storage: a prefix for every object name, so several facilities can share one bucket or ' +
             'container (for example sunrise/).',
  },
  {
    name: 'AZURE_STORAGE_ACCOUNT', group: 'File storage', scope: 'facility', type: 'string',
    pattern: /^[a-z0-9]{3,24}$/, patternText: '3 to 24 lowercase letters and digits',
    noun: 'the Azure storage account',
    summary: "For azure-blob: the storage account's name, reached with the app's managed identity (which needs the " +
             'Storage Blob Data Contributor role on the account).',
  },
  {
    name: 'AZURE_STORAGE_CONNECTION_STRING', group: 'File storage', scope: 'facility', type: 'string', secret: true,
    noun: 'the Azure storage connection string',
    summary: "For azure-blob without a managed identity: the account's connection string (AccountName and " +
             "AccountKey), or Azurite's when testing.",
  },
  {
    name: 'AZURE_STORAGE_CONTAINER', group: 'File storage', scope: 'facility', type: 'string', default: 'opspoint',
    pattern: /^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/, patternText: '3 to 63 lowercase letters, digits and single hyphens',
    noun: 'the blob container',
    summary: 'For azure-blob: the container that holds the files. It must already exist.',
  },
  {
    name: 'S3_BUCKET', group: 'File storage', scope: 'facility', type: 'string', requiredWhen: ['OPSPOINT_STORAGE', 's3'],
    pattern: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, patternText: 'a bucket name (3 to 63 lowercase letters, digits, dots and hyphens)',
    noun: 'the S3 bucket',
    summary: 'For s3: the bucket that holds the files. It must already exist.',
  },
  {
    name: 'S3_REGION', group: 'File storage', scope: 'facility', type: 'string',
    default: (ctx) => ctx.get('AWS_REGION') || 'us-east-1', defaultText: 'AWS_REGION, else us-east-1',
    pattern: /^[a-z0-9-]{2,32}$/, patternText: 'a region such as us-west-2',
    noun: 'the S3 region',
    summary: "For s3: the bucket's region.",
  },
  {
    name: 'S3_ENDPOINT', group: 'File storage', scope: 'facility', type: 'url',
    noun: 'the S3-compatible endpoint',
    summary: 'For s3 on an S3-compatible service (MinIO, for example): its address, such as http://127.0.0.1:9000. ' +
             'Unset: Amazon S3.',
  },
  {
    name: 'S3_FORCE_PATH_STYLE', group: 'File storage', scope: 'facility', type: 'bool',
    default: (ctx) => !!ctx.get('S3_ENDPOINT'), defaultText: 'yes when S3_ENDPOINT is set',
    noun: 'path-style S3 addresses',
    summary: 'For s3: address objects as endpoint/bucket/name rather than bucket.endpoint/name (most S3-compatible ' +
             'services need this).',
  },
  {
    name: 'GCS_BUCKET', group: 'File storage', scope: 'facility', type: 'string', requiredWhen: ['OPSPOINT_STORAGE', 'gcs'],
    pattern: /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/, patternText: 'a bucket name (lowercase letters, digits, dots, dashes, underscores)',
    noun: 'the Cloud Storage bucket',
    summary: 'For gcs: the bucket that holds the files. It must already exist.',
  },
  {
    name: 'GCS_ENDPOINT', group: 'File storage', scope: 'facility', type: 'url',
    noun: 'the Cloud Storage emulator',
    summary: 'For gcs against an emulator (fake-gcs-server): its address, such as http://127.0.0.1:4443. Unset: ' +
             'Google Cloud Storage.',
  },

  // ── Secrets (server/settings/secretStore.js) ──────────────────────────────
  {
    name: 'OPSPOINT_SECRETS', group: 'Secrets', scope: 'shared', type: 'enum',
    values: ['local', 'azure-key-vault', 'aws-secrets-manager', 'gcp-secret-manager'], default: 'local',
    noun: 'where secrets come from',
    summary: 'Where the secret settings come from: local (the environment, or a file it names as NAME_FILE such as ' +
             'a Docker secret, or on premises opspoint.config.json), or read at start from azure-key-vault, ' +
             'aws-secrets-manager or gcp-secret-manager, which then win over those. Platforms that hand their ' +
             'secret store to the app as environment variables (Key Vault references, ECS task secrets, Cloud Run ' +
             'secrets) work with local. On azure, aws and gcp no secret is ever read from disk.',
  },
  {
    name: 'OPSPOINT_SECRETS_PREFIX', group: 'Secrets', scope: 'shared', type: 'string',
    pattern: /^[a-z0-9][a-z0-9-]*$/, patternText: 'lowercase letters, digits and dashes (for example sunrise-)',
    noun: 'the prefix of secret names',
    summary: 'For azure-key-vault and gcp-secret-manager: a prefix for every secret name, so facilities can share ' +
             'one vault or project (sunrise- makes SESSION_SECRET the secret sunrise-session-secret).',
  },
  {
    name: 'AZURE_KEY_VAULT_URL', group: 'Secrets', scope: 'shared', type: 'url', requiredWhen: ['OPSPOINT_SECRETS', 'azure-key-vault'],
    noun: 'the Key Vault address',
    summary: "For azure-key-vault: the vault's address, such as https://sunrise-kv.vault.azure.net. Each secret " +
             'setting is a secret named after it in lowercase with dashes (SESSION_SECRET is session-secret), read ' +
             "with the app's managed identity (it needs the Key Vault Secrets User role).",
  },
  {
    name: 'AWS_SECRETS_MANAGER_ID', group: 'Secrets', scope: 'shared', type: 'string', requiredWhen: ['OPSPOINT_SECRETS', 'aws-secrets-manager'],
    pattern: /^[A-Za-z0-9/_+=.@:-]{1,2048}$/, patternText: 'a secret name or ARN',
    noun: 'the Secrets Manager secret',
    summary: 'For aws-secrets-manager: the name or ARN of one secret whose value is a JSON object of settings, ' +
             'such as {"DATABASE_URL": "…", "SESSION_SECRET": "…"}, read in AWS_REGION with the task role.',
  },
  {
    name: 'GCP_PROJECT', group: 'Secrets', scope: 'shared', type: 'string',
    pattern: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, patternText: 'a Google Cloud project ID',
    noun: 'the Google Cloud project',
    summary: 'For gcp-secret-manager: the project that holds the secrets. Unset: the project the service runs in ' +
             '(from the metadata server). Secrets are named like azure-key-vault\'s.',
  },

  // ── Cloud credentials (file storage and the secret store) ─────────────────
  {
    name: 'AWS_REGION', group: 'Cloud credentials', scope: 'shared', type: 'string',
    pattern: /^[a-z0-9-]{2,32}$/, patternText: 'a region such as us-west-2',
    noun: 'the AWS region',
    summary: 'The AWS region (ECS sets it). S3_REGION and Secrets Manager follow it.',
  },
  {
    name: 'AWS_ACCESS_KEY_ID', group: 'Cloud credentials', scope: 'shared', type: 'string',
    noun: 'the AWS access key',
    summary: 'Without an ECS task role or EC2 instance role (or on MinIO): the access key, set together with ' +
             'AWS_SECRET_ACCESS_KEY. Unset: the role the platform provides.',
  },
  {
    name: 'AWS_SECRET_ACCESS_KEY', group: 'Cloud credentials', scope: 'shared', type: 'string', secret: true,
    noun: 'the AWS secret key',
    summary: 'The secret that goes with AWS_ACCESS_KEY_ID.',
  },
  {
    name: 'AWS_SESSION_TOKEN', group: 'Cloud credentials', scope: 'shared', type: 'string', secret: true,
    noun: 'the AWS session token',
    summary: 'The session token that goes with temporary AWS keys.',
  },
  {
    name: 'AZURE_CLIENT_ID', group: 'Cloud credentials', scope: 'shared', type: 'string',
    pattern: /^[0-9a-fA-F-]{36}$/, patternText: 'a client ID (a GUID)',
    noun: 'the user-assigned managed identity',
    summary: "With a user-assigned managed identity: that identity's client ID. Unset: the app's system-assigned " +
             'identity.',
  },
  {
    name: 'GOOGLE_APPLICATION_CREDENTIALS', group: 'Cloud credentials', scope: 'shared', type: 'path',
    noun: 'the Google service-account key file',
    summary: "Outside Google Cloud: a service-account key file. Unset: the Cloud Run service's own service account " +
             '(from the metadata server).',
  },

  // ── Backups ───────────────────────────────────────────────────────────────
  {
    name: 'OPSPOINT_BACKUPS', group: 'Backups', scope: 'facility', type: 'enum', values: ['recorded', 'provider'],
    default: 'recorded',
    noun: 'how the health check knows backups happen',
    summary: 'How the health check knows backups happen: recorded (a backup.create entry in the audit log in the ' +
             'last 26 hours, written by the in-app SQLite backup or by an external job such as ' +
             'scripts/opspoint-backup.sh) or provider (the platform\'s point-in-time restore, which OpsPoint cannot ' +
             'see and takes on trust).',
  },
  {
    name: 'OPSPOINT_EXPORT_PASSPHRASE', group: 'Backups', scope: 'facility', type: 'string', minLength: 12, secret: true,
    noun: 'the passphrase exports are encrypted with',
    summary: 'The passphrase `opspoint export` encrypts its file with, and `opspoint import` and `opspoint drill` open ' +
             'it with: at least 12 characters. Unset: they ask for it, or read --passphrase-file. Keep a copy away ' +
             'from the exports — without it an export cannot be read by anyone.',
  },

  // ── Security ──────────────────────────────────────────────────────────────
  {
    name: 'SESSION_SECRET', group: 'Security', scope: 'facility', type: 'string', minLength: 32, secret: true,
    requiredIn: MANAGED,
    noun: 'the key that signs sign-in cookies (at least 32 random characters)',
    summary: 'The key that signs sign-in cookies. Unset: generated once into OPSPOINT_SECRET_FILE (on premises). ' +
             'Managed platforms must set it, because their disk is wiped on restart and everyone would be signed out.',
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
  // and any OPSPOINT_TEST_* (tests/storage.emulators.test.js: where the emulators are)
];

// What the platform itself hands a container so it can reach its storage
// without a key (an ECS task role, an Azure managed identity). OpsPoint reads
// these where they are used (server/storage); nobody sets them by hand.
const PLATFORM_ENV = [
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',   // ECS task role
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'IDENTITY_ENDPOINT',                        // Azure App Service / Container Apps managed identity
  'IDENTITY_HEADER',
];

const BY_NAME = Object.fromEntries(SETTINGS.map((s) => [s.name, s]));

// What the secret store (OPSPOINT_SECRETS) may hold: every secret except the
// cloud credentials that reach the store in the first place, plus the push
// public key, so the pair lives together.
const STORE_NAMES = SETTINGS
  .filter((s) => (s.secret && s.group !== 'Cloud credentials') || (s.pairWith && BY_NAME[s.pairWith].secret))
  .map((s) => s.name);

module.exports = { PROFILES, PROFILE_NAMES, MANAGED, SETTINGS, BY_NAME, INTERNAL_ENV, PLATFORM_ENV, STORE_NAMES };
