// Secrets (roadmap phase 5): where every secret comes from — the environment,
// a NAME_FILE (a Docker secret), the settings file on premises, or the
// provider's secret store — and the rule that a cloud profile reads none from
// disk. The stores run against fake servers that check what each service would
// (an identity token, a Signature V4, a bearer token); the child process
// loadSecrets() starts is run for real, against a fake Key Vault in a process
// of its own. Nothing here touches a real database, a real store, this
// machine's settings file or its data folder.
'use strict';
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const settingsMod = require('../server/settings');
const { createSettings, loadSecrets, secretName } = settingsMod;
const { STORE_NAMES, BY_NAME, SETTINGS } = require('../server/settings/schema');
const store = require('../server/secrets/store');
const secrets = require('../server/secrets');
const { signV4 } = require('../server/storage/s3');
const webpush = require('../server/lib/webpush');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_secrets_'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const rand = () => crypto.randomBytes(24).toString('hex');
const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');

const BASE = path.join(path.sep, 'srv', 'opspoint');
const CONFIG_FILE = path.join(BASE, 'opspoint.config.json');
const notThere = () => { const e = new Error('no file'); e.code = 'ENOENT'; throw e; };

// A settings instance for a made-up machine: its environment, files and clock
// zone are given; `reads` records every file it opened.
function make({ env = {}, file, files = {}, reads = [], app = 'facility' } = {}) {
  return createSettings({
    app, env: { TZ: 'America/Chicago', ...env }, base: BASE, platform: 'linux',
    readFile: (p) => {
      reads.push(p);
      if (p === CONFIG_FILE && file !== undefined) return JSON.stringify(file);
      if (Object.prototype.hasOwnProperty.call(files, p)) return files[p];
      return notThere();
    },
    statFile: () => ({ mode: 0o100600 }), exists: () => true, processZone: () => 'America/Chicago',
  });
}
const errors = (s) => s.check().filter((p) => p.level === 'error').map((p) => p.message);
const warnings = (s) => s.check().filter((p) => p.level === 'warning').map((p) => p.message);

const PUSH = webpush.generateKeys();
const AZURE_OK = {
  OPSPOINT_PROFILE: 'azure', DATABASE_URL: 'postgresql://u:p@db.example:5432/opspoint', AZURE_STORAGE_ACCOUNT: 'sunrisephotos',
  SESSION_SECRET: rand(), VAPID_PUBLIC_KEY: PUSH.publicKey, VAPID_PRIVATE_KEY: PUSH.privateKey,
};
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

// A throwaway HTTP server in this process: handler(req, body, url) -> { status, headers, body }.
async function fakeServer(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const out = await handler(req, Buffer.concat(chunks), new URL(req.url, 'http://x'));
        res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers || {}) });
        res.end(typeof out.body === 'string' || Buffer.isBuffer(out.body) ? out.body : JSON.stringify(out.body || {}));
      } catch (e) { res.writeHead(500); res.end(String(e.stack || e)); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
async function closedPort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

// ── Secrets in files, and the settings file ─────────────────────────────────
describe('secrets from NAME_FILE and the settings file', () => {
  const at = (p) => path.resolve(p);

  test('NAME_FILE holds a secret on premises: read once, whitespace ignored, named as the source', () => {
    const v = rand(), reads = [];
    const s = make({ env: { SESSION_SECRET_FILE: '/run/secrets/session_secret' }, files: { [at('/run/secrets/session_secret')]: `${v}\n` }, reads });
    expect(s.get('SESSION_SECRET')).toBe(v);
    expect(s.source('SESSION_SECRET')).toBe('SESSION_SECRET_FILE');
    expect(errors(s)).toEqual([]);
    s.get('SESSION_SECRET');
    expect(reads.filter((p) => p === at('/run/secrets/session_secret'))).toHaveLength(1);
  });

  test('an empty or unreadable NAME_FILE, or NAME and NAME_FILE together, stop startup', () => {
    expect(errors(make({ env: { SESSION_SECRET_FILE: '/run/secrets/s' }, files: { [at('/run/secrets/s')]: ' \n' } })))
      .toEqual([`SESSION_SECRET_FILE names ${at('/run/secrets/s')}, which is empty.`]);
    expect(errors(make({ env: { DATABASE_URL_FILE: '/run/secrets/nope' } })))
      .toEqual([`DATABASE_URL_FILE names ${at('/run/secrets/nope')}, which can't be read (ENOENT).`]);
    const both = make({ env: { SESSION_SECRET: rand(), SESSION_SECRET_FILE: '/run/secrets/s' }, files: { [at('/run/secrets/s')]: rand() } });
    expect(errors(both)).toEqual(['SESSION_SECRET and SESSION_SECRET_FILE are both set: keep one.']);
  });

  test('a value from NAME_FILE that does not parse names the variable, never the value', () => {
    const short = 'tooshort';
    const msgs = errors(make({ env: { SESSION_SECRET_FILE: '/run/secrets/s' }, files: { [at('/run/secrets/s')]: short } }));
    expect(msgs).toEqual(['SESSION_SECRET (from the file SESSION_SECRET_FILE names) must be at least 32 characters.']);
    expect(msgs.join(' ')).not.toContain(short);
  });

  test('a cloud profile never opens a NAME_FILE, and says what to set instead', () => {
    const reads = [];
    const s = make({ env: { ...without(AZURE_OK, 'SESSION_SECRET'), SESSION_SECRET_FILE: '/run/secrets/s' }, files: { [at('/run/secrets/s')]: rand() }, reads });
    expect(s.get('SESSION_SECRET')).toBeNull();
    expect(errors(s)).toEqual([
      "Profile azure reads no secret from disk, so SESSION_SECRET_FILE can't be used: set SESSION_SECRET in the App Service or Container App settings or the provider's secret store instead.",
    ]);
    expect(reads).not.toContain(at('/run/secrets/s'));
  });

  test('a cloud profile refuses a secret in the settings file, but not an ordinary setting', () => {
    const s = make({ env: AZURE_OK, file: { SESSION_SECRET: rand(), OPSPOINT_IDLE_MINS: 20 } });
    expect(errors(s)).toEqual([
      "Profile azure keeps no secret on disk, so SESSION_SECRET can't be in opspoint.config.json: move it to the App Service or Container App settings or the provider's secret store.",
    ]);
    expect(s.get('OPSPOINT_IDLE_MINS')).toBe(20);
    expect(errors(make({ env: without(AZURE_OK, 'OPSPOINT_PROFILE'), file: { SESSION_SECRET: rand() } }))).toEqual([]);   // on premises: fine
  });

  test('a cloud profile refuses a Google key file; on premises one is fine', () => {
    expect(errors(make({ env: { ...AZURE_OK, GOOGLE_APPLICATION_CREDENTIALS: '/keys/sa.json' } }))).toEqual([
      "Profile azure reads no secret from disk, so GOOGLE_APPLICATION_CREDENTIALS (a key file) can't be used: remove it, and let the service use its own service account.",
    ]);
    expect(errors(make({ env: { OPSPOINT_STORAGE: 'gcs', GCS_BUCKET: 'photos', GOOGLE_APPLICATION_CREDENTIALS: '/keys/sa.json' } }))).toEqual([]);
  });

  test("a secret's NAME_FILE is not mistaken for a typo; anything else still is", () => {
    const w = warnings(make({ env: { CENTRAL_ADMIN_PW_FILE: '/run/secrets/hq', OPSPOINT_BOGUS_FILE: '/x' } }));
    expect(w.join(' ')).not.toContain('CENTRAL_ADMIN_PW_FILE');
    // (It may also suggest the nearest real setting's name.)
    expect(w.some((m) => m.startsWith("OPSPOINT_BOGUS_FILE isn't a setting OpsPoint knows, so it is ignored"))).toBe(true);
  });
});

// ── The store as a layer ────────────────────────────────────────────────────
describe('the secret store as the top layer', () => {
  const VAULT = { OPSPOINT_SECRETS: 'azure-key-vault', AZURE_KEY_VAULT_URL: 'https://sunrise-kv.vault.azure.net' };

  test('its values win over the environment and are named as their source, never shown', () => {
    const v = rand();
    const s = make({ env: { ...VAULT, SESSION_SECRET: rand() } });
    s.setStore({ kind: 'azure-key-vault', label: 'Azure Key Vault sunrise-kv', values: { SESSION_SECRET: v } });
    expect(s.get('SESSION_SECRET')).toBe(v);
    expect(s.source('SESSION_SECRET')).toBe('Azure Key Vault sunrise-kv');
    expect(s.storeInfo()).toEqual({ kind: 'azure-key-vault', label: 'Azure Key Vault sunrise-kv', loaded: true, failed: false, names: ['SESSION_SECRET'] });
    const d = s.describe();
    expect(d.settings.find((r) => r.name === 'SESSION_SECRET')).toMatchObject({ value: '(set, hidden)', source: 'Azure Key Vault sunrise-kv' });
    expect(JSON.stringify(d)).not.toContain(v);
  });

  test('a missing secret says where it would go in each store', () => {
    const need = (env) => errors(make({ env })).find((m) => m.includes('needs SESSION_SECRET'));
    expect(need({ ...without(AZURE_OK, 'SESSION_SECRET'), ...VAULT, OPSPOINT_SECRETS_PREFIX: 'sunrise-' })).toBe(
      'Profile azure needs SESSION_SECRET, the key that signs sign-in cookies (at least 32 random characters): set it in the App Service or Container App settings, or as the secret sunrise-session-secret in Azure Key Vault.');
    expect(need({ ...without(AZURE_OK, 'SESSION_SECRET', 'AZURE_STORAGE_ACCOUNT'), OPSPOINT_PROFILE: 'aws', S3_BUCKET: 'photos', OPSPOINT_SECRETS: 'aws-secrets-manager', AWS_SECRETS_MANAGER_ID: 'opspoint/prod', AWS_REGION: 'us-west-2' }))
      .toMatch(/: set it in the ECS task definition, or as SESSION_SECRET in the Secrets Manager secret opspoint\/prod\.$/);
    expect(need({ ...without(AZURE_OK, 'SESSION_SECRET', 'AZURE_STORAGE_ACCOUNT'), OPSPOINT_PROFILE: 'gcp', GCS_BUCKET: 'photos', OPSPOINT_SECRETS: 'gcp-secret-manager' }))
      .toMatch(/: set it in the Cloud Run service settings, or as the secret session-secret in Secret Manager\.$/);
    const pair = errors(make({ env: { ...without(AZURE_OK, 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'), ...VAULT } })).find((m) => m.includes('push alert keys'));
    expect(pair).toMatch(/set them in the App Service or Container App settings, or as the secrets vapid-public-key and vapid-private-key in Azure Key Vault, since/);
  });

  test('while the store could not be read, its secrets are not reported missing on top of that', () => {
    const s = make({ env: { ...without(AZURE_OK, 'SESSION_SECRET'), ...VAULT } });
    s.setStore({ kind: 'azure-key-vault', label: 'Azure Key Vault sunrise-kv', failed: true });
    expect(errors(s)).toEqual([]);
    expect(s.storeInfo()).toMatchObject({ loaded: false, failed: true });
  });

  test('what reaches the store is checked: a real Key Vault address, a region, nothing ignored silently', () => {
    for (const url of ['https://sunrise-kv.vault.azure.net', 'https://sunrise-kv.vault.usgovcloudapi.net/', 'http://127.0.0.1:8200']) {
      expect(errors(make({ env: { OPSPOINT_SECRETS: 'azure-key-vault', AZURE_KEY_VAULT_URL: url } }))).toEqual([]);
    }
    for (const url of ['https://evil.example.com', 'http://sunrise-kv.vault.azure.net', 'https://sunrise-kv.vault.azure.net/secrets']) {
      expect(errors(make({ env: { OPSPOINT_SECRETS: 'azure-key-vault', AZURE_KEY_VAULT_URL: url } }))[0]).toMatch(/^AZURE_KEY_VAULT_URL must be a Key Vault's address/);
    }
    expect(errors(make({ env: { OPSPOINT_SECRETS: 'azure-key-vault' } }))).toEqual([
      'OPSPOINT_SECRETS=azure-key-vault needs AZURE_KEY_VAULT_URL, the Key Vault address: set it in opspoint.config.json or the service environment.',
    ]);
    expect(errors(make({ env: { OPSPOINT_SECRETS: 'aws-secrets-manager', AWS_SECRETS_MANAGER_ID: 'opspoint/prod' } }))[0]).toMatch(/^OPSPOINT_SECRETS=aws-secrets-manager needs AWS_REGION/);
    expect(errors(make({ env: { OPSPOINT_SECRETS: 'aws-secrets-manager', AWS_SECRETS_MANAGER_ID: 'arn:aws:secretsmanager:us-west-2:123456789012:secret:opspoint/prod-AbCdEf' } }))).toEqual([]);
    expect(warnings(make({ env: { AZURE_KEY_VAULT_URL: 'https://sunrise-kv.vault.azure.net' } })))
      .toContain('AZURE_KEY_VAULT_URL is set but OPSPOINT_SECRETS is local, so it is ignored.');
    expect(warnings(make({ env: { OPSPOINT_DB_DRIVER: 'pg', DATABASE_URL: 'postgresql://u:p@localhost/db', OPSPOINT_DB_KEY: rand() } })))
      .toContain('OPSPOINT_DB_KEY is set but the database driver is pg, so it is ignored.');
  });

  test('a store holds every secret but the cloud credentials, under a name each service accepts', () => {
    const want = SETTINGS.filter((d) => d.secret && d.group !== 'Cloud credentials').map((d) => d.name).concat('VAPID_PUBLIC_KEY');
    expect([...STORE_NAMES].sort()).toEqual([...new Set(want)].sort());
    for (const n of STORE_NAMES) expect(secretName(n, 'sunrise-')).toMatch(/^[0-9a-z-]{1,127}$/);
    expect(secretName('SESSION_SECRET', 'sunrise-')).toBe('sunrise-session-secret');
    expect(store.namesFor('central')).toEqual(expect.arrayContaining(['CENTRAL_DATABASE_URL', 'CENTRAL_ADMIN_PW']));
    expect(store.namesFor('central')).not.toContain('SESSION_SECRET');
    expect(store.namesFor('facility')).not.toContain('CENTRAL_DATABASE_URL');
    for (const n of STORE_NAMES) expect(BY_NAME[n].group).not.toBe('Cloud credentials');
  });
});

// ── The three stores, against fakes ─────────────────────────────────────────
describe('Azure Key Vault', () => {
  let srv, asked, mode;
  const values = { 'sunrise-session-secret': rand(), 'sunrise-database-url': 'postgresql://u:p@db.example:5432/opspoint' };
  beforeAll(async () => {
    srv = await fakeServer((req, body, u) => {
      if (u.pathname === '/identity') {
        if (req.headers['x-identity-header'] !== 'fake-header' || u.searchParams.get('resource') !== 'https://vault.azure.net') return { status: 400, body: { error: 'bad' } };
        return { status: 200, body: { access_token: 'kv-token', expires_on: String(Math.floor(Date.now() / 1000) + 3600) } };
      }
      const name = decodeURIComponent(u.pathname.replace(/^\/secrets\//, ''));
      asked.push(name);
      if (req.headers.authorization !== 'Bearer kv-token' || u.searchParams.get('api-version') !== '7.4') return { status: 401, body: { error: { code: 'Unauthorized', message: 'no' } } };
      if (mode === 'forbidden') return { status: 403, body: { error: { code: 'Forbidden', message: 'does not have secrets get permission' } } };
      if (mode === 'busy') return { status: 503, body: { error: { code: 'ServiceUnavailable', message: 'try later' } } };
      if (!(name in values)) return { status: 404, body: { error: { code: 'SecretNotFound', message: 'not found' } } };
      return { status: 200, body: { value: values[name], attributes: { enabled: true } } };
    });
  });
  afterAll(() => srv.close());
  beforeEach(() => { asked = []; mode = 'ok'; });
  const vault = () => store.azureKeyVault({ url: srv.base, prefix: 'sunrise-', env: { IDENTITY_ENDPOINT: `${srv.base}/identity`, IDENTITY_HEADER: 'fake-header' } });

  test('reads one secret per setting with the managed identity; one not there is simply absent', async () => {
    const r = await vault().fetch(['SESSION_SECRET', 'DATABASE_URL', 'VAPID_PUBLIC_KEY']);
    expect(r.values).toEqual({ SESSION_SECRET: values['sunrise-session-secret'], DATABASE_URL: values['sunrise-database-url'] });
    expect(asked.sort()).toEqual(['sunrise-database-url', 'sunrise-session-secret', 'sunrise-vapid-public-key']);
    expect(r.label).toBe('Azure Key Vault 127.0.0.1');
  });

  test('no access stops startup with the role to grant; a busy vault is worth another start', async () => {
    mode = 'forbidden';
    const e = await vault().fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e).toBeInstanceOf(store.StoreError);
    expect(e.config).toBe(true);
    expect(e.message).toMatch(/^Azure Key Vault 127\.0\.0\.1 refused sunrise-session-secret \(HTTP 403: Forbidden does not have secrets get permission\): give the app's managed identity the Key Vault Secrets User role/);
    mode = 'busy';
    const b = await vault().fetch(['SESSION_SECRET']).catch((x) => x);
    expect(b.config).toBe(false);
  });

  test('without a managed identity it says what to give the app', async () => {
    const e = await store.azureKeyVault({ url: srv.base, env: {}, token: async () => { throw new Error('no managed identity here: give the app one, with the Key Vault Secrets User role on the vault'); } })
      .fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e.message).toBe("Azure Key Vault 127.0.0.1 can't be read: no managed identity here: give the app one, with the Key Vault Secrets User role on the vault.");
    expect(e.config).toBe(true);
  });
});

describe('AWS Secrets Manager', () => {
  let srv, reply, badSig;
  const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
  beforeAll(async () => {
    srv = await fakeServer((req, body) => {
      // Recompute the signature from what arrived: it covers exactly the headers that were sent.
      const amz = req.headers['x-amz-date'];
      const now = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
      const want = signV4({ method: 'POST', host: req.headers.host, path: '/', payloadHash: sha256hex(body), creds: CREDS, region: 'us-west-2', service: 'secretsmanager', now,
        headers: { 'content-type': req.headers['content-type'], 'x-amz-target': req.headers['x-amz-target'] } }).authorization;
      badSig = req.headers.authorization !== want || !/\/us-west-2\/secretsmanager\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target,/.test(req.headers.authorization);
      if (badSig) return { status: 403, body: { __type: 'InvalidSignatureException', message: 'bad signature' } };
      if (req.headers['x-amz-target'] !== 'secretsmanager.GetSecretValue' || JSON.parse(body).SecretId !== 'opspoint/prod') return { status: 400, body: { __type: 'ValidationException' } };
      return reply();
    });
  });
  afterAll(() => srv.close());
  const sm = () => store.awsSecretsManager({ id: 'opspoint/prod', region: 'us-west-2', credentials: async () => CREDS, endpoint: srv.base });
  const secret = (obj) => () => ({ status: 200, body: { Name: 'opspoint/prod', SecretString: JSON.stringify(obj) } });

  test("reads one signed JSON secret; the other app's keys are left for it", async () => {
    const v = rand();
    reply = secret({ SESSION_SECRET: v, DATABASE_URL: 'postgresql://u:p@db/opspoint', CENTRAL_DATABASE_URL: 'postgresql://u:p@db/opscentral' });
    const r = await sm().fetch(store.namesFor('facility'));
    expect(badSig).toBe(false);
    expect(r).toEqual({ label: 'AWS Secrets Manager opspoint/prod', values: { SESSION_SECRET: v, DATABASE_URL: 'postgresql://u:p@db/opspoint' } });
    expect((await sm().fetch(store.namesFor('central'))).values).toEqual({ CENTRAL_DATABASE_URL: 'postgresql://u:p@db/opscentral' });
  });

  test('a key that is not a setting, or not a secret, stops startup; values never appear', async () => {
    const v = rand();
    reply = secret({ SESION_SECRET: v });
    let e = await sm().fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e.message).toBe("AWS Secrets Manager opspoint/prod holds SESION_SECRET, which isn't a setting OpsPoint knows (did you mean SESSION_SECRET?).");
    reply = secret({ TZ: 'America/Chicago' });
    e = await sm().fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e.message).toBe("AWS Secrets Manager opspoint/prod holds TZ, which isn't a secret: set it with the other settings instead.");
    reply = () => ({ status: 200, body: { SecretString: 'not json' } });
    e = await sm().fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e.message).toMatch(/isn't a JSON object of settings/);
    expect(JSON.stringify(e)).not.toContain(v);
  });

  test('a missing secret or role says what to fix; throttling is worth another start', async () => {
    reply = () => ({ status: 400, body: { __type: 'ResourceNotFoundException', message: "Secrets Manager can't find the specified secret." } });
    let e = await sm().fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e.message).toBe("AWS Secrets Manager opspoint/prod refused the secret (HTTP 400: ResourceNotFoundException Secrets Manager can't find the specified secret.): check AWS_SECRETS_MANAGER_ID and the region.");
    expect(e.config).toBe(true);
    reply = () => ({ status: 400, body: { __type: 'AccessDeniedException', Message: 'not authorized to perform: secretsmanager:GetSecretValue' } });
    e = await sm().fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e.message).toMatch(/: give the task role secretsmanager:GetSecretValue on the secret\.$/);
    reply = () => ({ status: 400, body: { __type: 'ThrottlingException', message: 'Rate exceeded' } });
    e = await sm().fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e.config).toBe(false);
  });

  test('an ARN names its own region, and is shown by its name', () => {
    const s = make({ env: { OPSPOINT_SECRETS: 'aws-secrets-manager', AWS_SECRETS_MANAGER_ID: 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:opspoint/prod-AbCdEf', AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'x'.repeat(40) } });
    expect(store.fromSettings(s).label).toBe('AWS Secrets Manager opspoint/prod-AbCdEf');
  });
});

describe('Google Secret Manager', () => {
  let srv, mode;
  const v = rand();
  beforeAll(async () => {
    srv = await fakeServer((req, body, u) => {
      if (u.pathname === '/computeMetadata/v1/project/project-id') {
        return req.headers['metadata-flavor'] === 'Google' ? { status: 200, body: 'sunrise-prod' } : { status: 403, body: '' };
      }
      if (req.headers.authorization !== 'Bearer g-token') return { status: 401, body: { error: { status: 'UNAUTHENTICATED', message: 'no' } } };
      if (mode === 'forbidden') return { status: 403, body: { error: { status: 'PERMISSION_DENIED', message: "Permission 'secretmanager.versions.access' denied" } } };
      const m = /^\/v1\/projects\/([^/]+)\/secrets\/([^/]+)\/versions\/latest:access$/.exec(u.pathname);
      if (!m || m[1] !== 'sunrise-prod') return { status: 404, body: { error: { status: 'NOT_FOUND' } } };
      if (m[2] !== 'session-secret') return { status: 404, body: { error: { status: 'NOT_FOUND', message: 'Secret not found' } } };
      return { status: 200, body: { name: 'x', payload: { data: Buffer.from(v).toString('base64') } } };
    });
  });
  afterAll(() => srv.close());
  beforeEach(() => { mode = 'ok'; });
  const gsm = (opts = {}) => store.gcpSecretManager({ token: async () => 'g-token', endpoint: srv.base, metadata: srv.base, ...opts });

  test("reads the latest version of each, in the service's own project", async () => {
    const r = await gsm().fetch(['SESSION_SECRET', 'DATABASE_URL']);
    expect(r).toEqual({ label: 'Google Secret Manager (project sunrise-prod)', values: { SESSION_SECRET: v } });
    expect((await gsm({ project: 'sunrise-prod' }).fetch(['SESSION_SECRET'])).values.SESSION_SECRET).toBe(v);
  });

  test('no access says which role to grant', async () => {
    mode = 'forbidden';
    const e = await gsm().fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e.message).toMatch(/refused session-secret \(HTTP 403: PERMISSION_DENIED .*\): give the service's account the Secret Manager Secret Accessor role, and check GCP_PROJECT\.$/);
  });

  test('no project and no metadata server: set GCP_PROJECT', async () => {
    const e = await gsm({ metadata: `http://127.0.0.1:${await closedPort()}` }).fetch(['SESSION_SECRET']).catch((x) => x);
    expect(e.message).toBe("Google Secret Manager can't be read: GCP_PROJECT is unset, and there's no Google metadata server here to ask: set GCP_PROJECT.");
  });
});

// ── loadSecrets(), for real, through its child process ──────────────────────
describe('loadSecrets() through its child process', () => {
  const kids = [];
  afterAll(() => { for (const k of kids) k.kill(); });
  function fakeVault(env) {
    return new Promise((resolve, reject) => {
      const cp = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'fakeKeyVault.cjs')], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
      kids.push(cp);
      let buf = '';
      cp.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) resolve(JSON.parse(buf.slice(0, i)).port); });
      cp.on('error', reject);
    });
  }
  const envFor = (port, vaultPort = port) => ({
    ...process.env, OPSPOINT_CONFIG: 'none', OPSPOINT_PROFILE: 'linux-local', OPSPOINT_SECRETS: 'azure-key-vault',
    AZURE_KEY_VAULT_URL: `http://127.0.0.1:${vaultPort}`, IDENTITY_ENDPOINT: `http://127.0.0.1:${port}/identity`, IDENTITY_HEADER: 'fake-header',
  });

  test('reads Key Vault into the top layer, held in memory only', async () => {
    const v = rand();
    const port = await fakeVault({ FAKE_VAULT_SECRETS: JSON.stringify({ 'session-secret': v, 'vapid-private-key': PUSH.privateKey, 'vapid-public-key': PUSH.publicKey }) });
    const env = envFor(port);
    const s = createSettings({ env });
    const r = loadSecrets(s, { env });
    expect(r).toEqual({ ok: true, kind: 'azure-key-vault', label: 'Azure Key Vault 127.0.0.1', count: 3 });
    expect(s.get('SESSION_SECRET')).toBe(v);
    expect(s.source('VAPID_PRIVATE_KEY')).toBe('Azure Key Vault 127.0.0.1');
    expect(Object.values(process.env)).not.toContain(v);
  });

  test('a vault that refuses stops startup (78); one out of reach exits 1', async () => {
    const port = await fakeVault({ FAKE_VAULT_MODE: 'forbidden' });
    let env = envFor(port);
    let r = loadSecrets(createSettings({ env }), { env });
    expect(r).toMatchObject({ ok: false, exitCode: 78 });
    expect(r.message).toMatch(/^Azure Key Vault 127\.0\.0\.1 refused \S+ \(HTTP 403: Forbidden .*\): give the app's managed identity the Key Vault Secrets User role/);
    env = envFor(port, await closedPort());
    r = loadSecrets(createSettings({ env }), { env });
    expect(r).toMatchObject({ ok: false, exitCode: 1 });
    expect(r.message).toMatch(/^Azure Key Vault 127\.0\.0\.1 can't be read: can't reach 127\.0\.0\.1:\d+/);
  });

  test("a store whose own settings are wrong isn't read: the check says why", () => {
    const env = { ...process.env, OPSPOINT_CONFIG: 'none', OPSPOINT_PROFILE: 'linux-local', OPSPOINT_SECRETS: 'azure-key-vault', AZURE_KEY_VAULT_URL: '' };
    const s = createSettings({ env });
    expect(loadSecrets(s, { env })).toEqual({ ok: true, kind: 'azure-key-vault', skipped: true });
    expect(s.check().filter((p) => p.level === 'error').map((p) => p.setting)).toContain('AZURE_KEY_VAULT_URL');
  });

  test('local: nothing to read', () => {
    const env = { ...process.env, OPSPOINT_CONFIG: 'none', OPSPOINT_SECRETS: 'local' };
    expect(loadSecrets(createSettings({ env }), { env })).toEqual({ ok: true, kind: 'local' });
  });
});

// ── A cloud profile reads no secret from disk ───────────────────────────────
describe('on a cloud profile no secret is read from disk', () => {
  const KEYS = ['OPSPOINT_PROFILE', 'SESSION_SECRET', 'OPSPOINT_DB_KEY', 'OPSPOINT_SECRETS', 'OPSPOINT_SECRET_FILE', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
  const saved = {};
  const dir = path.join(tmp, 'cloud');
  let config;
  beforeAll(() => {
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    fs.mkdirSync(dir, { recursive: true });
    process.env.OPSPOINT_SECRET_FILE = path.join(dir, 'secret.key');     // never the real data folder
    config = require('../server/config');
    process.env.OPSPOINT_PROFILE = 'azure';
  });
  afterAll(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test('the guard refuses to read, write or look for a secret file, and never touches the disk', () => {
    const f = path.join(dir, 'present.key');
    fs.writeFileSync(f, rand());
    fs.writeFileSync(path.join(dir, 'cert.pem'), 'c');
    fs.writeFileSync(path.join(dir, 'key.pem'), 'k');
    const spies = ['readFileSync', 'writeFileSync', 'existsSync'].map((m) => jest.spyOn(fs, m));
    try {
      expect(() => secrets.readFile(f, { what: 'the session key file', setting: 'SESSION_SECRET' })).toThrow(
        "Profile azure reads no secret from disk, so the session key file can't be used: set SESSION_SECRET in the App Service or Container App settings or the provider's secret store instead.");
      expect(secrets.exists(f)).toBe(false);
      expect(() => secrets.writeFile(path.join(dir, 'new.key'), 'x')).toThrow(secrets.SecretOnDiskError);
      expect(secrets.tlsFiles(dir)).toBeNull();
      const touched = spies.flatMap((s) => s.mock.calls).filter((c) => String(c[0]).startsWith(dir));
      expect(touched).toEqual([]);
    } finally { for (const s of spies) s.mockRestore(); }
    expect(fs.existsSync(path.join(dir, 'new.key'))).toBe(false);
  });

  test('the session key, push keys, database key and a Google key file all refuse the disk', async () => {
    expect(() => config.loadSessionSecret()).toThrow(secrets.SecretOnDiskError);
    expect(fs.existsSync(path.join(dir, 'secret.key'))).toBe(false);
    expect(() => webpush.loadKeys(dir, {})).toThrow(/reads no secret from disk, so the push keys file .* can't be used: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY/);
    expect(fs.existsSync(path.join(dir, 'vapid.json'))).toBe(false);
    const dbcrypt = require('../server/db/dbcrypt');
    expect(() => dbcrypt.loadOrCreateKey(path.join(dir, 'opspoint.db'))).toThrow(/so the database key file .* can't be used: set OPSPOINT_DB_KEY/);
    expect(fs.existsSync(path.join(dir, '.dbkey'))).toBe(false);
    const token = require('../server/storage/gcs').googleToken({ keyFile: path.join(dir, 'sa.json') });
    await expect(token()).rejects.toThrow(/so the Google key file GOOGLE_APPLICATION_CREDENTIALS names can't be used/);
  });

  test('with the settings set, none of them needs the disk', () => {
    const v = rand();
    process.env.SESSION_SECRET = v;
    try {
      expect(config.loadSessionSecret()).toBe(v);
      expect(webpush.loadKeys(dir, { VAPID_PUBLIC_KEY: PUSH.publicKey, VAPID_PRIVATE_KEY: PUSH.privateKey })).toMatchObject({ source: 'environment' });
    } finally { delete process.env.SESSION_SECRET; }
  });
});

// ── OPSPOINT_DB_KEY ─────────────────────────────────────────────────────────
describe('OPSPOINT_DB_KEY keeps the SQLite key off the data folder', () => {
  const Database = require('better-sqlite3-multiple-ciphers');
  const dbcrypt = require('../server/db/dbcrypt');
  const KEYS = ['OPSPOINT_DB_KEY', 'OPSPOINT_ENCRYPT', 'OPSPOINT_PROFILE'];
  const saved = {};
  let log;
  beforeAll(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } process.env.OPSPOINT_ENCRYPT = '1'; log = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterAll(() => { log.mockRestore(); for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  afterEach(() => { delete process.env.OPSPOINT_DB_KEY; });

  test('a new database is encrypted with it, no key file is made, and another key cannot open it', () => {
    const dbPath = path.join(tmp, 'k1', 'opspoint.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    process.env.OPSPOINT_DB_KEY = rand();
    const c = dbcrypt.openEncrypted(Database, dbPath);
    c.exec('CREATE TABLE t (x TEXT)');
    c.close();
    expect(fs.existsSync(dbcrypt.keyPathFor(dbPath))).toBe(false);
    expect(dbcrypt.isPlaintextDb(dbPath)).toBe(false);
    dbcrypt.openEncrypted(Database, dbPath).close();
    expect(dbcrypt.currentKey(dbPath)).toMatchObject({ fromSetting: true, source: 'environment' });
    process.env.OPSPOINT_DB_KEY = rand();
    expect(() => dbcrypt.openEncrypted(Database, dbPath)).toThrow(/^Cannot open the database with the key in OPSPOINT_DB_KEY\./);
  });

  test('a key file left beside the database must hold the same key', () => {
    const dbPath = path.join(tmp, 'k2', 'opspoint.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    dbcrypt.openEncrypted(Database, dbPath).close();                   // made with a .dbkey, as installs are today
    const fileKey = fs.readFileSync(dbcrypt.keyPathFor(dbPath), 'utf8').trim();
    process.env.OPSPOINT_DB_KEY = fileKey;
    dbcrypt.openEncrypted(Database, dbPath).close();
    process.env.OPSPOINT_DB_KEY = rand();
    let e;
    try { dbcrypt.openEncrypted(Database, dbPath); } catch (x) { e = x; }
    expect(e.code).toBe('EX_CONFIG');
    expect(e.message).toBe(`OPSPOINT_DB_KEY is not the key in ${dbcrypt.keyPathFor(dbPath)}: keep the one this database was encrypted with, and remove the other.`);
  });
});

// ── The health check's words ────────────────────────────────────────────────
describe('the health check says where the secrets came from', () => {
  const { createDoctor } = require('../server/health');
  const conn = { isPg: false, query: async () => [], query1: async () => null, run: async () => ({}) };
  const config = { BASE: path.join(__dirname, '..'), DATA_DIR: tmp, DB_PATH: path.join(tmp, 'health', 'opspoint.db'), SECRET_FILE: path.join(tmp, 'health', 'secret.key') };

  test('from the store on a cloud profile: named, none from disk, and the database key is off this machine', async () => {
    const s = make({ env: { ...without(AZURE_OK, 'SESSION_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'), OPSPOINT_SECRETS: 'azure-key-vault', AZURE_KEY_VAULT_URL: 'https://sunrise-kv.vault.azure.net' } });
    s.setStore({ kind: 'azure-key-vault', label: 'Azure Key Vault sunrise-kv', values: { SESSION_SECRET: rand(), VAPID_PUBLIC_KEY: PUSH.publicKey, VAPID_PRIVATE_KEY: PUSH.privateKey } });
    const r = await createDoctor({ conn: { ...conn, isPg: true }, settings: s, config, storage: {} }).run({ only: ['secrets', 'certificate'] });
    expect(r.results[0]).toMatchObject({ status: 'pass',
      says: 'Present: session key (Azure Key Vault sunrise-kv), database connection string (environment), push keys (Azure Key Vault sunrise-kv). 3 came from Azure Key Vault sunrise-kv at start. None is read from disk (profile azure).' });
    expect(r.results[1]).toMatchObject({ status: 'skip' });
  });

  test('a SQLite key from the store needs no confirmation', async () => {
    const s = make({ env: { OPSPOINT_SECRETS: 'azure-key-vault', AZURE_KEY_VAULT_URL: 'https://sunrise-kv.vault.azure.net', SESSION_SECRET: rand() } });
    s.setStore({ kind: 'azure-key-vault', label: 'Azure Key Vault sunrise-kv', values: { OPSPOINT_DB_KEY: rand() } });
    const r = await createDoctor({ conn, settings: s, config, storage: {} }).run({ only: ['dbkey', 'secrets'] });
    expect(r.results.map((x) => [x.id, x.status, x.says])).toEqual([
      ['secrets', 'pass', 'Present: session key (environment), database key (Azure Key Vault sunrise-kv). 1 came from Azure Key Vault sunrise-kv at start.'],
      ['dbkey', 'pass', 'Kept in Azure Key Vault sunrise-kv (OPSPOINT_DB_KEY), not on this machine.'],
    ]);
  });
});

// ── Nothing else reads a secret file ────────────────────────────────────────
describe('the code reads secret files only through server/secrets', () => {
  const ROOT = path.join(__dirname, '..');
  function runtimeFiles() {
    const out = ['server.js', 'db.js', 'updater.js', 'bootstrap.js', 'central/server.js', 'central/db.js', 'central/updater.js', 'central/bootstrap.js'];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const r = path.posix.join(rel, e.name);
        if (e.isDirectory()) walk(r);
        else if (/\.(c?js)$/.test(e.name)) out.push(r);
      }
    };
    walk('server');
    return out;
  }
  // Files the guard itself, and the settings module (whose NAME_FILE and
  // settings-file reads refuse a cloud profile on their own, tested above).
  const ALLOWED = ['server/secrets/index.js', 'server/settings/index.js'];
  const MARKERS = /vapid|dbkey|secret_file|secret\.key|key\.pem|keypath|keyfile|google_application_credentials/i;

  test('no read or write of the session key, push keys, database key, HTTPS key or a Google key file elsewhere', () => {
    const found = [];
    for (const rel of runtimeFiles()) {
      if (ALLOWED.includes(rel)) continue;
      const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/\b(readFileSync|readFile|writeFileSync|writeFile)\s*\(/.test(line) || /secrets\.(readFile|writeFile)\(/.test(line)) return;
        const near = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
        if (MARKERS.test(near)) found.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });
});
