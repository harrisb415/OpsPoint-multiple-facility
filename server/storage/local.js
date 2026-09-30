'use strict';
/**
 * Local folder storage: key 'photos/client_12.jpg' is <dir>/photos/client_12.jpg.
 * A write goes to a temporary file first and is renamed into place, so a crash
 * mid-write never leaves half a photo under the real name.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

module.exports = function localStorage({ dir }) {
  const root = path.resolve(dir);
  function full(key) {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error(`storage: ${key} is outside the storage folder`);
    return p;
  }
  return {
    kind: 'local',
    root,
    async put(key, bytes) {
      const p = full(key);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fsp.writeFile(tmp, bytes);
      await fsp.rename(tmp, p);
    },
    async get(key) {
      try { return await fsp.readFile(full(key)); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async remove(key) {
      try { await fsp.unlink(full(key)); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    },
    async list(prefix = '') {
      const out = [];
      async function walk(rel) {
        let entries;
        try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); }
        catch (e) { if (e.code === 'ENOENT') return; throw e; }
        for (const e of entries) {
          const k = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(k);
          else if (e.isFile() && k.startsWith(prefix) && !k.endsWith('.tmp')) out.push(k);
        }
      }
      await walk('');
      return out.sort();
    },
    // Whether the folder a key would go in exists — so the health check can
    // say so without creating it.
    hasFolder(key) { return fs.existsSync(path.dirname(full(key))); },
    describe() { return `the folder ${root}`; },
  };
};
