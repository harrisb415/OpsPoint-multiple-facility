// The QR encoder (client/src/utils/qr.js) that draws the setup wizard's
// invite and phone-app codes. It is an ES module, so tests/fixtures/qrCheck.mjs
// runs the checks in a child process: the standard's published values, the
// fixed patterns, and every test string read back out of its symbol by an
// independent reader (format word, unmasking, module order, de-interleaving,
// a zero Reed-Solomon syndrome per block, the bytes).
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

test('the QR encoder matches the standard and every symbol reads back', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 'qrCheck.mjs')], { encoding: 'utf8', timeout: 60000 });
  expect(r.stderr).toBe('');
  const { failures } = JSON.parse(r.stdout);
  expect(failures).toEqual([]);
});
