# Fleet Updates — design & status

How OpsPoint distributes updates across the HQ + facility fleet. This subsystem
is **security-critical** (it swaps running code), so the trust model below is not
optional.

## Topology (target)
```
You (vendor) ──signed GitHub release──► HQ Central (only box needing internet)
                                          │ stores + relays bundle on the LAN
   Facility ──poll──► HQ ──signed bundle over TLS+API key──► Facility (no internet)
```
Facilities are **outbound-only**, so "push" is really HQ-orchestrated **pull**:
nodes already poll HQ (`syncTick`/checkin); the response carries the update
command and each node applies it to itself with its own `updater.js`.

## Trust model (the core)
- The **vendor** holds an **Ed25519 private key** (offline): `release-private.pem`
  (gitignored). `scripts/release.mjs` signs `version\nsize\nsha256` with it.
- The app **pins the public key** (`RELEASE_PUBKEY_PEM` in `updater.js` and
  `central/updater.js`).
- `apply()` installs only if **size + sha256 + signature** all verify. Because the
  signed payload binds the bundle hash, a valid signature authenticates the code.
- Net: HQ (or a MITM, or a compromised manifest host) can decide *which* version
  and *when*, but **cannot forge *what*** — it has no signing key.

## Status

### Phase 1 — Release signing — **BUILT & verified** (jest 6/6)
- `updater.js`: pinned `RELEASE_PUBKEY_PEM` + `verifyManifestSignature()`;
  `apply()` refuses unsigned/invalid/tampered bundles (after the sha256 check);
  `check()`/`status()` expose `signed`.
- `scripts/release.mjs`: signs the manifest (`sig_alg:"ed25519"`, `signature`);
  aborts if the key is missing.
- `scripts/gen-release-key.mjs`: generate/rotate the keypair.
- `tests/updater.signing.test.js`: CI-safe fixture verifies against the pinned key
  (valid accepted; unsigned/garbage/tampered version|size|sha256 all rejected).

### Phase 2 — HQ self-updater — **BUILT & verified** (central E2E 6/6 + boot smoke)
- `central/updater.js`: same model scoped to central — runtime files
  `server.js/db.js/updater.js/package*.json` + `public/`; bundle sanity-checked for
  `server.js`+`public/index.html`; backs up `central.db` + code; no WebSocket
  (console polls).
- `central/server.js`: `restartServer()` + `createUpdater(...)` + routes
  `/api/update/status|check|apply|backups|rollback` (admin; CSRF via origin check).
- `central/db.js`: seeds `central_update_manifest_url`.
- Console **System** tab: current version, check, signed/unsigned badge, changelog,
  Download&Install (restart-aware polling), backups + roll back.
- `central/scripts/updater_e2e.cjs`: serves a signed manifest over a local
  allow-listed host; asserts check()/signed + tamper rejection + status() shape.

### Phase 3 — HQ as on-prem bundle host — **BUILT & verified** (fleet_e2e 14/14)
- `releases` table + on-disk store (`central/data/releases/<channel>/`); `POST
  /api/releases/import` fetches a manifest from an allow-listed host, verifies
  signature+sha256+size, downloads + stores the bundle; `GET /api/releases` +
  publish/yank.
- Facility-facing `GET /fleet/manifest` + `GET /fleet/bundle/:version` (API-key
  auth): latest published facility release with the bundle URL rewritten to HQ;
  the vendor signature is relayed (HQ still can't forge it).
- Facility `updater.js` threads optional auth headers (`authFor`); `server.js`
  sends `x-facility-key` to the central host, so pointing `update_manifest_url` at
  `<hq>/fleet/manifest` pulls updates from HQ on the LAN — no internet at buildings.
- `release.mjs` also builds + signs the central bundle/manifest. Console "Releases" tab.

### Phase 4 — Bootstrap health-check + auto-rollback — **BUILT & verified** (bootstrap_e2e 10/10)
- `bootstrap.js` + `central/bootstrap.js`: long-lived supervisor (run.bat runs it).
  Launches the server with `OPSPOINT_BOOTSTRAP=1`; relaunches it whenever it exits
  (an in-app restart/update just exits the child); crash-loop give-up.
- After an update, `updater.apply()` writes `data/updates/pending-verify.json`
  (backup path + versions). On the next boot the supervisor health-checks
  `/api/health`; if the new build doesn't come up it **restores the backup and
  relaunches** the previous version. Manual rollback clears the marker.
- `restartServer()` (both tiers) is bootstrap-aware: under the supervisor it exits;
  launched directly (dev) it self-respawns as before. `bootstrap.js` is NOT in the
  update swap set, so the supervisor stays stable across updates (like run.bat).
- Verified both directions: broken build → rollback; healthy build → commit (no
  false rollback).
- **Known limitation:** rollback restores code (incl. the old lockfile); if a failed
  update had changed dependencies, a manual `npm install` may be needed. Most
  updates don't touch the lockfile.

### Phase 5 — Rollout orchestration — **BUILT & verified** (rollout_e2e 15/15)
- HQ `rollouts` table (one per channel) + engine: per-facility update **directive**
  on each checkin/ingest, **serve-layer gating** (`/fleet/manifest` only serves a
  facility the version it's eligible for), **canary → active → complete**
  auto-advance, and **auto-pause** if a canary (or any active node) reports a
  rollback. Routes: `GET/POST /api/rollout`, `POST /api/rollout/{pause|resume|advance}`.
  Console "Rollout" tab: start (version + canary pick), pause/resume/advance,
  per-facility progress.
- Facilities self-report update outcome (`updated|rolled_back|idle`, derived from
  updater/bootstrap markers) in checkin/ingest; HQ stores it on the facility row
  and the engine reacts to it.
- Facility **auto-apply agent** (`syncTick`): on a directive, if the facility has
  **opted in** (`central_auto_update`) and is within its **maintenance window**
  (`central_update_window`), it runs the updater (pull from HQ → verify signature →
  apply → bootstrap health-check/rollback). Opt-in toggle + window in Admin → System.
- On **connect**, the facility auto-points `update_manifest_url` at
  `<hq>/fleet/manifest` (restored on disconnect); the updater sends the API key and
  tolerates the HQ's self-signed cert (`authFor`/`insecureFor`).
- bootstrap writes `last-rollback.json` so a rolled-back node reports `rolled_back`
  → HQ auto-pauses.

## Status: all phases (1–5) complete.
The fleet now: signs releases (vendor key), self-updates HQ, relays bundles on-prem,
auto-rolls-back failed boots, and runs **staged, health-gated, opt-in** rollouts with
a canary→fleet cascade and an auto-pause kill switch.

### Possible follow-ups (not built)
- Per-admin PHI/rollout permissions (currently any HQ admin can drive rollouts).
- Rollback of dependency changes (a failed update that altered the lockfile may need
  a manual `npm install` after rollback — rare).
- Time-boxed canary auto-advance (advance after N healthy minutes, not just "all
  canaries reported"). Today advancing early is a manual "Advance to all".

## Procedures

**Generate/rotate the signing key**
```
node scripts/gen-release-key.mjs   # writes release-private.pem (BACK IT UP), prints the public key
```
Paste the printed public key into `RELEASE_PUBKEY_PEM` in **both** `updater.js` and
`central/updater.js`. Rotating the key means every node must first update to a build
carrying the new key before it will accept further releases.

**Cut a signed facility release** (private key present or `OPSPOINT_RELEASE_KEY`/`_FILE` set)
```
node scripts/release.mjs           # builds, signs, rewrites update-manifest.json
gh release create v<ver> release/opspoint-<ver>.zip update-manifest.json \
  -R harrisb415/opspoint-releases --title v<ver> --notes-file CHANGELOG.md
```
A central release (`central-<ver>.zip` + `central-manifest.json`) follows the same
pattern once Phase 3 packages it; HQ already self-updates from
`central_update_manifest_url`.

> ⚠ Key safety: if `release-private.pem` is lost, you cannot sign new releases and
> the fleet will refuse updates until you rotate + re-pin. Keep an offline backup.
