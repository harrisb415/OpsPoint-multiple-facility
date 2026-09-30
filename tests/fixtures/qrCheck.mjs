// Checks client/src/utils/qr.js the way a QR reader would, independently of
// how the encoder draws: the standard's published values (a Reed–Solomon
// example, the format and version words), the fixed patterns where the
// standard puts them, and every test string read back out of its symbol —
// format word, unmasking, the module order, de-interleaving, a zero
// Reed–Solomon syndrome for every block, then the bytes. Run by
// tests/qr.test.js in a child process (the client is an ES module).
// Prints one line of JSON: { failures: [...] }.
import { qrMatrix, rsDivisor, rsRemainder, formatBits, versionBits, _internal } from '../../client/src/utils/qr.js'

const failures = []
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`) }

// ── The standard's published values ─────────────────────────────────────────
// "HELLO WORLD" as 1-M: its 16 data codewords and their 10 error correction
// codewords (the worked example in the standard's tutorials).
eq(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], rsDivisor(10)),
  [196, 35, 39, 119, 235, 215, 231, 226, 93, 23], 'Reed-Solomon, HELLO WORLD 1-M')
// The format information words (error correction level, mask 0-7), after the 0x5412 mask.
const FORMAT = {
  M: ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'],
  L: ['111011111000100', '111001011110011', '111110110101010', '111100010011101', '110011000101111', '110001100011000', '110110001000001', '110100101110110'],
}
for (let m = 0; m < 8; m++) {
  eq(formatBits(m, 0).toString(2).padStart(15, '0'), FORMAT.M[m], `format word M${m}`)
  eq(formatBits(m, 1).toString(2).padStart(15, '0'), FORMAT.L[m], `format word L${m}`)
}
// The version information words.
eq([7, 8, 9, 10].map(versionBits), [0x07c94, 0x085bc, 0x09a99, 0x0a4d3], 'version words 7-10')
// Level M capacity (data codewords) per version.
eq([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(_internal.dataCodewords), [16, 28, 44, 64, 86, 108, 124, 154, 182, 216], 'data codewords, level M')

// ── A reader ────────────────────────────────────────────────────────────────
const ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }
// Where the standard puts function modules (not data), written out anew.
function functionMap(ver) {
  const size = 17 + 4 * ver
  const f = Array.from({ length: size }, () => new Array(size).fill(false))
  const box = (r0, c0, r1, c1) => { for (let r = Math.max(0, r0); r <= Math.min(size - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(size - 1, c1); c++) f[r][c] = true }
  box(0, 0, 8, 8); box(0, size - 8, 8, size - 1); box(size - 8, 0, size - 1, 8)   // finders, separators, format areas
  box(6, 0, 6, size - 1); box(0, 6, size - 1, 6)                                  // timing
  const a = ALIGN[ver] || []
  for (const r of a) for (const c of a) {
    if ((r === 6 && c === 6) || (r === 6 && c === a[a.length - 1]) || (r === a[a.length - 1] && c === 6)) continue
    box(r - 2, c - 2, r + 2, c + 2)
  }
  if (ver >= 7) { box(0, size - 11, 5, size - 9); box(size - 11, 0, size - 9, 5) }
  return f
}
function readBack(sym, text) {
  const { size, modules: M, version: ver } = sym
  const tag = `"${text.slice(0, 24)}…" v${ver}`
  // The format word, both copies. The standard's layout, as (row, col) of
  // bit 14 (first) down to bit 0: along row 8 from the left edge (skipping the
  // timing column) then up column 8 (skipping the timing row); and the copy
  // up column 8 from the bottom, then along row 8 to the right edge.
  const copy1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
  const copy2 = [[size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]]
  const word = (cells) => cells.map(([r, c]) => (M[r][c] ? 1 : 0)).join('')
  const f1 = word(copy1), f2 = word(copy2)
  const mask = FORMAT.M.indexOf(f1)
  if (mask < 0) { failures.push(`${tag}: format word ${f1} is not a level-M word`); return }
  if (f2 !== f1) failures.push(`${tag}: the two format copies differ (${f1} / ${f2})`)
  if (!M[4 * ver + 9][8]) failures.push(`${tag}: the dark module is light`)
  // Finders: a 7x7 ring pattern at three corners.
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const d = Math.max(Math.abs(r - 3), Math.abs(c - 3))
      if (M[r0 + r][c0 + c] !== (d !== 2)) { failures.push(`${tag}: finder at ${r0},${c0} is wrong at ${r},${c}`); r = 7; break }
    }
  }
  for (let i = 8; i < size - 8; i++) if (M[6][i] !== (i % 2 === 0) || M[i][6] !== (i % 2 === 0)) { failures.push(`${tag}: timing broken at ${i}`); break }
  for (const r of ALIGN[ver] || []) for (const c of ALIGN[ver]) {
    if (r === 6 && c === 6 || r === 6 && c === size - 7 || r === size - 7 && c === 6) continue
    if (!M[r][c] || M[r - 1][c] || !M[r - 2][c]) failures.push(`${tag}: alignment pattern at ${r},${c} is wrong`)
  }
  // Unmask and read the data modules in order.
  const masks = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0]
  const fmap = functionMap(ver)
  const bits = []
  let col = size - 1, up = true
  while (col > 0) {
    if (col === 6) col = 5
    for (let k = 0; k < size; k++) {
      const r = up ? size - 1 - k : k
      for (const c of [col, col - 1]) if (!fmap[r][c]) bits.push(M[r][c] !== masks[mask](r, c) ? 1 : 0)
    }
    col -= 2; up = !up
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  // De-interleave into blocks and check every block's syndrome.
  const nb = _internal.BLOCKS[ver], ecc = _internal.ECC_PER_BLOCK[ver], dataTotal = _internal.dataCodewords(ver)
  const longCount = dataTotal % nb, shortData = Math.floor(dataTotal / nb)
  const lens = Array.from({ length: nb }, (_, i) => shortData + (i >= nb - longCount ? 1 : 0))
  const blocks = lens.map(() => [])
  let p = 0
  for (let i = 0; i < shortData + 1; i++) for (let b = 0; b < nb; b++) if (i < lens[b]) blocks[b].push(bytes[p++])
  for (let i = 0; i < ecc; i++) for (let b = 0; b < nb; b++) blocks[b].push(bytes[p++])
  const div = rsDivisor(ecc)
  blocks.forEach((blk, b) => { if (rsRemainder(blk, div).some((x) => x !== 0)) failures.push(`${tag}: block ${b} fails its Reed-Solomon check`) })
  // The data: byte mode, the count, the bytes.
  const data = blocks.flatMap((blk, b) => blk.slice(0, lens[b]))
  const dbits = data.map((x) => x.toString(2).padStart(8, '0')).join('')
  if (dbits.slice(0, 4) !== '0100') { failures.push(`${tag}: not byte mode`); return }
  const cl = ver <= 9 ? 8 : 16
  const count = parseInt(dbits.slice(4, 4 + cl), 2)
  const out = []
  for (let i = 0; i < count; i++) out.push(parseInt(dbits.slice(4 + cl + i * 8, 12 + cl + i * 8), 2))
  const got = new TextDecoder().decode(new Uint8Array(out))
  if (got !== text) failures.push(`${tag}: read back ${JSON.stringify(got.slice(0, 40))}`)
}

const TEXTS = [
  'A', 'https://opspoint.local/m',
  'https://sunrise.example.org/invite/' + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
  'Résidence Émile — ünïcode ✓ '.repeat(3),
  'x'.repeat(120), 'y'.repeat(180), 'z'.repeat(213),
]
for (const t of TEXTS) {
  for (let m = 0; m < 8; m++) readBack(qrMatrix(t, { mask: m }), t)
  const auto = qrMatrix(t)
  if (auto.mask < 0 || auto.mask > 7) failures.push('no mask chosen')
  readBack(auto, t)
}
const versions = TEXTS.map((t) => qrMatrix(t).version)
// The smallest that holds each: 1, 24, 78, 108 (UTF-8), 120, 180 and 213 bytes.
eq(versions, [1, 2, 5, 7, 7, 9, 10], 'versions chosen')
try { qrMatrix('z'.repeat(214)); failures.push('214 bytes should not fit') } catch (e) { /* right */ }

process.stdout.write(JSON.stringify({ failures }) + '\n')
