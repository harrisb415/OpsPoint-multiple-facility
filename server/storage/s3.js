'use strict';
/**
 * Amazon S3 (or an S3-compatible service such as MinIO) over its REST API,
 * signed with AWS Signature Version 4 — no SDK.
 *
 * Credentials, first that applies:
 *   AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN)
 *   the ECS task role (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI / _FULL_URI, set by ECS)
 *   the EC2 instance role (instance metadata, IMDSv2)
 * Temporary credentials are cached until five minutes before they expire.
 */
const crypto = require('crypto');
const { request, serviceError } = require('./http');

const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();

// RFC 3986 encoding, as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * Sign one request (AWS Signature Version 4). Returns the headers to send,
 * Authorization included. `path` is the already-encoded path; `query` an
 * object of plain values. S3 also wants the payload's hash as a header; other
 * services (Secrets Manager) take it only inside the signature.
 */
function signV4({ method, host, path, query = {}, headers = {}, payloadHash, creds, region, service = 's3', now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  h.host = host;
  h['x-amz-date'] = amzDate;
  if (service === 's3') h['x-amz-content-sha256'] = payloadHash;
  if (creds.sessionToken) h['x-amz-security-token'] = creds.sessionToken;
  const names = Object.keys(h).sort();
  const canonicalHeaders = names.map((n) => `${n}:${h[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&');
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + creds.secretAccessKey, date), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(stringToSign).digest('hex');
  h.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return h;
}

// ── Credentials ─────────────────────────────────────────────────────────────
function awsCredentials({ accessKeyId, secretAccessKey, sessionToken, env = process.env }) {
  if (accessKeyId && secretAccessKey) {
    const fixed = { accessKeyId, secretAccessKey, sessionToken: sessionToken || null, source: 'AWS_ACCESS_KEY_ID' };
    return async () => fixed;
  }
  let cached = null;
  return async function get() {
    if (cached && cached.expires - Date.now() > 5 * 60 * 1000) return cached;
    // ECS task role — these two variables are the platform's, not settings.
    const rel = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, full = env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
    if (rel || full) {
      const url = rel ? `http://169.254.170.2${rel}` : full;
      const headers = env.AWS_CONTAINER_AUTHORIZATION_TOKEN ? { authorization: env.AWS_CONTAINER_AUTHORIZATION_TOKEN } : {};
      const r = await request('GET', url, { headers, timeoutMs: 5000 });
      if (r.status !== 200) throw new Error(`the ECS task role gave no credentials (HTTP ${r.status})`);
      cached = fromJson(JSON.parse(r.body.toString('utf8')), 'the ECS task role');
      return cached;
    }
    // EC2 instance role, IMDSv2 (a session token first, then the role's keys).
    const base = 'http://169.254.169.254/latest';
    let token;
    try {
      const t = await request('PUT', `${base}/api/token`, { headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '21600' }, timeoutMs: 2000 });
      if (t.status !== 200) throw new Error(`HTTP ${t.status}`);
      token = t.body.toString('utf8');
    } catch (e) {
      throw new Error('no AWS credentials: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or run with an ECS task role or an EC2 instance role');
    }
    const hdr = { 'x-aws-ec2-metadata-token': token };
    const role = (await request('GET', `${base}/meta-data/iam/security-credentials/`, { headers: hdr, timeoutMs: 2000 })).body.toString('utf8').split('\n')[0].trim();
    if (!role) throw new Error('this EC2 instance has no instance role');
    const r = await request('GET', `${base}/meta-data/iam/security-credentials/${encodeURIComponent(role)}`, { headers: hdr, timeoutMs: 2000 });
    cached = fromJson(JSON.parse(r.body.toString('utf8')), `the EC2 instance role ${role}`);
    return cached;
  };
}
function fromJson(j, source) {
  if (!j.AccessKeyId || !j.SecretAccessKey) throw new Error(`${source} gave no usable credentials`);
  return { accessKeyId: j.AccessKeyId, secretAccessKey: j.SecretAccessKey, sessionToken: j.Token || null,
    expires: j.Expiration ? Date.parse(j.Expiration) : Date.now() + 3600 * 1000, source };
}

// ── The backend ─────────────────────────────────────────────────────────────
module.exports = function s3Storage({ bucket, region, endpoint = null, pathStyle = false, prefix = '', credentials }) {
  // Where an object lives: https://bucket.s3.region.amazonaws.com/key, or
  // endpoint/bucket/key for path-style (MinIO and most compatibles).
  const base = endpoint ? new URL(endpoint) : new URL(`https://s3.${region}.amazonaws.com`);
  const host = pathStyle ? base.host : `${bucket}.${base.host}`;
  const origin = `${base.protocol}//${host}`;
  const bucketPath = pathStyle ? `/${enc(bucket)}` : '';
  const objectPath = (key) => `${bucketPath}/${(prefix + key).split('/').map(enc).join('/')}`;

  async function call(method, path, { query = {}, body = null, contentType = null } = {}) {
    const creds = await credentials();
    const payload = body || Buffer.alloc(0);
    const headers = contentType ? { 'content-type': contentType } : {};
    const signed = signV4({ method, host, path, query, headers, payloadHash: sha256hex(payload), creds, region });
    delete signed.host;                           // fetch sets Host itself, to the same value
    const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&');
    return request(method, `${origin}${path}${qs ? '?' + qs : ''}`, { headers: signed, body: body || undefined });
  }

  return {
    kind: 's3',
    async put(key, bytes, contentType) {
      const r = await call('PUT', objectPath(key), { body: bytes, contentType });
      if (r.status !== 200) throw serviceError('S3', r);
    },
    async get(key) {
      const r = await call('GET', objectPath(key));
      if (r.status === 404) return null;
      if (r.status !== 200) throw serviceError('S3', r);
      return r.body;
    },
    async remove(key) {
      const r = await call('DELETE', objectPath(key));
      if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw serviceError('S3', r);
    },
    async list(pfx = '') {
      const keys = [];
      let token = null;
      do {
        const query = { 'list-type': '2', prefix: prefix + pfx };
        if (token) query['continuation-token'] = token;
        const r = await call('GET', bucketPath || '/', { query });
        if (r.status !== 200) throw serviceError('S3', r);
        const xml = r.body.toString('utf8');
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(unxml(m[1]).slice(prefix.length));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unxml((/<NextContinuationToken>([^<]+)</.exec(xml) || [])[1] || '') : null;
      } while (token);
      return keys.sort();
    },
    describe() { return `the S3 bucket ${bucket}${prefix ? ` (under ${prefix})` : ''}${endpoint ? ` at ${base.host}` : ` in ${region}`}`; },
  };
};

function unxml(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }

module.exports.signV4 = signV4;
module.exports.awsCredentials = awsCredentials;
module.exports.sha256hex = sha256hex;
