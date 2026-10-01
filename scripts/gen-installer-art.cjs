#!/usr/bin/env node
'use strict';
/**
 * The Windows installer's pictures, made from the OpsPoint icon
 * (static/icons/icon-1024.png: a navy disc, a silver ring, an open door lit
 * gold) on the installer's navy — no image tools, Node's zlib only:
 *
 *   packaging/windows/art/wizard.bmp, wizard-200.bmp   the side picture (164×314 and 2×)
 *   packaging/windows/art/header.bmp, header-200.bmp   the corner picture (55×58 and 2×)
 *   packaging/windows/art/opspoint.ico                 16, 32, 48 and 256 px
 *
 *   node scripts/gen-installer-art.cjs           write them
 *   node scripts/gen-installer-art.cjs --check   exit 1 if a committed one differs
 * The output is deterministic, so tests/packaging.test.js can run --check.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'static', 'icons', 'icon-1024.png');
const OUT = path.join(ROOT, 'packaging', 'windows', 'art');
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'packaging', 'brand.json'), 'utf8'));
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const NAVY = rgbOf(brand.palette.navy.hex);
const GOLD = rgbOf(brand.palette.gold.hex);

// ── PNG: 8-bit RGBA (or RGB), not interlaced — what the icon is ──────────────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; color = d[9]; interlace = d[12]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 6 && color !== 2) || interlace) throw new Error('only 8-bit RGB(A), non-interlaced PNGs');
  const bpp = color === 6 ? 4 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2]; out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, rgba: out };
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Area-average down-scaling (premultiplied, so edges don't fringe).
function resize(img, nw, nh) {
  const { w, h, rgba } = img, out = Buffer.alloc(nw * nh * 4);
  const sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = y * sy, y1 = y0 + sy;
    for (let x = 0; x < nw; x++) {
      const x0 = x * sx, x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0), wgt = wx * wy, o = (yy * w + xx) * 4, al = rgba[o + 3] / 255;
          r += rgba[o] * al * wgt; g += rgba[o + 1] * al * wgt; b += rgba[o + 2] * al * wgt; a += al * wgt; area += wgt;
        }
      }
      const o = (y * nw + x) * 4;
      out[o] = a ? Math.round(r / a) : 0; out[o + 1] = a ? Math.round(g / a) : 0; out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / area) * 255);
    }
  }
  return { w: nw, h: nh, rgba: out };
}

// A navy canvas with a soft gold glow at the bottom, the icon placed on it.
function canvas(w, h, glow) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const t = glow ? Math.max(0, (y / h - 0.62) / 0.38) : 0, k = 0.55 * t * t;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3, cx = Math.abs(x / w - 0.5) * 2, kk = k * (1 - 0.6 * cx * cx);
      for (let i = 0; i < 3; i++) rgb[o + i] = Math.round(NAVY[i] * (1 - kk) + GOLD[i] * kk);
    }
  }
  return { w, h, rgb };
}
function place(c, icon, left, top) {
  for (let y = 0; y < icon.h; y++) {
    for (let x = 0; x < icon.w; x++) {
      const X = left + x, Y = top + y;
      if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) continue;
      const s = (y * icon.w + x) * 4, d = (Y * c.w + X) * 3, a = icon.rgba[s + 3] / 255;
      for (let i = 0; i < 3; i++) c.rgb[d + i] = Math.round(icon.rgba[s + i] * a + c.rgb[d + i] * (1 - a));
    }
  }
  return c;
}

function bmp24(c) {
  const row = Math.ceil((c.w * 3) / 4) * 4, size = 54 + row * c.h, b = Buffer.alloc(size);
  b.write('BM', 0, 'latin1'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(c.w, 18); b.writeInt32LE(c.h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  b.writeUInt32LE(row * c.h, 34); b.writeInt32LE(2835, 38); b.writeInt32LE(2835, 42);
  for (let y = 0; y < c.h; y++) {
    const o = 54 + (c.h - 1 - y) * row;                       // bottom-up
    for (let x = 0; x < c.w; x++) {
      const s = (y * c.w + x) * 3;
      b[o + x * 3] = c.rgb[s + 2]; b[o + x * 3 + 1] = c.rgb[s + 1]; b[o + x * 3 + 2] = c.rgb[s];
    }
  }
  return b;
}

function ico(images) {   // PNG-compressed entries (Windows Vista and later)
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((im, i) => {
    const e = 6 + 16 * i;
    head[e] = im.size >= 256 ? 0 : im.size; head[e + 1] = im.size >= 256 ? 0 : im.size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(im.png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += im.png.length;
  });
  return Buffer.concat([head, ...images.map((im) => im.png)]);
}

function build() {
  const icon = decodePng(fs.readFileSync(SRC));
  const files = {};
  for (const [scale, suffix] of [[1, ''], [2, '-200']]) {
    const W = 164 * scale, H = 314 * scale, s = Math.round(128 * scale);
    files[`wizard${suffix}.bmp`] = bmp24(place(canvas(W, H, true), resize(icon, s, s), Math.round((W - s) / 2), Math.round(46 * scale)));
    const hw = 55 * scale, hh = 58 * scale, hs = Math.round(50 * scale);
    files[`header${suffix}.bmp`] = bmp24(place(canvas(hw, hh, false), resize(icon, hs, hs), Math.round((hw - hs) / 2), Math.round((hh - hs) / 2)));
  }
  files['opspoint.ico'] = ico([16, 32, 48, 256].map((size) => {
    const r = resize(icon, size, size);
    return { size, png: encodePng(size, size, r.rgba) };
  }));
  return files;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const files = build();
  const stale = [];
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const f = path.join(OUT, name);
    const same = fs.existsSync(f) && fs.readFileSync(f).equals(data);
    if (!same) { stale.push(name); if (!check) fs.writeFileSync(f, data); }
  }
  if (check && stale.length) { process.stdout.write(`Out of date (run node scripts/gen-installer-art.cjs): ${stale.join(', ')}\n`); process.exit(1); }
  process.stdout.write(stale.length ? `${check ? 'Stale' : 'Wrote'}: ${stale.join(', ')}\n` : 'Installer art is up to date.\n');
}

module.exports = { build, decodePng, encodePng, resize };
