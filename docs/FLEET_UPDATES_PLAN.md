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

### Deferred (not built)
3. **HQ as bundle host** — store/serve `facility-X.zip` to nodes over the authed
   channel so facilities never touch the internet; facility updater gains an "HQ
   source".
4. **Bootstrap health-check + auto-rollback launcher** — `run.bat → bootstrap.js`
   boots the new build, health-checks, auto-reverts on failed boot. **Prerequisite
   for safe unattended fleet apply.**
5. **Rollout orchestration** — cohorts, canary → fleet with health gating,
   pause/yank kill switch, maintenance windows, per-facility status in the console.

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
