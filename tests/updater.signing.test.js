'use strict';
// Exercises the updater's Ed25519 release-signature check.
//
// The positive case is signed at test time with an ephemeral key rather than a
// checked-in fixture. The previous fixture was signed with the release key that
// was rotated in d61967a; the moment the pinned public key changed, that fixture
// became unverifiable and this suite failed on every run thereafter. An
// ephemeral key cannot go stale, so a future rotation will not break these
// tests — only the deliberate pinned-key assertion at the bottom, which is
// where a rotation should show up.
const crypto = require('crypto');
const { verifyManifestSignature, RELEASE_PUBKEY_PEM } = require('../updater');

// The exact bytes updater.js signs over: version, size, lowercased sha256.
const payload = (m) =>
  Buffer.from(`${m.version}\n${m.size || 0}\n${String(m.sha256).toLowerCase()}`, 'utf8');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const TEST_PUBKEY = publicKey.export({ type: 'spki', format: 'pem' });
const sign = (m, key = privateKey) => crypto.sign(null, payload(m), key).toString('base64');

const BASE = { version: '9.9.9', size: 12345, sha256: 'a'.repeat(64) };
const GOOD = { ...BASE, signature: sign(BASE) };

const verify = (m) => verifyManifestSignature(m, TEST_PUBKEY);

describe('updater release-signature verification', () => {
  test('accepts a manifest signed by the trusted key', () => {
    expect(verify(GOOD)).toBe(true);
  });

  test('rejects an unsigned manifest', () => {
    const { signature, ...unsigned } = GOOD;
    expect(verify(unsigned)).toBe(false);
  });

  test('rejects a garbage signature', () => {
    expect(verify({ ...GOOD, signature: 'Zm9v' })).toBe(false);
  });

  test('rejects a malformed public key without throwing', () => {
    expect(verifyManifestSignature(GOOD, 'not a pem')).toBe(false);
  });

  test.each([
    ['version', '9.9.10'],
    ['sha256', 'b'.repeat(64)],
    ['size', 99999],
  ])('rejects a tampered %s', (key, val) => {
    expect(verify({ ...GOOD, [key]: val })).toBe(false);
  });

  test('rejects a signature made with a different key', () => {
    const other = crypto.generateKeyPairSync('ed25519').privateKey;
    expect(verify({ ...BASE, signature: sign(BASE, other) })).toBe(false);
  });

  // The payload lowercases sha256, so a manifest quoting it in uppercase still
  // verifies against a signature made over the lowercase form.
  test('normalises sha256 case', () => {
    expect(verify({ ...GOOD, sha256: 'A'.repeat(64) })).toBe(true);
  });
});

describe('pinned release key', () => {
  // Guards the default. This shows the default is not the ephemeral test key —
  // it cannot show the default IS the pinned key, since proving that would need
  // a manifest signed by the pinned key's private half. The fingerprint test
  // below covers the other side of it.
  test('is not the ephemeral key the tests above sign with', () => {
    expect(verifyManifestSignature(GOOD)).toBe(false);
    expect(verifyManifestSignature(GOOD, RELEASE_PUBKEY_PEM)).toBe(false);
  });

  test('is a well-formed Ed25519 public key', () => {
    const k = crypto.createPublicKey(RELEASE_PUBKEY_PEM);
    expect(k.asymmetricKeyType).toBe('ed25519');
  });

  // Rotating the release key is deliberate and rare. If this fails, the key was
  // changed — update the expected value here in the same commit, and make sure
  // the private half is backed up: installs running an older build still pin the
  // previous key and will reject updates signed with the new one.
  test('matches the expected fingerprint', () => {
    const spki = crypto.createPublicKey(RELEASE_PUBKEY_PEM)
      .export({ type: 'spki', format: 'der' }).toString('base64');
    expect(spki).toBe('MCowBQYDK2VwAyEAX0QuuIYyg9EvdxNF0BsNdA6KCbk+wu1u2Ec2m72YXlE=');
  });
});
