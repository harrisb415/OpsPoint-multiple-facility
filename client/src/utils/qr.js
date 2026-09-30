// QR codes for the links people open on a phone: staff invites and the
// mobile app (the setup wizard). Byte mode, error correction level M (15% of
// the code can be damaged), versions 1 to 10: up to 213 bytes, which fits any
// link OpsPoint makes. Written from ISO/IEC 18004 so the app downloads nothing
// extra; tests/qr.test.js checks it against the standard's published values.
//
//   qrMatrix(text) -> { size, modules }   modules[row][col] = true when dark

const MAX_VERSION = 10
// Level M, versions 1–10 (index = version): error correction codewords per
// block, and the number of blocks.
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const FORMAT_M = 0   // the two error-correction-level bits of M in the format word

// Modules left for data and error correction once the function patterns are placed.
function rawDataModules(ver) {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}
const dataCodewords = (ver) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver]

// ── Reed–Solomon over GF(256), polynomial 0x11D ─────────────────────────────
function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}
// The generator polynomial's coefficients, highest power first, leading 1 left out.
export function rsDivisor(degree) {
  const out = new Array(degree).fill(0)
  out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j], root)
      if (j + 1 < out.length) out[j] ^= out[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return out
}
export function rsRemainder(data, divisor) {
  const out = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ out.shift()
    out.push(0)
    divisor.forEach((coef, i) => { out[i] ^= gfMul(coef, factor) })
  }
  return out
}

// ── The format and version words (BCH codes) ────────────────────────────────
export function formatBits(mask, level = FORMAT_M) {
  const data = (level << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}
export function versionBits(ver) {
  let rem = ver
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (ver << 12) | rem
}
const bit = (x, i) => ((x >>> i) & 1) !== 0

// ── Encoding the text into codewords ────────────────────────────────────────
function codewords(bytes, ver) {
  const cap = dataCodewords(ver)
  const bits = []
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0b0100, 4)                                    // byte mode
  put(bytes.length, ver <= 9 ? 8 : 16)              // character count
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, cap * 8 - bits.length))        // terminator
  while (bits.length % 8) bits.push(0)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad)

  // Split into blocks, add each block's error correction, interleave.
  const nBlocks = BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver]
  const raw = Math.floor(rawDataModules(ver) / 8)
  const shortBlocks = nBlocks - (raw % nBlocks)
  const shortLen = Math.floor(raw / nBlocks)        // data + ecc of a short block
  const div = rsDivisor(eccLen)
  const blocks = []
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < shortBlocks) dat.push(0)                // placeholder, skipped below
    blocks.push(dat.concat(ecc))
  }
  const out = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) out.push(b[i]) })
  }
  return out
}

function alignmentPositions(ver, size) {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
  const out = [6]
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

// ── The symbol ──────────────────────────────────────────────────────────────
function build(ver, data, maskChoice) {
  const size = ver * 4 + 17
  const modules = Array.from({ length: size }, () => new Array(size).fill(false))
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, dark) => { modules[y][x] = dark; fixed[y][x] = true }

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }          // timing
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {                             // finders + separators
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
    }
  }
  const al = alignmentPositions(ver, size)
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  const drawFormat = (mask) => {
    const f = formatBits(mask)
    for (let i = 0; i <= 5; i++) set(8, i, bit(f, i))
    set(8, 7, bit(f, 6)); set(8, 8, bit(f, 7)); set(7, 8, bit(f, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(f, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(f, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(f, i))
    set(8, size - 8, true)                                                                       // the dark module
  }
  drawFormat(0)                                                                                  // reserve the areas
  if (ver >= 7) {
    const v = versionBits(ver)
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3)
      set(a, b, bit(v, i)); set(b, a, bit(v, i))
    }
  }

  // The codewords, in the zigzag: two columns at a time from the right,
  // up then down, stepping over the vertical timing column.
  let n = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!fixed[y][x] && n < data.length * 8) { modules[y][x] = bit(data[n >>> 3], 7 - (n & 7)); n++ }
      }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) modules[y][x] = !modules[y][x]
  }
  let best = maskChoice
  if (best == null) {
    let low = Infinity
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m)
      const p = penalty(modules)
      if (p < low) { low = p; best = m }
      applyMask(m)                                                                               // undo
    }
  }
  applyMask(best); drawFormat(best)
  return { size, modules, mask: best }
}

// The standard's four penalty rules; the mask with the lowest score reads best.
function penalty(m) {
  const size = m.length
  let score = 0
  const lines = []
  for (let i = 0; i < size; i++) { lines.push(m[i]); lines.push(m.map((row) => row[i])) }
  for (const line of lines) {
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) { run++; continue }
      if (run >= 5) score += 3 + (run - 5)
      run = 1
    }
    const s = line.map((d) => (d ? '1' : '0')).join('')
    for (let i = s.indexOf('1011101'); i !== -1; i = s.indexOf('1011101', i + 1)) {
      const before = s.slice(Math.max(0, i - 4), i), after = s.slice(i + 7, i + 11)
      if ((i < 4 || before === '0000') || (i + 11 > size || after === '0000')) score += 40
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x]
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
    }
  }
  let dark = 0
  for (const row of m) for (const d of row) if (d) dark++
  const total = size * size
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10
  return score
}

/**
 * The QR code for `text` (UTF-8): { size, modules, version, mask }. Throws for
 * text longer than version 10 holds (213 bytes). `mask` forces a mask pattern
 * (tests); otherwise the one the standard's penalty rules prefer.
 */
export function qrMatrix(text, { mask } = {}) {
  const bytes = Array.from(new TextEncoder().encode(String(text)))
  let ver = 1
  while (ver <= MAX_VERSION && bytes.length > Math.floor((dataCodewords(ver) * 8 - 4 - (ver <= 9 ? 8 : 16)) / 8)) ver++
  if (ver > MAX_VERSION) throw new Error('Too long for a QR code here')
  const { size, modules, mask: used } = build(ver, codewords(bytes, ver), mask)
  return { size, modules, version: ver, mask: used }
}

// For tests: the parts a reader checks.
export const _internal = { dataCodewords, rawDataModules, codewords, alignmentPositions, ECC_PER_BLOCK, BLOCKS }
