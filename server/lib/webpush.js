'use strict';
/**
 * Web Push on Node's own crypto: message encryption (RFC 8291, aes128gcm) and
 * VAPID sender identification (RFC 8292). No dependency, so the facility box
 * installs nothing new; tests pin the encryption to RFC 8291's worked example.
 *
 * Keys are the base64url pair every push library uses: a 65-byte uncompressed
 * P-256 public key and its 32-byte private scalar. They come from
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, else from DATA_DIR/vapid.json, which is
 * generated once (mode 0600). Changing the pair orphans every subscription a
 * phone has made, so once issued it has to stay put.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64url'),
  dec: (s) => Buffer.from(String(s || ''), 'base64url'),
};

// Push services a subscription may point at. The endpoint comes from the
// browser via the client, so without this any signed-in user could make the
// server POST to an address of their choosing (an internal service, a cloud
// metadata URL). These are the services Chrome/Android, Firefox, Safari/iOS
// and Edge actually hand out.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

function isAllowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some(re => re.test(u.hostname));
  } catch (e) { return false; }
}

function generateKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), b64u.dec(jwk.x), b64u.dec(jwk.y)]);
  return { publicKey: b64u.enc(pub), privateKey: jwk.d };
}

function privateKeyObject(keys) {
  const pub = b64u.dec(keys.publicKey);
  const d = b64u.dec(keys.privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error('VAPID keys are malformed');
  return crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.subarray(1, 33)), y: b64u.enc(pub.subarray(33)), d: keys.privateKey },
  });
}

// { publicKey, privateKey, source } — or throws when a configured pair is
// unusable. Generates and saves a pair on first use when none is configured.
function loadKeys(dataDir, env = process.env) {
  let keys;
  if (env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: String(env.VAPID_PUBLIC_KEY || '').trim(), privateKey: String(env.VAPID_PRIVATE_KEY || '').trim(), source: 'environment' };
  } else {
    const file = path.join(dataDir, 'vapid.json');
    try {
      const k = JSON.parse(fs.readFileSync(file, 'utf8'));
      keys = { publicKey: k.publicKey, privateKey: k.privateKey, source: file };
    } catch (e) {
      keys = { ...generateKeys(), source: file, generated: true };
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }), { mode: 0o600 });
    }
  }
  privateKeyObject(keys);   // throws on a bad pair, so a typo in .env fails at boot, not at first alert
  return keys;
}

/**
 * RFC 8291 message encryption. Returns the complete request body: the aes128gcm
 * header (salt, record size, sender key) followed by one encrypted record.
 * `salt` and `localKey` (the sender's ephemeral private key) are only ever
 * supplied by tests reproducing the RFC's example; otherwise both are fresh.
 */
function encrypt(plaintext, p256dh, auth, { salt, localKey } = {}) {
  const uaPublic = b64u.dec(p256dh);
  const authSecret = b64u.dec(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('subscription p256dh is not an uncompressed P-256 key');
  if (authSecret.length !== 16) throw new Error('subscription auth secret must be 16 bytes');

  const ecdh = crypto.createECDH('prime256v1');
  if (localKey) ecdh.setPrivateKey(b64u.dec(localKey)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const s = salt ? b64u.dec(salt) : crypto.randomBytes(16);

  const hkdf = (ikm, saltBuf, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, saltBuf, info, len));
  const ikm = hkdf(shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(ikm, s, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, s, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 marks the last (here, only) record; no further padding.
  const record = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  s.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, record]);
}

// RFC 8292 VAPID Authorization header value for one push service.
function vapidAuthorization(endpoint, keys, subject, { now = Date.now() } = {}) {
  const header = b64u.enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u.enc(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,   // the spec allows at most 24h
    sub: subject,
  }));
  const input = `${header}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: privateKeyObject(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${input}.${b64u.enc(sig)}, k=${keys.publicKey}`;
}

/**
 * Deliver one message. Resolves { ok, status }; a 404/410 means the browser
 * dropped the subscription and the caller should forget it.
 */
async function send(sub, message, { keys, subject, ttl = 3600, urgency = 'high', topic, fetchImpl = fetch } = {}) {
  if (!isAllowedEndpoint(sub.endpoint)) return { ok: false, status: 0, error: 'endpoint not allowed' };
  const headers = {
    Authorization: vapidAuthorization(sub.endpoint, keys, subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
  };
  if (topic && /^[A-Za-z0-9_-]{1,32}$/.test(topic)) headers.Topic = topic;
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST', headers, body: encrypt(JSON.stringify(message), sub.p256dh, sub.auth),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status };
}

module.exports = { loadKeys, generateKeys, encrypt, vapidAuthorization, send, isAllowedEndpoint, _b64u: b64u };
