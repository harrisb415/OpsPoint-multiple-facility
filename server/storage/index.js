'use strict';
/**
 * server/storage — where files live: today resident photos and UA cup photos.
 *
 * One small interface, four backends, chosen by OPSPOINT_STORAGE:
 *   local       a folder on this machine (OPSPOINT_STORAGE_DIR)
 *   azure-blob  Azure Blob Storage (managed identity, or a connection string)
 *   s3          Amazon S3 or an S3-compatible service (a role, or keys)
 *   gcs         Google Cloud Storage (the service's account, or a key file)
 * The cloud backends speak each service's REST API with Node's own fetch and
 * crypto — no SDK, so an on-premises install downloads nothing extra.
 *
 * Keys are what the database already stores: 'photos/client_12.jpg'.
 *   put(key, bytes, { contentType })   get(key) -> Buffer | null
 *   remove(key)                        list(prefix) -> [key]
 *   probe()                            write, read back, delete a test object
 *   describe()                         where, in words (never a secret)
 */
const crypto = require('crypto');

// One folder word, a slash, one file name: nothing that could climb out of a
// folder or name another bucket's object.
const KEY_RE = /^[a-z]+\/(?!\.+$)[A-Za-z0-9._-]{1,200}$/;
function assertKey(key) {
  if (!KEY_RE.test(String(key))) throw new Error(`storage: not a file name OpsPoint uses: ${key}`);
}

function backendFor(settings) {
  const kind = settings.get('OPSPOINT_STORAGE');
  const prefix = settings.get('OPSPOINT_STORAGE_PREFIX') || '';
  switch (kind) {
    case 'local':
      return require('./local')({ dir: settings.get('OPSPOINT_STORAGE_DIR') });
    case 'azure-blob':
      return require('./azureBlob')({
        connectionString: settings.get('AZURE_STORAGE_CONNECTION_STRING'),
        account: settings.get('AZURE_STORAGE_ACCOUNT'),
        container: settings.get('AZURE_STORAGE_CONTAINER'),
        clientId: settings.get('AZURE_CLIENT_ID'),
        prefix,
      });
    case 's3': {
      const s3 = require('./s3');
      return s3({
        bucket: settings.get('S3_BUCKET'),
        region: settings.get('S3_REGION'),
        endpoint: settings.get('S3_ENDPOINT'),
        pathStyle: settings.get('S3_FORCE_PATH_STYLE'),
        prefix,
        credentials: s3.awsCredentials({
          accessKeyId: settings.get('AWS_ACCESS_KEY_ID'),
          secretAccessKey: settings.get('AWS_SECRET_ACCESS_KEY'),
          sessionToken: settings.get('AWS_SESSION_TOKEN'),
        }),
      });
    }
    case 'gcs':
      return require('./gcs')({
        bucket: settings.get('GCS_BUCKET'),
        endpoint: settings.get('GCS_ENDPOINT'),
        keyFile: settings.get('GOOGLE_APPLICATION_CREDENTIALS'),
        prefix,
      });
    default:
      throw new Error(`storage: unknown backend ${kind}`);
  }
}

function wrap(backend) {
  return {
    kind: backend.kind,
    backend,
    async put(key, bytes, { contentType = 'application/octet-stream' } = {}) { assertKey(key); await backend.put(key, bytes, contentType); },
    async get(key) { assertKey(key); return backend.get(key); },
    async remove(key) { assertKey(key); return backend.remove(key); },
    async list(prefix = '') { return backend.list(prefix); },
    // A test object written, read back and deleted. Resolves with the time it
    // took; throws the backend's own reason.
    async probe() {
      const t0 = Date.now();
      // Beside the photos, so a local install needs no folder it doesn't have.
      const key = `photos/.probe-${process.pid}-${Date.now()}.txt`;
      const data = crypto.randomBytes(32);
      await backend.put(key, data, 'text/plain');
      try {
        const back = await backend.get(key);
        if (!back || !Buffer.from(back).equals(data)) throw new Error('what came back differs from what was written');
      } finally {
        await backend.remove(key).catch(() => {});
      }
      return Date.now() - t0;
    },
    describe() { return backend.describe(); },
  };
}

function createStorage(settings) { return wrap(backendFor(settings)); }

let _current = null;
function storage() { return _current || (_current = createStorage(require('../settings'))); }
// Tests (and the command line) can hand in their own.
function useStorage(s) { _current = s; }

module.exports = { createStorage, storage, useStorage, wrap, assertKey, KEY_RE };
