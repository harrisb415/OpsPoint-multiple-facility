'use strict';
/* Phase 5 E2E — rollout engine (direct db, deterministic).
 * Covers per-facility directive eligibility, serve-layer gating, canary→active→
 * complete auto-advance, and auto-pause on a canary failure. */
const db = require('../db');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data_rollouttest');
const BASE = 'https://hq.local';
const V = '2.4.0';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

fs.rmSync(DATA, { recursive: true, force: true });
db.init(path.join(DATA, 'central.db'));

db.recordRelease({ channel: 'facility', version: V, filename: 'facility-' + V + '.zip', size: 123, sha256: 'a'.repeat(64), signature: 'sig', sig_alg: 'ed25519', status: 'published' });
const f1 = db.createFacility('F1').id, f2 = db.createFacility('F2').id, f3 = db.createFacility('F3').id;
const setVer = (id, v, st) => { db.touchFacility(id, { app_version: v }); if (st) db.recordFacilityUpdateStatus(id, st); };
setVer(f1, '2.3.9'); setVer(f2, '2.3.9'); setVer(f3, '2.3.9');

// ── Canary ──
db.startRollout('facility', V, [f1]);
ok(db.getRollout('facility').state === 'canary', 'rollout starts in canary');
ok(!!db.updateDirectiveFor(db.getFacility(f1), BASE), 'canary facility F1 gets a directive');
ok(db.updateDirectiveFor(db.getFacility(f2), BASE) === null, 'non-canary F2 gets NO directive');
const m1 = db.manifestReleaseFor(db.getFacility(f1));
ok(m1 && m1.version === V, 'F1 manifest serves the rollout version');
ok(db.manifestReleaseFor(db.getFacility(f2)) === null, 'F2 manifest gated during canary (no serve)');
const d1 = db.updateDirectiveFor(db.getFacility(f1), BASE);
ok(d1.version === V && d1.apply === 'auto' && d1.url === BASE + '/fleet/bundle/' + V, 'directive: version + auto + HQ bundle url');
ok(d1.signature === 'sig' && d1.sha256 === 'a'.repeat(64), 'directive relays signature + sha256');

// canary succeeds → advance to active
setVer(f1, V, { state: 'updated', attempted: V });
db.evaluateRollout('facility');
ok(db.getRollout('facility').state === 'active', 'canary success advances to active');
ok(!!db.updateDirectiveFor(db.getFacility(f2), BASE), 'after advance, F2 now gets a directive');
ok(db.updateDirectiveFor(db.getFacility(f1), BASE) === null, 'F1 (already on target) gets no directive');

// rest update → complete
setVer(f2, V, { state: 'updated', attempted: V });
setVer(f3, V, { state: 'updated', attempted: V });
db.evaluateRollout('facility');
ok(db.getRollout('facility').state === 'complete', 'all-on-target advances to complete');
ok(db.updateDirectiveFor(db.getFacility(f2), BASE) === null, 'no directives after complete');

// ── Auto-pause on canary failure ──
const g1 = db.createFacility('G1').id; setVer(g1, '2.3.9');
db.startRollout('facility', V, [g1]);
ok(db.getRollout('facility').state === 'canary', 'new rollout back to canary');
setVer(g1, '2.3.9', { state: 'rolled_back', attempted: V }); // canary tried + rolled back
db.evaluateRollout('facility');
ok(db.getRollout('facility').state === 'paused', 'canary rollback auto-pauses the rollout');
ok(db.updateDirectiveFor(db.getFacility(g1), BASE) === null, 'paused rollout issues no directives');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(fail === 0 ? 0 : 1); }, 150);
