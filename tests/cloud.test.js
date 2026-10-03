// Cloud templates (packaging/cloud, deployment plan phase 9). What each one
// hands the app passes the app's own startup check for its profile; secrets
// come only from the platform's store; one copy runs, probed on /healthz; the
// RDS CA bundle the aws template names is in the image; and the Azure secrets
// script keeps what the vault already has. Where the validators are installed
// (bicep, cfn-lint, terraform) they run too. Nothing here touches a cloud.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createSettings } = require('../server/settings');

const ROOT = path.join(__dirname, '..');
const CLOUD = path.join(ROOT, 'packaging', 'cloud');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const AZURE = read(CLOUD, 'azure', 'main.bicep');
const AWS = read(CLOUD, 'aws', 'opspoint.yaml');
const GCP = read(CLOUD, 'gcp', 'main.tf');
const DOCKERFILE = read(ROOT, 'packaging', 'docker', 'Dockerfile');
const SECRET_NAMES = ['PGPASSWORD', 'SESSION_SECRET', 'VAPID_SEED'];
const IMAGE = 'ghcr.io/harrisb415/opspoint:latest';

// What each template sets on the container: name -> { from: 'value' | 'secret', expr }.
function azureEnv() {
  const block = /env: \[\n([\s\S]*?)\n\s*\]/.exec(AZURE)[1];
  const out = {};
  for (const m of block.matchAll(/\{ name: '([A-Z0-9_]+)', (value|secretRef): (.+?) \}$/gm)) {
    out[m[1]] = { from: m[2] === 'secretRef' ? 'secret' : 'value', expr: m[3] };
  }
  return out;
}
function awsEnv() {
  const out = {};
  const section = (label) => new RegExp(`\\n {10}${label}:\\n([\\s\\S]*?)\\n {10}[A-Z]`).exec(AWS)[1];
  for (const m of section('Environment').matchAll(/Name: ([A-Z0-9_]+)(?:, |\n\s+)Value: (.+?)(?: \})?$/gm)) out[m[1]] = { from: 'value', expr: m[2] };
  for (const m of section('Secrets').matchAll(/Name: ([A-Z0-9_]+), ValueFrom: (.+?) \}$/gm)) out[m[1]] = { from: 'secret', expr: m[2] };
  return out;
}
function gcpEnv() {
  const out = {};
  for (const m of GCP.matchAll(/env \{\n\s+name\s+= "([A-Z0-9_]+)"\n\s+(value_source|value)\s*(?:= (.+))?/g)) {
    out[m[1]] = { from: m[2] === 'value_source' ? 'secret' : 'value', expr: m[3] };
  }
  return out;
}
const ENVS = { azure: azureEnv(), aws: awsEnv(), gcp: gcpEnv() };

// The image's own ENV, under what the template sets.
function imageEnv() {
  const block = /^ENV ([\s\S]*?[^\\])\n/m.exec(DOCKERFILE)[1];
  return Object.fromEntries(block.split(/\\\n/).map((l) => l.trim().split('=')));
}
const WORKDIR = /^WORKDIR (\/\S+)$/gm;
const imageDir = () => [...DOCKERFILE.matchAll(WORKDIR)].pop()[1];

// A value for one setting as the platform would hand it over: a literal as it
// stands, a string with ${…} in it filled in, anything else a sample.
const SAMPLE = {
  TZ: 'America/Chicago',
  VAPID_SUBJECT: 'mailto:ops@sunrise.example',
  AZURE_STORAGE_ACCOUNT: 'stsunrise1a2b3c',
  AZURE_STORAGE_CONTAINER: 'opspoint',
  AZURE_CLIENT_ID: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  S3_BUCKET: 'sunrise-photos-1a2b3c',
  S3_REGION: 'us-west-2',
  AWS_REGION: 'us-west-2',
  GCS_BUCKET: 'sunrise-project-sunrise-photos',
  PGPASSWORD: 'p'.repeat(40),
  SESSION_SECRET: 's'.repeat(64),
  VAPID_SEED: 'v'.repeat(64),
};
function valueOf(name, { from, expr }, profile) {
  if (from === 'secret' || SAMPLE[name] !== undefined) return SAMPLE[name];
  let s = expr.trim();
  if (profile === 'gcp' && /^local\.\w+$/.test(s)) s = new RegExp(`^\\s+${s.slice(6)}\\s+= (.+)$`, 'm').exec(GCP)[1];
  if (profile === 'aws' && !/^[!'"]/.test(s)) return s;          // a plain YAML scalar
  s = s.replace(/^!Sub /, '');
  const q = /^(['"])(.*)\1$/.exec(s);
  if (!q) throw new Error(`${profile} ${name}: no sample for ${expr}`);
  return q[2].replace(/\$\{([^}]+)\}/g, (_, x) => (/port/i.test(x) ? '5432' : 'sample'));
}

describe.each(['azure', 'aws', 'gcp'])('%s', (profile) => {
  const set = ENVS[profile];

  test('names its profile, the facility zone and the platform\'s secret store', () => {
    expect(valueOf('OPSPOINT_PROFILE', set.OPSPOINT_PROFILE, profile)).toBe(profile);
    expect(set.TZ).toBeDefined();
    expect(valueOf('OPSPOINT_SECRETS', set.OPSPOINT_SECRETS, profile)).toBe('local');
    // Every secret comes from the platform's store, never as a plain value; nothing else does.
    const secret = Object.keys(set).filter((k) => set[k].from === 'secret').sort();
    expect(secret).toEqual(SECRET_NAMES);
    expect(valueOf('DATABASE_URL', set.DATABASE_URL, profile)).not.toMatch(/:\/\/[^@/]*:[^@/]*@/);   // no password in it
  });

  test('passes the app\'s own startup check for the profile', () => {
    const env = { ...imageEnv() };
    for (const [k, v] of Object.entries(set)) env[k] = valueOf(k, v, profile);
    const inImage = (p) => p.startsWith(`${imageDir()}/`) && DOCKERFILE.includes(` ${p.slice(imageDir().length + 1)}\n`);
    const s = createSettings({
      app: 'facility', env, base: imageDir(), platform: 'linux',
      readFile: () => { const e = new Error('no file'); e.code = 'ENOENT'; throw e; },
      exists: inImage, processZone: () => env.TZ,                 // TZ sets the container's zone
    });
    expect(s.check()).toEqual([]);
    expect(s.get('OPSPOINT_PROFILE')).toBe(profile);
  });
});

describe('the platform pieces the app counts on', () => {
  test('one copy, always running, probed on /healthz at the image\'s port', () => {
    const port = /^EXPOSE (\d+)$/m.exec(DOCKERFILE)[1];
    expect(AZURE).toMatch(/scale: \{ minReplicas: 1, maxReplicas: 1 \}/);
    expect(AZURE).toMatch(new RegExp(`targetPort: ${port}\\b`));
    for (const p of AZURE.match(/type: '(Startup|Liveness|Readiness)'.*/g)) expect(p).toContain(`httpGet: { path: '/healthz', port: ${port} }`);
    expect(AWS).toMatch(/DesiredCount: 1\n/);
    expect(AWS).toMatch(/MaximumPercent: 100\n/);                  // an update never runs two
    expect(AWS).toMatch(/HealthCheckPath: \/healthz\n/);
    expect(AWS).toMatch(new RegExp(`ContainerPort: ${port}\\b`));
    expect(GCP).toMatch(/min_instance_count = 1\n\s+max_instance_count = 1\n/);
    expect(GCP).toMatch(/cpu_idle\s+= false/);                     // CPU always allocated: the app's timers run
    expect(GCP).toMatch(new RegExp(`container_port = ${port}\\n`));
    expect(GCP.match(/path = "\/healthz"/g)).toHaveLength(2);
  });

  test('every template defaults to the same image, once, which a release pins', () => {
    expect(AZURE).toContain(`param image string = '${IMAGE}'`);
    expect(AWS).toContain(`Default: ${IMAGE}\n`);
    expect(read(CLOUD, 'gcp', 'variables.tf')).toContain(`default     = "${IMAGE}"`);
    // release.yml's cloud job swaps :latest for the version in exactly these three places.
    const files = ['azure/main.bicep', 'azure/database.bicep', 'azure/postgres.bicep', 'azure/secrets.sh', 'aws/opspoint.yaml',
      ...fs.readdirSync(path.join(CLOUD, 'gcp')).filter((f) => f.endsWith('.tf')).map((f) => `gcp/${f}`)];
    const uses = files.flatMap((f) => (read(CLOUD, f).includes(IMAGE) ? [f] : []));
    expect(uses).toEqual(['azure/main.bicep', 'aws/opspoint.yaml', 'gcp/variables.tf']);
    for (const f of uses) expect(read(CLOUD, f).split(IMAGE)).toHaveLength(2);
    const job = read(ROOT, '.github', 'workflows', 'release.yml');
    expect(job).toContain('sed -i "s|$img:latest|$img:$V|"');
    expect(job).toContain('img=ghcr.io/harrisb415/opspoint\n');
  });

  test('the Amazon RDS CA bundle is in the image, and is only certificates', () => {
    const pem = read(CLOUD, 'aws', 'rds-global-bundle.pem');
    const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    expect(certs.length).toBeGreaterThan(10);
    expect(pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, '').trim()).toBe('');
    for (const c of certs) expect(new crypto.X509Certificate(c).ca).toBe(true);
    expect(DOCKERFILE).toMatch(/^COPY packaging\/cloud\/aws\/rds-global-bundle\.pem certs\/rds-global-bundle\.pem$/m);
    // .dockerignore keeps every other .pem out: the bundle is the one exception, after the rule.
    const ignore = read(ROOT, '.dockerignore').split(/\r?\n/);
    expect(ignore.filter((l) => /^!.*\.pem$/.test(l))).toEqual(['!packaging/cloud/aws/rds-global-bundle.pem']);
    expect(ignore.indexOf('!packaging/cloud/aws/rds-global-bundle.pem')).toBeGreaterThan(ignore.indexOf('**/*.pem'));
    expect(AWS).toContain(`PGSSLROOTCERT, Value: ${imageDir()}/certs/rds-global-bundle.pem }`);
  });

  test('the Cloud SQL connection is a socket, so it may skip TLS', () => {
    expect(valueOf('PGSSLMODE', ENVS.gcp.PGSSLMODE, 'gcp')).toBe('disable');
    expect(valueOf('DATABASE_URL', ENVS.gcp.DATABASE_URL, 'gcp')).toMatch(/^postgresql:\/\/opspoint@localhost\/opspoint\?host=\/cloudsql\//);
    expect(GCP).toMatch(/mount_path = "\/cloudsql"/);
    expect(valueOf('PGSSLMODE', ENVS.aws.PGSSLMODE, 'aws')).toBe('verify-full');
    expect(ENVS.azure.PGSSLMODE).toBeUndefined();                  // verify-full, the default
  });

  test('Azure reads the database password from the vault only once the script has filled it', () => {
    // A reference Azure can resolve before the deployment starts stopped the first real one: the
    // vault didn't exist yet (KeyVaultParameterReferenceNotFound).
    expect(AZURE).not.toMatch(/getSecret\(/);
    expect(AZURE).toMatch(/\n\s+enabledForTemplateDeployment: true\n/);   // else Forbidden to ARM
    expect(AZURE).toMatch(/module db 'database\.bicep' = \{\n\s+name: .+\n\s+params: \{\n\s+vaultName: secrets\.properties\.outputs\.vault\n/);
    const wrapper = read(CLOUD, 'azure', 'database.bicep');
    expect(wrapper).toMatch(/resource vault 'Microsoft\.KeyVault\/vaults@[\d-]+' existing = \{\n\s+name: vaultName\n/);
    expect(wrapper).toContain("adminPassword: vault.getSecret('postgres-password')");
  });

  test('Azure\'s database has a delete lock, as AWS\'s and Google\'s have their protection', () => {
    const pg = read(CLOUD, 'azure', 'postgres.bicep');
    expect(pg).toMatch(/resource keep 'Microsoft\.Authorization\/locks@[\d-]+' = \{\n\s+scope: server\n\s+name: 'opspoint-keep-database'\n/);
    expect(pg).toMatch(/level: 'CanNotDelete'\n/);                // changes still deploy; only deleting stops
  });

  test('Google Cloud comes down when asked: only the database is protected, by one variable', () => {
    expect(GCP).toMatch(/\n\s+deletion_protection\s+= var\.deletion_protection\n/);
    expect(GCP).toMatch(/\n\s+deletion_protection_enabled\s+= var\.deletion_protection\n/);
    expect(read(CLOUD, 'gcp', 'variables.tf')).toMatch(/variable "deletion_protection" \{[^}]*default\s+= true/);
    // The provider protects a Cloud Run service by default, which stopped a real destroy at the app.
    expect(GCP).toMatch(/resource "google_cloud_run_v2_service" "app" \{[^{]*deletion_protection\s+= false/);
    // Left to the instance's deletion: Cloud SQL refused both while connections and owned tables remained.
    for (const r of ['google_sql_database', 'google_sql_user']) {
      expect(GCP).toMatch(new RegExp(`resource "${r}" "opspoint" \\{[^}]*deletion_policy\\s+= "ABANDON"`));
    }
  });

  test('AWS\'s photos bucket lets old versions go, and then their delete markers', () => {
    // S3 keeps a delete marker for good unless told; the real deployment's had hundreds in an hour.
    expect(AWS).toMatch(/Rules: \[\{ Id: old-versions, Status: Enabled, NoncurrentVersionExpiration: \{ NoncurrentDays: 30 \}, ExpiredObjectDeleteMarker: true \}\]/);
  });
});

// secrets.sh against a stand-in `az` that keeps its vault in a folder.
const bashOk = process.platform !== 'win32' && spawnSync('bash', ['-c', 'true']).status === 0;
(bashOk ? describe : describe.skip)('the Azure secrets script', () => {
  const SCRIPT = path.join(CLOUD, 'azure', 'secrets.sh');
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsazsec-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.mkdirSync(path.join(dir, 'vault'));
    // Dispatches on the subcommand: az keyvault secret <list|show|set> …
    fs.writeFileSync(path.join(dir, 'bin', 'az'), `#!/bin/bash
sub="$3"; name=""; value=""
while [ $# -gt 0 ]; do case "$1" in --name) name=$2; shift ;; --value) value=$2; shift ;; esac; shift; done
f="${path.join(dir, 'vault')}/$name"
case "$sub" in
  list) exit 0 ;;
  show)
    [ -n "$AZ_FAIL" ] && { echo "(Forbidden) Caller is not authorized to perform action on resource." >&2; exit 1; }
    [ -f "$f" ] && { echo "https://v.vault.azure.net/secrets/$name/1"; exit 0; }
    echo "(SecretNotFound) A secret with (name/id) $name was not found in this key vault." >&2; exit 3 ;;
  set) printf '%s' "$value" > "$f" ;;
esac
`, { mode: 0o755 });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (extra = {}) => spawnSync('bash', [SCRIPT], {
    env: { PATH: `${path.join(dir, 'bin')}:/usr/bin:/bin`, VAULT: 'kv-sunrise-1a2b3c', ...extra }, encoding: 'utf8',
  });
  const vault = () => Object.fromEntries(fs.readdirSync(path.join(dir, 'vault')).map((n) => [n, read(dir, 'vault', n)]));

  test('makes each secret once and keeps it after that', () => {
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout).toBe('session-secret: made\nvapid-seed: made\npostgres-password: made\n');
    const made = vault();
    expect(Object.keys(made).sort()).toEqual(['postgres-password', 'session-secret', 'vapid-seed']);
    for (const v of Object.values(made)) {
      expect(v).toMatch(/^[A-Za-z0-9]{40,}$/);
      expect(v).toMatch(/[A-Z]/); expect(v).toMatch(/[a-z]/); expect(v).toMatch(/[0-9]/);   // Azure's password rule
    }
    expect(new Set(Object.values(made)).size).toBe(3);
    const again = run();
    expect(again.status).toBe(0);
    expect(again.stdout).toBe('session-secret: kept\nvapid-seed: kept\npostgres-password: kept\n');
    expect(vault()).toEqual(made);
  });

  test('hands main.bicep the vault\'s name as its output', () => {
    const out = path.join(dir, 'outputs.json');
    expect(run({ AZ_SCRIPTS_OUTPUT_PATH: out }).status).toBe(0);
    expect(JSON.parse(read(out))).toEqual({ vault: 'kv-sunrise-1a2b3c' });
  });

  test('stops, writing nothing, when it can\'t tell whether a secret is there', () => {
    const r = run({ AZ_FAIL: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Can't tell whether session-secret is in kv-sunrise-1a2b3c/);
    expect(vault()).toEqual({});
  });
});

// The validators, where installed (~/.local/bin on the dev box). CI has none.
function tool(name) {
  for (const d of [...(process.env.PATH || '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin')]) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const BICEP = tool('bicep'), CFN_LINT = tool('cfn-lint'), TERRAFORM = tool('terraform');
const runTool = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120000 });

(BICEP ? test : test.skip)('bicep: builds, lints clean, and carries the secrets script', () => {
  const r = runTool(BICEP, ['build', 'main.bicep', '--stdout'], path.join(CLOUD, 'azure'));
  expect(r.stderr).toBe('');
  const arm = JSON.parse(r.stdout);
  const script = Object.values(arm.resources).find((x) => x.type === 'Microsoft.Resources/deploymentScripts');
  const ref = /^\[variables\('(.+)'\)\]$/.exec(script.properties.scriptContent);   // loadTextContent() lands in a variable
  expect(ref ? arm.variables[ref[1]] : script.properties.scriptContent).toBe(read(CLOUD, 'azure', 'secrets.sh'));
  for (const f of ['main.bicep', 'database.bicep', 'postgres.bicep']) expect(runTool(BICEP, ['lint', f], path.join(CLOUD, 'azure')).stderr).toBe('');
}, 120000);

(CFN_LINT ? test : test.skip)('cfn-lint: no errors or warnings', () => {
  const r = runTool(CFN_LINT, ['opspoint.yaml'], path.join(CLOUD, 'aws'));
  expect(r.stdout + r.stderr).toBe('');
  expect(r.status).toBe(0);
}, 120000);

(TERRAFORM ? test : test.skip)('terraform: formatted, and valid where its providers are installed', () => {
  const dir = path.join(CLOUD, 'gcp');
  expect(runTool(TERRAFORM, ['fmt', '-check', '-diff'], dir).status).toBe(0);
  // validate needs the providers `terraform init -backend=false` downloads; it doesn't download here.
  if (fs.existsSync(path.join(dir, '.terraform', 'providers'))) {
    const r = runTool(TERRAFORM, ['validate', '-no-color'], dir);
    expect(r.stdout).toMatch(/The configuration is valid/);
  }
}, 120000);
