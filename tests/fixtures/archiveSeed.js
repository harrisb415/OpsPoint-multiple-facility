'use strict';
// Fills every table an export carries with a few rows of valid values — every
// column of every table, so an export -> import round trip has all of them to
// carry — plus what an export must handle: settings that stay behind, the HQ
// link, a setup code, photos (one over a block long, one inline, one missing,
// a probe file left behind), long and non-ASCII text, empty times, a clock
// change, a UA time from before it was stored with its zone, and (SQLite only)
// references to rows long gone where Postgres has a foreign key SQLite lacks.
// Used by tests/archive.test.js; works on either driver.
const crypto = require('crypto');
const C = require('../../server/archive/columns');
const archive = require('../../server/archive');

// Columns the databases hold to a list (Postgres CHECKs, SQLite's clinical ones).
const ENUMS = {
  'passes.status': ['Approved', 'Out', 'Extended', 'Returned'],
  'mail_log.status': ['pending', 'approved', 'delivered'],
  'incidents.severity': ['low', 'medium', 'high', 'critical'],
  'clinical_notes.note_type': ['progress', 'intake', 'medical', 'psychosocial', 'other'],
  'clinical_notes.status': ['draft', 'final', 'amended'],
  'treatment_plans.status': ['active', 'completed', 'discontinued'],
  'assessments.assessment_type': ['biopsychosocial', 'substance_use', 'mental_status', 'trauma', 'risk', 'other'],
  'assessments.status': ['draft', 'final'],
  'group_notes.status': ['draft', 'final'],
  'group_note_attendees.participation': ['present', 'absent', 'excused'],
  'discharge_summaries.discharge_type': ['planned', 'unplanned', 'ama', 'transfer', 'deceased'],
  'discharge_summaries.status': ['draft', 'final'],
  'wellness_rounds.status': ['finished', 'abandoned'],           // one 'open' round at most
  'wellness_round_marks.mark': ['ok', 'missing'],
};
// Text the app reads as JSON.
const JSON_TEXT = {
  'users.permissions': '["reports.create","log.add"]',
  'groups.permissions': '["mobile.access"]',
  'reports.statuses': '{}',
  'reports.med_notes': '[]',
  'reports.roster_snapshot': '[]',
  'reports.issues': '[]',
};
// Postgres foreign keys that SQLite never had.
const PG_ONLY_FK = ['disclosures.consent_id', 'mail_log.report_id', 'ua_records.log_entry_id', 'ua_records.report_id', 'ua_records.ua_request_id'];
const GONE = 987654;     // an id no row has

function kindOf(type, isPg) {
  const t = String(type || '').toLowerCase();
  if (isPg) return /^(integer|smallint|bigint)$/.test(t) ? 'int' : /^(double precision|real|numeric)$/.test(t) ? 'num' : 'text';
  return t.includes('int') ? 'int' : /real|floa|doub/.test(t) ? 'num' : 'text';
}
const pad = (n) => String(n).padStart(2, '0');
const utcText = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };

async function seedEverything({ conn, isPg, zone, storage, rows = 3, dangling = !isPg }) {
  const schema = await archive.describe(conn, isPg);
  const names = [...schema.keys()].filter((n) => !C.EXCLUDED_TABLES.includes(n) && (!isPg || archive.facilityTables().has(n)));
  // 2026-03-08 09:30 UTC: 01:30 on the US west coast, half an hour before the clocks go forward.
  const base = Date.UTC(2026, 2, 8, 9, 30, 17);
  const big = 'Zoë ✓ '.repeat(250000);         // about 2 MB of two- and three-byte characters
  const ids = {};
  for (const t of archive.loadOrder(names)) {
    if (t === 'settings') continue;
    const desc = schema.get(t);
    const numbered = desc.pk.length === 1 && desc.pk[0] === 'id';
    ids[t] = numbered ? (await conn.query(`SELECT id FROM "${t}" ORDER BY id`)).map((r) => Number(r.id)) : [];
    for (let i = 0; i < rows; i++) {
      const cols = [], vals = [];
      for (const c of desc.columns) {
        if (c.generated || (numbered && c.name === 'id')) continue;
        const key = `${t}.${c.name}`;
        const emptyText = !isPg && /^''$/.test(String(c.dflt || '').trim());
        const blank = emptyText ? '' : null;             // how this database says "no value" here
        let v;
        const parent = C.FK_EDGES[key];
        const instant = (C.INSTANTS[t] || {})[c.name];
        if (parent) {
          const pool = ids[parent] || [];
          if (dangling && PG_ONLY_FK.includes(key) && i === 0) v = GONE;
          else v = pool.length ? pool[i % pool.length] : c.notNull ? undefined : null;
        } else if (instant) {
          const ms = base + i * 7 * 3600e3 + (key.length % 50) * 60e3;
          if (i === 2 && !c.notNull) v = blank;
          else if (isPg) v = new Date(ms).toISOString();
          else if (instant === 'utc') v = utcText(ms);
          else if (instant === 'local') v = C.msToWall(ms, zone);
          else if (instant === 'input') v = C.msToWall(ms, zone, 'T', false);
          else if (key === 'ua_records.tested_at' && i === 1) v = C.msToWall(ms, zone, 'T', false);   // before 2026-09-26
          else v = new Date(ms).toISOString();
        } else if ((C.DATES[t] || []).includes(c.name)) {
          v = i === 2 && !c.notNull ? blank : new Date(Date.UTC(2026, 2, 10 + i)).toISOString().slice(0, 10);
        } else if (ENUMS[key]) {
          v = ENUMS[key][i % ENUMS[key].length];
        } else if (JSON_TEXT[key]) {
          v = JSON_TEXT[key];
        } else {
          const kind = kindOf(c.type, isPg);
          if (kind === 'int') v = i % 2;
          else if (kind === 'num') v = 1.5 + i;
          else if (key === 'log_entries.text' && i === 0) v = big;
          else v = `${key} #${i} — Zoë, naïve café ✓`;
        }
        if (v === undefined) continue;
        cols.push(c.name); vals.push(v);
      }
      const r = await conn.run(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
      if (numbered) ids[t].push(Number(r.lastInsertRowid));
    }
  }

  // Settings: some travel, some stay with the machine, the HQ link only when asked.
  const put = (k, v) => conn.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
  await put('facility_name', 'Archive Test House');
  await put('backup_dir', '/only/on/this/machine');
  await put('central_url', 'https://hq.example.test');
  await put('central_api_key', 'not-a-real-key');
  await put('central_last_sync', '2026-09-30 01:00:00');
  await put('setup', { code_hash: 'h', code_salt: 's', code_created: 'c', code_expires: 'e', admin_id: ids.users[0], steps: { account: 'done' } });

  // Photos: one longer than an archive block, one in the row itself, one gone.
  const jpg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), crypto.randomBytes(1536 * 1024)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), crypto.randomBytes(3000)]);
  await storage.put('photos/client_a.jpg', jpg, { contentType: 'image/jpeg' });
  await storage.put('photos/ua_b.jpg', png, { contentType: 'image/png' });
  await storage.put('photos/.probe-left-behind.txt', Buffer.from('probe'), { contentType: 'text/plain' });
  await conn.run('UPDATE clients SET photo=? WHERE id=?', ['photos/client_a.jpg', ids.clients[0]]);
  await conn.run('UPDATE clients SET photo=? WHERE id=?', [`data:image/png;base64,${png.toString('base64')}`, ids.clients[1]]);
  await conn.run('UPDATE clients SET photo=? WHERE id=?', ['photos/gone.jpg', ids.clients[2]]);
  await conn.run('UPDATE ua_records SET photo=? WHERE id=?', ['photos/ua_b.jpg', ids.ua_records[0]]);
  return { ids, photos: { 'photos/client_a.jpg': jpg, 'photos/ua_b.jpg': png } };
}

module.exports = { seedEverything, PG_ONLY_FK, GONE };
