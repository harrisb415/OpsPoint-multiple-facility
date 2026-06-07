'use strict';
// Verifies the updater's Ed25519 release-signature check against the PINNED
// public key in updater.js. The fixture below was signed with the matching
// release private key over "9.9.9\n12345\n<64 a's>", so no private key is needed
// at test time (CI-safe). If the pinned key is ever rotated, regenerate FIXTURE
// with: node -e "...sign('9.9.9\n12345\n'+'a'.repeat(64))..."
const { verifyManifestSignature } = require('../updater');

const SHA = 'a'.repeat(64);
const GOOD = {
  version: '9.9.9',
  size: 12345,
  sha256: SHA,
  signature: 'qT44Ua4AtSB9Y6By9+03JZCDlLaSeAij23bETRxAKSMGuWU6KMt6oiH6mgwOW5Zkuj28nFjKuCPdYx5eE4yuDA==',
};

describe('updater release-signature verification', () => {
  test('accepts a valid signature from the pinned key', () => {
    expect(verifyManifestSignature(GOOD)).toBe(true);
  });
  test('rejects an unsigned manifest', () => {
    const { signature, ...unsigned } = GOOD;
    expect(verifyManifestSignature(unsigned)).toBe(false);
  });
  test('rejects a garbage signature', () => {
    expect(verifyManifestSignature({ ...GOOD, signature: 'Zm9v' })).toBe(false);
  });
  test.each([
    ['version', '9.9.10'],
    ['sha256', 'b'.repeat(64)],
    ['size', 99999],
  ])('rejects a tampered %s', (key, val) => {
    expect(verifyManifestSignature({ ...GOOD, [key]: val })).toBe(false);
  });
});
