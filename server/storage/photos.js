'use strict';
/**
 * Photos through the storage port. The database keeps a reference such as
 * 'photos/client_12.jpg' (older rows may hold a whole data: URI); the client
 * gets data: URIs, as it always has.
 *
 * A cloud backend costs a round trip per photo, and GET /api/data sends every
 * resident's photo on each reload, so photos read from one are kept in memory
 * (up to 64 MB, least recently used first out) and replaced when rewritten.
 * A local folder is read directly, as before.
 */
const path = require('path');
const { storage } = require('./index');

const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const cache = new Map();            // key -> Buffer, oldest first
let cacheBytes = 0;

function remember(key, bytes) {
  if (storage().kind === 'local' || bytes.length > CACHE_MAX_BYTES / 8) return;
  forget(key);
  cache.set(key, bytes);
  cacheBytes += bytes.length;
  for (const [k, b] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    cache.delete(k); cacheBytes -= b.length;
  }
}
function forget(key) {
  const b = cache.get(key);
  if (b) { cache.delete(key); cacheBytes -= b.length; }
}
function cached(key) {
  const b = cache.get(key);
  if (b) { cache.delete(key); cache.set(key, b); }     // most recently used goes last
  return b || null;
}

// The image type from the bytes themselves; the file name is only a fallback
// (UA photos are all named .jpg whatever they are).
function contentType(bytes, key = '') {
  if (bytes && bytes.length >= 12) {
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  }
  return path.extname(key).toLowerCase() === '.gif' ? 'image/gif' : 'image/jpeg';
}

// Store a data: URI photo; returns the reference to keep in the database.
// Anything that isn't a data: URI (an existing reference, null) passes through.
async function savePhoto(dataUri, fname) {
  if (!dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:')) return dataUri;
  const bytes = Buffer.from(dataUri.split(',')[1] || '', 'base64');
  const key = 'photos/' + fname;
  await storage().put(key, bytes, { contentType: contentType(bytes, key) });
  remember(key, bytes);
  return key;
}

// { bytes, contentType } for a reference, or null when there is none (or it
// isn't one of ours). A data: URI kept in the database is decoded in place.
async function readPhoto(ref) {
  if (!ref || typeof ref !== 'string') return null;
  if (ref.startsWith('data:')) {
    const m = /^data:([^;,]+)?(?:;base64)?,/.exec(ref);
    return m ? { bytes: Buffer.from(ref.slice(m[0].length), 'base64'), contentType: m[1] || 'image/jpeg' } : null;
  }
  if (!/^photos\//.test(ref)) return null;
  let bytes = cached(ref);
  if (!bytes) {
    try { bytes = await storage().get(ref); } catch (e) { if (/not a file name/.test(e.message)) return null; throw e; }
    if (!bytes) return null;
    remember(ref, bytes);
  }
  return { bytes, contentType: contentType(bytes, ref) };
}

// The data: URI the client shows, or null.
async function photoDataUri(ref) {
  if (ref && typeof ref === 'string' && ref.startsWith('data:')) return ref;
  const p = await readPhoto(ref);
  return p ? `data:${p.contentType};base64,${p.bytes.toString('base64')}` : null;
}

// Many at once, a few at a time (a cloud backend gets eight requests in flight).
async function photoDataUris(refs, limit = 8) {
  const out = new Array(refs.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < refs.length) {
      const i = next++;
      try { out[i] = await photoDataUri(refs[i]); } catch (e) { out[i] = null; console.error('[storage] photo:', e.message); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, refs.length) }, worker));
  return out;
}

function _clearCache() { cache.clear(); cacheBytes = 0; }

module.exports = { savePhoto, readPhoto, photoDataUri, photoDataUris, contentType, _clearCache };
