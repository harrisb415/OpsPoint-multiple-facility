// Web Push protocol (server/lib/webpush.js): message encryption pinned to
// RFC 8291's worked example, a full encrypt/decrypt round trip, the VAPID
// signature checked against the public key, the push-service allowlist, and
// key storage.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const webpush = require('../server/lib/webpush');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

// The receiving side of RFC 8291, written independently of encrypt().
function decrypt(body, uaPrivate, uaPublic, auth) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(uaPrivate, 'base64url'));
  const shared = ecdh.computeSecret(asPublic);
  const hk = (ikm, s, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, n));
  const ikm = hk(shared, Buffer.from(auth, 'base64url'),
    Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(uaPublic, 'base64url'), asPublic]), 32);
  const d = crypto.createDecipheriv('aes-128-gcm',
    hk(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    hk(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  let i = plain.length - 1;
  while (i >= 0 && plain[i] === 0) i--;
  return { delimiter: plain[i], text: plain.subarray(0, i).toString(), recordSize: body.readUInt32BE(16) };
}

describe('message encryption (RFC 8291)', () => {
  test('reproduces the RFC 8291 Appendix A example byte for byte', () => {
    const out = webpush.encrypt(
      'When I grow up, I want to be a watermelon',
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      { salt: 'DGv6ra1nlYgDCS1FRnbzlw', localKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' });
    expect(out.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  });

  test('a fresh message decrypts on the receiving side', () => {
    const ua = crypto.createECDH('prime256v1');
    ua.generateKeys();
    const auth = b64u(crypto.randomBytes(16));
    const payload = JSON.stringify({ title: 'OpsPoint', body: 'Wellness check due at 10:00 PM.' });
    const body = webpush.encrypt(payload, b64u(ua.getPublicKey()), auth);
    const r = decrypt(body, b64u(ua.getPrivateKey()), b64u(ua.getPublicKey()), auth);
    expect(r).toEqual({ delimiter: 2, text: payload, recordSize: 4096 });
  });

  test('refuses keys a browser would never send', () => {
    expect(() => webpush.encrypt('x', b64u(crypto.randomBytes(33)), b64u(crypto.randomBytes(16)))).toThrow(/p256dh/);
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
    expect(() => webpush.encrypt('x', b64u(ua.getPublicKey()), b64u(crypto.randomBytes(8)))).toThrow(/auth/);
  });
});

describe('VAPID (RFC 8292)', () => {
  test('the Authorization header is an ES256 JWT that verifies against the public key', () => {
    const keys = webpush.generateKeys();
    const now = Date.UTC(2026, 8, 27, 12, 0, 0);
    const value = webpush.vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', keys, 'https://opspoint.example', { now });
    const m = value.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(m).toBeTruthy();
    expect(m[2]).toBe(keys.publicKey);
    const [h, c, s] = m[1].split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url'))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(Buffer.from(c, 'base64url'))).toEqual({
      aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'https://opspoint.example',
    });
    const pub = Buffer.from(keys.publicKey, 'base64url');
    const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } });
    expect(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });
});

describe('sending', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) };

  test('posts the encrypted body with the push headers', async () => {
    const calls = [];
    const r = await webpush.send(sub, { body: 'hi' }, {
      keys: webpush.generateKeys(), subject: 'mailto:ops@example.com', ttl: 600, topic: 'due',
      fetchImpl: async (url, init) => { calls.push({ url, init }); return { status: 201 }; },
    });
    expect(r).toEqual({ ok: true, status: 201 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(sub.endpoint);
    expect(calls[0].init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '600', Urgency: 'high', Topic: 'due' });
    expect(calls[0].init.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
  });

  test('never contacts an endpoint outside the push services', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return { status: 201 }; };
    const r = await webpush.send({ ...sub, endpoint: 'http://169.254.169.254/latest' }, { body: 'x' }, { keys: webpush.generateKeys(), subject: 's', fetchImpl });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  test.each([
    ['https://fcm.googleapis.com/fcm/send/x', true],
    ['https://web.push.apple.com/QGh3', true],
    ['https://updates.push.services.mozilla.com/wpush/v2/x', true],
    ['https://wns2-by3p.notify.windows.com/w/?token=x', true],
    ['http://fcm.googleapis.com/fcm/send/x', false],
    ['https://fcm.googleapis.com:8443/x', false],
    ['https://fcm.googleapis.com.evil.example/x', false],
    ['https://127.0.0.1/x', false],
    ['https://localhost/x', false],
    ['not a url', false],
  ])('allowlist: %s -> %s', (url, ok) => {
    expect(webpush.isAllowedEndpoint(url)).toBe(ok);
  });
});

describe('keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsvapid-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('generated once into the data directory, then reused', () => {
    const first = webpush.loadKeys(dir, {});
    expect(first.generated).toBe(true);
    expect(Buffer.from(first.publicKey, 'base64url')).toHaveLength(65);
    const again = webpush.loadKeys(dir, {});
    expect(again.generated).toBeUndefined();
    expect(again.publicKey).toBe(first.publicKey);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'vapid.json')).mode & 0o777).toBe(0o600);
  });

  test('the environment wins, and a malformed pair fails at load rather than at the first alert', () => {
    const k = webpush.generateKeys();
    expect(webpush.loadKeys(dir, { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey })).toMatchObject({ ...k, source: 'environment' });
    expect(() => webpush.loadKeys(dir, { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: 'short' })).toThrow(/malformed/);
  });
});
