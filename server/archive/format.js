'use strict';
/**
 * server/archive/format.js — the export file: one encrypted, versioned
 * container, written and read as a stream so a six-year audit log never has
 * to fit in memory.
 *
 *   "OPSPOINT-ARCHIVE\n"                       17 bytes
 *   4-byte length + header JSON (plain)        { format, kdf: scrypt N/r/p + salt, nonce, chunk }
 *   frames: 4-byte length L, L bytes of AES-256-GCM ciphertext, 16-byte tag
 *     key   = scrypt(passphrase, salt)
 *     nonce = the header's 8-byte prefix + the frame's number (4 bytes)
 *     AAD   = sha256(magic, header) + 1 byte: 1 on the last frame, else 0
 *   The frames' plaintext, joined, is gzip; inside it, blocks:
 *     4-byte length + { name, size, last } then `size` bytes. An entry (a
 *     table, a photo) is one or more blocks of at most 1 MiB; { end: true }
 *     closes the stream.
 * A wrong passphrase, or a file changed, reordered, cut short or extended,
 * fails as it is read — before anything is trusted.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const zlib = require('zlib');
const crypto = require('crypto');
const { Readable, Transform, pipeline } = require('stream');

const MAGIC = Buffer.from('OPSPOINT-ARCHIVE\n');
const FORMAT = 1;
const FRAME = 64 * 1024;                 // plaintext per frame
const BLOCK = 1024 * 1024;               // payload per block
const KDF = { name: 'scrypt', N: 1 << 15, r: 8, p: 1 };
const MIN_PASSPHRASE = 12;
const NAME_RE = /^(header\.json|manifest\.json|tables\/[a-z_][a-z0-9_]*\.jsonl|photos\/[A-Za-z0-9._-]{1,200})$/;

class ArchiveError extends Error {
  constructor(message) { super(message); this.name = 'ArchiveError'; this.code = 'ARCHIVE'; }
}

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const sha256 = (...bufs) => { const h = crypto.createHash('sha256'); for (const b of bufs) h.update(b); return h.digest(); };

function checkPassphrase(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSPHRASE) {
    throw new ArchiveError(`The passphrase must be at least ${MIN_PASSPHRASE} characters.`);
  }
}
function deriveKey(passphrase, kdf, salt) {
  if (!kdf || kdf.name !== 'scrypt' || !(kdf.N >= 1 << 14 && kdf.N <= 1 << 20) || !(kdf.r >= 1 && kdf.r <= 32) || !(kdf.p >= 1 && kdf.p <= 4)) {
    throw new ArchiveError('This file names a key derivation OpsPoint does not use: it is not an OpsPoint export, or it is damaged.');
  }
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r }, (e, key) => (e ? reject(e) : resolve(key)));
  });
}

function seal(key, prefix, aad, index, plain, final) {
  const c = crypto.createCipheriv('aes-256-gcm', key, Buffer.concat([prefix, u32(index)]));
  c.setAAD(Buffer.concat([aad, Buffer.from([final ? 1 : 0])]));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([u32(ct.length), ct, c.getAuthTag()]);
}
function open(key, prefix, aad, index, ct, tag, final) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.concat([prefix, u32(index)]));
  d.setAAD(Buffer.concat([aad, Buffer.from([final ? 1 : 0])]));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

// gzip bytes in, frames out; the last frame is marked final.
class Encryptor extends Transform {
  constructor(key, prefix, aad) { super(); Object.assign(this, { key, prefix, aad, parts: [], len: 0, index: 0 }); }
  _transform(chunk, _enc, cb) {
    this.parts.push(chunk); this.len += chunk.length;
    if (this.len > FRAME) {
      let all = Buffer.concat(this.parts);
      while (all.length > FRAME) { this.push(seal(this.key, this.prefix, this.aad, this.index++, all.subarray(0, FRAME), false)); all = all.subarray(FRAME); }
      this.parts = [all]; this.len = all.length;
    }
    cb();
  }
  _flush(cb) { this.push(seal(this.key, this.prefix, this.aad, this.index++, Buffer.concat(this.parts), true)); cb(); }
}

function write(stream, buf) {
  return new Promise((resolve, reject) => {
    const onError = (e) => reject(e);
    stream.once('error', onError);
    const ok = stream.write(buf, () => { stream.off('error', onError); });
    if (ok) { stream.off('error', onError); resolve(); } else stream.once('drain', () => { stream.off('error', onError); resolve(); });
  });
}

/**
 * Start a new archive at `file` (created 0600; an existing file is refused).
 * Returns { entry(name) -> { write(buf), end() -> { sha256, bytes } }, finish() }.
 * Entries are written one at a time, in order.
 */
async function createWriter(file, { passphrase }) {
  checkPassphrase(passphrase);
  const salt = crypto.randomBytes(16), prefix = crypto.randomBytes(8);
  const header = Buffer.from(JSON.stringify({ format: FORMAT, kdf: { ...KDF, salt: salt.toString('base64') }, nonce: prefix.toString('base64'), frame: FRAME }));
  const key = await deriveKey(passphrase, KDF, salt);
  const aad = sha256(MAGIC, u32(header.length), header);

  const out = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
  await new Promise((resolve, reject) => { out.once('open', resolve); out.once('error', reject); });
  out.write(Buffer.concat([MAGIC, u32(header.length), header]));
  const gz = zlib.createGzip({ level: 6 });
  const done = new Promise((resolve, reject) => pipeline(gz, new Encryptor(key, prefix, aad), out, (e) => (e ? reject(e) : resolve())));
  done.catch(() => {});

  async function block(name, data, last) {
    const meta = Buffer.from(JSON.stringify({ name, size: data.length, last }));
    await write(gz, Buffer.concat([u32(meta.length), meta, data]));
  }
  return {
    entry(name) {
      if (!NAME_RE.test(name)) throw new ArchiveError(`Not an archive entry name: ${name}`);
      const h = crypto.createHash('sha256');
      let pending = [], size = 0, bytes = 0;
      return {
        async write(buf) {
          const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
          h.update(b); bytes += b.length; pending.push(b); size += b.length;
          while (size >= BLOCK) {
            const all = Buffer.concat(pending);
            await block(name, all.subarray(0, BLOCK), false);
            pending = [all.subarray(BLOCK)]; size = pending[0].length;
          }
        },
        async end() {
          await block(name, Buffer.concat(pending), true);
          pending = []; size = 0;
          return { sha256: h.digest('hex'), bytes };
        },
      };
    },
    async finish() {
      const meta = Buffer.from(JSON.stringify({ end: true }));
      await write(gz, Buffer.concat([u32(meta.length), meta]));
      gz.end();
      await done;
    },
    async abort() {
      gz.destroy(); out.destroy();
      await fsp.rm(file, { force: true }).catch(() => {});
    },
  };
}

/**
 * Open an archive. Returns { header, blocks() } where blocks() yields
 * { name, data, last } in order and throws ArchiveError on a wrong
 * passphrase or any damage.
 */
async function openReader(file, { passphrase }) {
  checkPassphrase(passphrase);
  const fh = await fsp.open(file, 'r');
  const { size: fileSize } = await fh.stat();
  async function readAt(pos, len) {
    const b = Buffer.alloc(len);
    const { bytesRead } = await fh.read(b, 0, len, pos);
    return bytesRead === len ? b : null;
  }
  try {
    const magic = await readAt(0, MAGIC.length);
    if (!magic || !magic.equals(MAGIC)) throw new ArchiveError("This isn't an OpsPoint export file.");
    const hlenBuf = await readAt(MAGIC.length, 4);
    const hlen = hlenBuf ? hlenBuf.readUInt32BE() : 0;
    if (!hlen || hlen > 64 * 1024) throw new ArchiveError('The export file is damaged (its header).');
    const headerBytes = await readAt(MAGIC.length + 4, hlen);
    let header;
    try { header = JSON.parse(String(headerBytes)); } catch (e) { throw new ArchiveError('The export file is damaged (its header).'); }
    if (header.format > FORMAT) throw new ArchiveError(`This export uses archive format ${header.format}, which a newer OpsPoint wrote: update this install first.`);
    if (header.format !== FORMAT) throw new ArchiveError('The export file is damaged (its format).');
    const key = await deriveKey(passphrase, header.kdf, Buffer.from(String(header.kdf.salt || ''), 'base64'));
    const prefix = Buffer.from(String(header.nonce || ''), 'base64');
    if (prefix.length !== 8) throw new ArchiveError('The export file is damaged (its header).');
    const aad = sha256(MAGIC, u32(hlen), headerBytes);
    let pos = MAGIC.length + 4 + hlen;

    async function* plaintext() {
      for (let index = 0; ; index++) {
        const lenBuf = await readAt(pos, 4);
        if (!lenBuf) throw new ArchiveError('The export file is cut short: copy it again.');
        const len = lenBuf.readUInt32BE();
        if (len > FRAME + 64) throw new ArchiveError('The export file is damaged.');
        const body = await readAt(pos + 4, len + 16);
        if (!body) throw new ArchiveError('The export file is cut short: copy it again.');
        pos += 4 + len + 16;
        const final = pos === fileSize;
        let plain;
        try { plain = open(key, prefix, aad, index, body.subarray(0, len), body.subarray(len), final); }
        catch (e) {
          throw new ArchiveError(index === 0
            ? "The passphrase doesn't open this export (or the file is damaged)."
            : final ? 'The export file is cut short or damaged: copy it again.' : 'The export file is damaged.');
        }
        yield plain;
        if (final) return;
      }
    }

    async function* blocks() {
      const gunzip = zlib.createGunzip();
      const failure = new Promise((_, reject) => pipeline(Readable.from(plaintext()), gunzip, (e) => { if (e) reject(e); }));
      failure.catch(() => {});
      let buf = Buffer.alloc(0), ended = false;
      try {
        for await (const chunk of gunzip) {
          buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
          for (;;) {
            if (buf.length < 4) break;
            const mlen = buf.readUInt32BE();
            if (mlen > 4096) throw new ArchiveError('The export file is damaged (a block).');
            if (buf.length < 4 + mlen) break;
            let meta;
            try { meta = JSON.parse(String(buf.subarray(4, 4 + mlen))); } catch (e) { throw new ArchiveError('The export file is damaged (a block).'); }
            if (meta.end) { ended = true; buf = buf.subarray(4 + mlen); break; }
            if (!NAME_RE.test(String(meta.name)) || !(meta.size >= 0 && meta.size <= BLOCK)) throw new ArchiveError('The export file is damaged (a block).');
            if (buf.length < 4 + mlen + meta.size) break;
            const data = Buffer.from(buf.subarray(4 + mlen, 4 + mlen + meta.size));
            buf = buf.subarray(4 + mlen + meta.size);
            yield { name: meta.name, data, last: !!meta.last };
          }
          if (ended) break;
        }
      } catch (e) {
        if (e instanceof ArchiveError) throw e;
        throw new ArchiveError(`The export file is damaged (${e.code || e.message}).`);
      }
      // The encryption already proved every frame; the end marker proves the writer finished.
      if (!ended) throw new ArchiveError('The export file is incomplete: the export did not finish.');
    }
    return { header, blocks, close: () => fh.close() };
  } catch (e) {
    await fh.close().catch(() => {});
    throw e;
  }
}

module.exports = { createWriter, openReader, ArchiveError, MIN_PASSPHRASE, FORMAT, NAME_RE };
