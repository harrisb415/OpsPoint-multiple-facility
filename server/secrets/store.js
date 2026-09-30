'use strict';
/**
 * server/secrets/store.js — the provider's secret store, read once at start.
 *
 *   azure-key-vault      one secret per setting, named like the setting in
 *                        lowercase with dashes after OPSPOINT_SECRETS_PREFIX
 *                        (SESSION_SECRET is session-secret), read with the app's
 *                        managed identity (role: Key Vault Secrets User)
 *   aws-secrets-manager  one secret, AWS_SECRETS_MANAGER_ID, whose value is a JSON
 *                        object of settings, read with the task or instance role
 *                        or keys (secretsmanager:GetSecretValue)
 *   gcp-secret-manager   one secret per setting, named as for Key Vault, its latest
 *                        version, read with the service's own account (role:
 *                        Secret Manager Secret Accessor)
 *
 * Only the settings in STORE_NAMES (schema.js) come from a store: the secrets,
 * but not the cloud credentials that reach it. A secret the store doesn't hold
 * is simply absent — the environment, or the profile's required-settings check,
 * decides what happens next. No secret's value ever appears in a message.
 *
 * server/settings loadSecrets() runs this file as a child process, so every
 * reader of a setting can stay synchronous. It prints one line of JSON,
 * { ok: true, label, values } or { ok: false, label, error, config }, where
 * config says whether a person has to fix something (no access, no such
 * vault) or the service was only out of reach (worth another start).
 */
const fs = require('fs');
const { request } = require('../storage/http');
const { STORE_NAMES, BY_NAME } = require('../settings/schema');
const secrets = require('./index');

const TIMEOUT_MS = 10000;

class StoreError extends Error {
  constructor(message, config = true) { super(message); this.name = 'StoreError'; this.config = config; }
}

// The settings this app may take from a store.
function namesFor(app) {
  return STORE_NAMES.filter((n) => ['shared', 'per-app', app].includes(BY_NAME[n].scope));
}

const secretName = (name, prefix) => require('../settings').secretName(name, prefix);
const oneLine = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
function json(buf) { try { return JSON.parse(buf.toString('utf8')); } catch (e) { return null; } }

// The service couldn't be reached, or answered 5xx / throttled: try again later.
const transient = (status) => status >= 500 || status === 429;
function unreachable(label, e) { return new StoreError(`${label} can't be read: ${oneLine(e.message)}.`, false); }
function refused(label, what, status, detail, fix) {
  return new StoreError(`${label} refused ${what} (HTTP ${status}${detail ? `: ${oneLine(detail)}` : ''})${transient(status) ? '' : `: ${fix}`}.`,
    !transient(status));
}
// A credential that couldn't be had: missing is for a person; unreachable, or
// a platform endpoint's 5xx, is worth another try.
function noCredential(label, e) {
  return new StoreError(`${label} can't be read: ${oneLine(e.message)}.`, !(e.code === 'UNREACHABLE' || transient(e.status || 0)));
}

// ── Azure Key Vault ─────────────────────────────────────────────────────────
function azureKeyVault({ url, prefix = '', clientId = null, env = process.env, token = null }) {
  const base = String(url).replace(/\/+$/, '');
  const host = new URL(base).hostname;
  const label = `Azure Key Vault ${/\.vault\./.test(host) ? host.split('.')[0] : host}`;
  const getToken = token || require('../storage/azureBlob').managedIdentity({
    clientId, env, resource: 'https://vault.azure.net',
    missing: 'no managed identity here: give the app one, with the Key Vault Secrets User role on the vault',
  });
  return {
    label,
    async fetch(names) {
      let t;
      try { t = await getToken(); } catch (e) { throw noCredential(label, e); }
      const values = {};
      await Promise.all(names.map(async (name) => {
        const id = secretName(name, prefix);
        let r;
        try { r = await request('GET', `${base}/secrets/${encodeURIComponent(id)}?api-version=7.4`, { headers: { authorization: `Bearer ${t}` }, timeoutMs: TIMEOUT_MS }); }
        catch (e) { throw unreachable(label, e); }
        if (r.status === 404) return;                                  // not kept there
        const j = json(r.body);
        if (r.status !== 200) {
          throw refused(label, id, r.status, j && j.error && `${j.error.code || ''} ${j.error.message || ''}`,
            r.status === 401 || r.status === 403 ? "give the app's managed identity the Key Vault Secrets User role on the vault, and check the secret is enabled" : 'check AZURE_KEY_VAULT_URL');
        }
        if (!j || typeof j.value !== 'string') throw new StoreError(`${label} gave ${id} without a value.`);
        values[name] = j.value;
      }));
      return { label, values };
    },
  };
}

// ── AWS Secrets Manager ─────────────────────────────────────────────────────
function awsSecretsManager({ id, region, credentials, endpoint = null }) {
  const { signV4, sha256hex } = require('../storage/s3');
  const origin = endpoint ? new URL(endpoint).origin : `https://secretsmanager.${region}.amazonaws.com`;
  const host = new URL(origin).host;
  const shown = String(id).replace(/^arn:aws[a-z-]*:secretsmanager:[^:]+:\d+:secret:/, '');
  const label = `AWS Secrets Manager ${shown}`;
  return {
    label,
    async fetch(names) {
      let creds;
      try { creds = await credentials(); } catch (e) { throw noCredential(label, e); }
      const body = JSON.stringify({ SecretId: id });
      const headers = signV4({
        method: 'POST', host, path: '/', payloadHash: sha256hex(body), creds, region, service: 'secretsmanager',
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'secretsmanager.GetSecretValue' },
      });
      delete headers.host;                                             // fetch sets it, to the same value
      let r;
      try { r = await request('POST', `${origin}/`, { headers, body, timeoutMs: TIMEOUT_MS }); }
      catch (e) { throw unreachable(label, e); }
      const j = json(r.body) || {};
      if (r.status !== 200) {
        const type = String(j.__type || '').split('#').pop();
        const fix = {
          ResourceNotFoundException: 'check AWS_SECRETS_MANAGER_ID and the region',
          DecryptionFailure: "give the role kms:Decrypt on the secret's key",
        }[type] || 'give the task role secretsmanager:GetSecretValue on the secret';
        throw refused(label, 'the secret', type === 'ThrottlingException' ? 429 : r.status, `${type} ${j.message || j.Message || ''}`, fix);
      }
      if (typeof j.SecretString !== 'string') throw new StoreError(`${label} holds no text: store the settings as a JSON object, such as {"SESSION_SECRET": "…"}.`);
      let obj = null;
      try { obj = JSON.parse(j.SecretString); } catch (e) { /* below */ }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new StoreError(`${label} isn't a JSON object of settings, such as {"SESSION_SECRET": "…"}.`);
      }
      const values = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!BY_NAME[k]) throw new StoreError(`${label} holds ${k}, which isn't a setting OpsPoint knows${require('../settings').meant(k, STORE_NAMES)}.`);
        if (!STORE_NAMES.includes(k)) throw new StoreError(`${label} holds ${k}, which isn't a secret: set it with the other settings instead.`);
        if (!names.includes(k)) continue;                              // the other app's (HQ's CENTRAL_…)
        if (v === null || typeof v === 'object') throw new StoreError(`${label}: ${k} must be text.`);
        values[k] = String(v);
      }
      return { label, values };
    },
  };
}

// ── Google Secret Manager ───────────────────────────────────────────────────
function gcpSecretManager({ project = null, prefix = '', keyFile = null, token = null, endpoint = null, metadata = 'http://metadata.google.internal' }) {
  const base = (endpoint || 'https://secretmanager.googleapis.com').replace(/\/+$/, '');
  const getToken = token || require('../storage/gcs').googleToken({ keyFile, scope: 'https://www.googleapis.com/auth/cloud-platform' });
  const store = {
    label: project ? `Google Secret Manager (project ${project})` : 'Google Secret Manager',
    async fetch(names) {
      const proj = project || await projectId();
      store.label = `Google Secret Manager (project ${proj})`;
      let t;
      try { t = await getToken(); } catch (e) { throw noCredential(store.label, e); }
      const values = {};
      await Promise.all(names.map(async (name) => {
        const id = secretName(name, prefix);
        let r;
        try {
          r = await request('GET', `${base}/v1/projects/${encodeURIComponent(proj)}/secrets/${encodeURIComponent(id)}/versions/latest:access`,
            { headers: { authorization: `Bearer ${t}` }, timeoutMs: TIMEOUT_MS });
        } catch (e) { throw unreachable(store.label, e); }
        if (r.status === 404) return;                                  // not kept there
        const j = json(r.body);
        if (r.status !== 200) {
          throw refused(store.label, id, r.status, j && j.error && `${j.error.status || ''} ${j.error.message || ''}`,
            r.status === 401 || r.status === 403 ? "give the service's account the Secret Manager Secret Accessor role, and check GCP_PROJECT" : 'check GCP_PROJECT');
        }
        const data = j && j.payload && j.payload.data;
        if (typeof data !== 'string') throw new StoreError(`${store.label} gave ${id} without a value.`);
        values[name] = Buffer.from(data, 'base64').toString('utf8');
      }));
      return { label: store.label, values };
    },
  };
  // GCP_PROJECT, else the key file's project, else the metadata server's.
  async function projectId() {
    if (keyFile) {
      try {
        const k = JSON.parse(secrets.readFile(keyFile, { what: 'the Google key file GOOGLE_APPLICATION_CREDENTIALS names' }));
        if (k.project_id) return k.project_id;
      } catch (e) { if (e.name === 'SecretOnDiskError') throw new StoreError(e.message); }
    }
    let r;
    try { r = await request('GET', `${metadata}/computeMetadata/v1/project/project-id`, { headers: { 'metadata-flavor': 'Google' }, timeoutMs: 3000 }); }
    catch (e) { r = null; }
    if (!r || r.status !== 200) throw new StoreError("Google Secret Manager can't be read: GCP_PROJECT is unset, and there's no Google metadata server here to ask: set GCP_PROJECT.");
    return r.body.toString('utf8').trim();
  }
  return store;
}

// ── The store this app's settings name ─────────────────────────────────────
function fromSettings(s, env = process.env) {
  const kind = s.get('OPSPOINT_SECRETS');
  const prefix = s.get('OPSPOINT_SECRETS_PREFIX') || '';
  switch (kind) {
    case 'azure-key-vault':
      return azureKeyVault({ url: s.get('AZURE_KEY_VAULT_URL'), prefix, clientId: s.get('AZURE_CLIENT_ID'), env });
    case 'aws-secrets-manager': {
      const id = s.get('AWS_SECRETS_MANAGER_ID');
      const m = /^arn:aws[a-z-]*:secretsmanager:([a-z0-9-]+):/.exec(id);
      const { awsCredentials } = require('../storage/s3');
      return awsSecretsManager({
        id, region: m ? m[1] : s.get('AWS_REGION'),
        credentials: awsCredentials({
          accessKeyId: s.get('AWS_ACCESS_KEY_ID'), secretAccessKey: s.get('AWS_SECRET_ACCESS_KEY'), sessionToken: s.get('AWS_SESSION_TOKEN'), env,
        }),
      });
    }
    case 'gcp-secret-manager':
      return gcpSecretManager({ project: s.get('GCP_PROJECT'), prefix, keyFile: s.get('GOOGLE_APPLICATION_CREDENTIALS') });
    default:
      return null;
  }
}

module.exports = { azureKeyVault, awsSecretsManager, gcpSecretManager, fromSettings, namesFor, StoreError };

// ── As a child of loadSecrets() ─────────────────────────────────────────────
if (require.main === module) {
  const i = process.argv.indexOf('--app');
  const app = i === -1 ? 'facility' : process.argv[i + 1];
  const say = (o) => { fs.writeSync(1, JSON.stringify(o) + '\n'); };
  let store = null;
  Promise.resolve().then(() => {
    const s = require('../settings').useApp(app);                     // without a store layer: this is it
    store = fromSettings(s);
    if (!store) return say({ ok: true, label: 'none', values: {} });
    return store.fetch(namesFor(app)).then((r) => say({ ok: true, label: r.label, values: r.values }));
  }).catch((e) => {
    const label = store ? store.label : 'The secret store';
    say({ ok: false, label, error: e instanceof StoreError ? e.message : `${label} can't be read: ${oneLine(e.message)}.`, config: e instanceof StoreError ? e.config : true });
  });
}
