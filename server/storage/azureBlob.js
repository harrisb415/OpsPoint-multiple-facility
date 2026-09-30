'use strict';
/**
 * Azure Blob Storage over its REST API — no SDK.
 *
 * Two ways in:
 *   a connection string (AccountName + AccountKey, or UseDevelopmentStorage=true
 *     for Azurite): each request is signed with the account key (Shared Key);
 *   the app's managed identity (AZURE_STORAGE_ACCOUNT): a token from the
 *     platform — IDENTITY_ENDPOINT/IDENTITY_HEADER on App Service and Container
 *     Apps, the instance metadata service on a VM — cached until five minutes
 *     before it expires. The identity needs "Storage Blob Data Contributor".
 */
const crypto = require('crypto');
const { request, serviceError } = require('./http');

const VERSION = '2021-08-06';
// Azurite's published development account (not a secret: it is in Microsoft's docs).
const DEV_ACCOUNT = 'devstoreaccount1';
const DEV_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

function parseConnectionString(cs) {
  const parts = {};
  for (const seg of String(cs).split(';')) {
    const i = seg.indexOf('=');
    if (i > 0) parts[seg.slice(0, i).trim().toLowerCase()] = seg.slice(i + 1).trim();
  }
  if (/^true$/i.test(parts.usedevelopmentstorage || '')) {
    return { account: DEV_ACCOUNT, key: DEV_KEY, blobEndpoint: `http://127.0.0.1:10000/${DEV_ACCOUNT}` };
  }
  const account = parts.accountname;
  if (!account || !parts.accountkey) throw new Error('the connection string needs AccountName and AccountKey');
  const protocol = parts.defaultendpointsprotocol || 'https';
  const blobEndpoint = (parts.blobendpoint || `${protocol}://${account}.blob.${parts.endpointsuffix || 'core.windows.net'}`).replace(/\/+$/, '');
  return { account, key: parts.accountkey, blobEndpoint };
}

/**
 * Shared Key signature (Blob service, version 2015-02-21 and later).
 * `path` is the URL path as sent; `query` plain values.
 */
function sharedKey({ account, key, method, path, query = {}, headers }) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v);
  const len = h['content-length'] && h['content-length'] !== '0' ? h['content-length'] : '';
  const canonicalHeaders = Object.keys(h).filter((k) => k.startsWith('x-ms-')).sort()
    .map((k) => `${k}:${h[k].trim().replace(/\s+/g, ' ')}\n`).join('');
  let resource = `/${account}${path}`;
  for (const k of Object.keys(query).map((q) => q.toLowerCase()).sort()) resource += `\n${k}:${query[Object.keys(query).find((q) => q.toLowerCase() === k)]}`;
  const toSign = [method, h['content-encoding'] || '', h['content-language'] || '', len, h['content-md5'] || '',
    h['content-type'] || '', '', h['if-modified-since'] || '', h['if-match'] || '', h['if-none-match'] || '',
    h['if-unmodified-since'] || '', h.range || ''].join('\n') + '\n' + canonicalHeaders + resource;
  const sig = crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(toSign, 'utf8').digest('base64');
  return `SharedKey ${account}:${sig}`;
}

// A token for https://storage.azure.com/ from the platform's managed identity.
function managedIdentity({ clientId = null, env = process.env }) {
  let cached = null;
  return async function token() {
    if (cached && cached.expires - Date.now() > 5 * 60 * 1000) return cached.value;
    const resource = encodeURIComponent('https://storage.azure.com/');
    const cid = clientId ? `&client_id=${encodeURIComponent(clientId)}` : '';
    let r;
    if (env.IDENTITY_ENDPOINT && env.IDENTITY_HEADER) {            // App Service, Container Apps (the platform's variables)
      r = await request('GET', `${env.IDENTITY_ENDPOINT}?resource=${resource}&api-version=2019-08-01${cid}`,
        { headers: { 'x-identity-header': env.IDENTITY_HEADER }, timeoutMs: 5000 });
    } else {                                                          // a VM: the instance metadata service
      try {
        r = await request('GET', `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=${resource}${cid}`,
          { headers: { metadata: 'true' }, timeoutMs: 3000 });
      } catch (e) {
        throw new Error('no managed identity here: set AZURE_STORAGE_CONNECTION_STRING, or give the app a managed identity');
      }
    }
    if (r.status !== 200) throw new Error(`the managed identity gave no token (HTTP ${r.status}: ${r.body.toString('utf8').slice(0, 200)})`);
    const j = JSON.parse(r.body.toString('utf8'));
    const expires = j.expires_on ? Number(j.expires_on) * 1000 : Date.now() + Number(j.expires_in || 3600) * 1000;
    cached = { value: j.access_token, expires };
    return cached.value;
  };
}

module.exports = function azureBlobStorage({ connectionString = null, account = null, container, prefix = '', clientId = null, endpoint: endpointOverride = null, env = process.env }) {
  const conn = connectionString ? parseConnectionString(connectionString) : null;
  const acct = conn ? conn.account : account;
  const endpoint = conn ? conn.blobEndpoint : (endpointOverride || `https://${account}.blob.core.windows.net`);
  const url = new URL(endpoint);
  const basePath = url.pathname.replace(/\/+$/, '');           // '/devstoreaccount1' on Azurite, '' on Azure
  const token = conn ? null : managedIdentity({ clientId, env });
  const blobPath = (key) => `${basePath}/${container}/${(prefix + key).split('/').map(encodeURIComponent).join('/')}`;

  async function call(method, path, { query = {}, body = null, contentType = null, extra = {} } = {}) {
    const headers = { 'x-ms-date': new Date().toUTCString(), 'x-ms-version': VERSION, ...extra };
    if (body) { headers['content-length'] = String(body.length); if (contentType) headers['content-type'] = contentType; }
    headers.authorization = conn
      ? sharedKey({ account: acct, key: conn.key, method, path, query, headers })
      : `Bearer ${await token()}`;
    delete headers['content-length'];                // signed above; fetch sends the same value itself
    const qs = Object.keys(query).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
    return request(method, `${url.protocol}//${url.host}${path}${qs ? '?' + qs : ''}`, { headers, body: body || undefined });
  }

  return {
    kind: 'azure-blob',
    async put(key, bytes, contentType) {
      const r = await call('PUT', blobPath(key), { body: bytes, contentType, extra: { 'x-ms-blob-type': 'BlockBlob' } });
      if (r.status !== 201) throw serviceError('Azure Blob Storage', r);
    },
    async get(key) {
      const r = await call('GET', blobPath(key));
      if (r.status === 404) return null;
      if (r.status !== 200) throw serviceError('Azure Blob Storage', r);
      return r.body;
    },
    async remove(key) {
      const r = await call('DELETE', blobPath(key));
      if (r.status !== 202 && r.status !== 200 && r.status !== 404) throw serviceError('Azure Blob Storage', r);
    },
    async list(pfx = '') {
      const keys = [];
      let marker = '';
      do {
        const query = { comp: 'list', prefix: prefix + pfx, restype: 'container' };
        if (marker) query.marker = marker;
        const r = await call('GET', `${basePath}/${container}`, { query });
        if (r.status !== 200) throw serviceError('Azure Blob Storage', r);
        const xml = r.body.toString('utf8');
        for (const m of xml.matchAll(/<Name>([^<]+)<\/Name>/g)) keys.push(unxml(m[1]).slice(prefix.length));
        marker = unxml((/<NextMarker>([^<]*)<\/NextMarker>/.exec(xml) || [])[1] || '');
      } while (marker);
      return keys.sort();
    },
    describe() { return `the Azure Blob container ${container} in ${acct}${prefix ? ` (under ${prefix})` : ''}`; },
  };
};

function unxml(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }

module.exports.sharedKey = sharedKey;
module.exports.parseConnectionString = parseConnectionString;
