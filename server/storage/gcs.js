'use strict';
/**
 * Google Cloud Storage over its JSON API — no SDK.
 *
 * A token, first that applies:
 *   GOOGLE_APPLICATION_CREDENTIALS: a service-account key file, exchanged for
 *     a token with a signed JWT (RS256);
 *   the metadata server: the Cloud Run service's (or VM's) own account;
 *   none at all against an emulator (GCS_ENDPOINT, fake-gcs-server).
 * Tokens are cached until five minutes before they expire.
 */
const fs = require('fs');
const crypto = require('crypto');
const { request, serviceError } = require('./http');

const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';
const b64u = (b) => Buffer.from(b).toString('base64url');

function googleToken({ keyFile = null, emulator = false }) {
  if (emulator && !keyFile) return async () => null;
  let cached = null;
  return async function token() {
    if (cached && cached.expires - Date.now() > 5 * 60 * 1000) return cached.value;
    let r;
    if (keyFile) {
      const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      if (!key.client_email || !key.private_key) throw new Error(`${keyFile} is not a service-account key file`);
      const aud = key.token_uri || 'https://oauth2.googleapis.com/token';
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }))}`;
      const jwt = `${unsigned}.${b64u(crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key))}`;
      r = await request('POST', aud, {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
        timeoutMs: 10000,
      });
    } else {
      try {
        r = await request('GET', 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
          { headers: { 'metadata-flavor': 'Google' }, timeoutMs: 3000 });
      } catch (e) {
        throw new Error('no Google credentials: set GOOGLE_APPLICATION_CREDENTIALS, or run on Google Cloud with a service account');
      }
    }
    if (r.status !== 200) throw new Error(`Google gave no token (HTTP ${r.status}: ${r.body.toString('utf8').slice(0, 200)})`);
    const j = JSON.parse(r.body.toString('utf8'));
    cached = { value: j.access_token, expires: Date.now() + Number(j.expires_in || 3600) * 1000 };
    return cached.value;
  };
}

module.exports = function gcsStorage({ bucket, prefix = '', endpoint = null, keyFile = null }) {
  const base = (endpoint || 'https://storage.googleapis.com').replace(/\/+$/, '');
  const token = googleToken({ keyFile, emulator: !!endpoint });
  const name = (key) => encodeURIComponent(prefix + key);

  async function call(method, url, { body = null, contentType = null } = {}) {
    const headers = {};
    const t = await token();
    if (t) headers.authorization = `Bearer ${t}`;
    if (contentType) headers['content-type'] = contentType;
    return request(method, url, { headers, body: body || undefined });
  }
  const b = encodeURIComponent(bucket);

  return {
    kind: 'gcs',
    async put(key, bytes, contentType) {
      const r = await call('POST', `${base}/upload/storage/v1/b/${b}/o?uploadType=media&name=${name(key)}`, { body: bytes, contentType });
      if (r.status !== 200) throw serviceError('Cloud Storage', r);
    },
    async get(key) {
      const r = await call('GET', `${base}/storage/v1/b/${b}/o/${name(key)}?alt=media`);
      if (r.status === 404) return null;
      if (r.status !== 200) throw serviceError('Cloud Storage', r);
      return r.body;
    },
    async remove(key) {
      const r = await call('DELETE', `${base}/storage/v1/b/${b}/o/${name(key)}`);
      if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw serviceError('Cloud Storage', r);
    },
    async list(pfx = '') {
      const keys = [];
      let page = '';
      do {
        const r = await call('GET', `${base}/storage/v1/b/${b}/o?prefix=${encodeURIComponent(prefix + pfx)}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
        if (r.status !== 200) throw serviceError('Cloud Storage', r);
        const j = JSON.parse(r.body.toString('utf8'));
        for (const it of j.items || []) keys.push(String(it.name).slice(prefix.length));
        page = j.nextPageToken || '';
      } while (page);
      return keys.sort();
    },
    describe() { return `the Cloud Storage bucket ${bucket}${prefix ? ` (under ${prefix})` : ''}${endpoint ? ` at ${new URL(base).host}` : ''}`; },
  };
};

module.exports.googleToken = googleToken;
