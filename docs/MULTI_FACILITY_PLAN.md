# OpsPoint — Multi-Facility / Centralized Architecture Plan

Status: **draft for review** · Author: planning pass · Target product: OpsPoint v2.x → v3.0

---

## 1. Decisions locked

| Decision | Choice | Consequence |
|----------|--------|-------------|
| Source of truth | **Local-first** | Each facility keeps its own server + SQLite; works fully offline; central aggregates. |
| Central hosting | **Own hardware (HQ)** | No cloud BAA needed. You own central backup, uptime, security. |
| Encryption at rest | **Full-disk (BitLocker) on every box** | Handled at the OS level by the operator. SQLCipher (DB-file encryption) **declined for now** — revisit if backups leave the building or threat model changes. |
| Goals (all four) | Reporting · Central admin/users · Offsite backup · Easier updates | Built in stages, not at once. |

**What this means in one sentence:** the app you have today *is* the local node. We add a second, new server (the "central" / HQ server) that facilities sync to. Facility data flows **up**; identity/config/updates flow **down**. Each record type has exactly one owner, so there is no two-way conflict to resolve in v1.

---

## 2. Architecture overview

```
   FACILITY A (existing app, ~unchanged)        FACILITY B            FACILITY C
   ┌───────────────────────────────┐
   │ server.js + better-sqlite3     │  outbound TLS only            ...
   │ (source of truth, offline-ok)  │ ───────────┐
   │  + sync outbox                 │            │
   │  + sync agent (timer)          │ <──────────┤  pulls config/users/updates
   └───────────────────────────────┘            │
                                                 ▼
                          ┌──────────────────────────────────────┐
                          │   CENTRAL / HQ SERVER (new)           │
                          │   Node + Express                      │
                          │   • /sync ingest (up) + config (down) │
                          │   • Org console (React) — read-only    │
                          │     reporting, facility mgmt, users    │
                          │   • Aggregate DB (facility_id-tagged)  │
                          │   • Serves software releases           │
                          └──────────────────────────────────────┘
```

Key properties:
- **Facilities only make *outbound* connections.** No inbound firewall holes at any building — only the HQ box exposes one TLS endpoint. Big security win.
- **`facility_id` lives only at central.** Local DBs stay single-tenant, so we do **not** rewrite every query or risk a cross-facility `WHERE` leak.
- **Offline is the default, not a feature.** A facility that loses internet keeps logging; the outbox just grows and drains when the link returns.

---

## 3. Component inventory

### New
- **`central/`** — new Node+Express server + React console (mirrors existing patterns: AuthContext, permission middleware, db.js style).
- **Central DB** — tables mirror facility tables **plus `facility_id`**, composite key `(facility_id, source_id)`. New tables: `facilities`, `central_users`, `sync_state`.
- **Sync protocol** — documented contract between node and central (section 4).

### Changed (facility node — additive, low-risk)
- **`sync_outbox` table + SQLite triggers** on every synced table (auto-captures all writes).
- **Sync agent** — a background timer in `server.js` (or a small sibling process) that drains the outbox to central and pulls config down.
- **`facility_id` + `central_url` + `central_api_key`** stored in the `settings` table, generated/registered on first enrollment.
- **Updater** — point `update_manifest_url` at central instead of GitHub (reuses the Option B mechanism you already built).

### Unchanged
- Every existing tab, page, permission, clinical workflow, the LAN WebSocket, the local login. Day-to-day facility UX does not change.

---

## 4. The sync design (the part that's actually hard — kept simple)

### 4.1 Outbox via triggers (robust, can't be forgotten)
SQLite triggers fire on **every** write regardless of code path, so the outbox is always complete — even from migrations or manual edits:

```sql
CREATE TABLE IF NOT EXISTS sync_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- per-facility total order
  table_name TEXT NOT NULL,
  row_id     INTEGER NOT NULL,
  op         TEXT NOT NULL,            -- 'upsert' | 'delete'
  created_at TEXT DEFAULT (datetime('now')),
  synced_at  TEXT DEFAULT NULL
);
-- one pair of triggers per synced table, e.g. clients:
CREATE TRIGGER IF NOT EXISTS trg_clients_ai AFTER INSERT ON clients
  BEGIN INSERT INTO sync_outbox(table_name,row_id,op) VALUES('clients',NEW.id,'upsert'); END;
CREATE TRIGGER IF NOT EXISTS trg_clients_au AFTER UPDATE ON clients
  BEGIN INSERT INTO sync_outbox(table_name,row_id,op) VALUES('clients',NEW.id,'upsert'); END;
CREATE TRIGGER IF NOT EXISTS trg_clients_ad AFTER DELETE ON clients
  BEGIN INSERT INTO sync_outbox(table_name,row_id,op) VALUES('clients',OLD.id,'delete'); END;
```

The agent reads the **current** row at send time (no need to serialize payloads inside the trigger). Deletes carry only the id; central deletes by `(facility_id, source_id)`.

### 4.2 Sync agent loop (node side)
1. On a timer (e.g. every 30–60s) and on demand: select unsynced outbox rows in `id` order, in batches.
2. For `upsert`, fetch the live row; for `delete`, just the id. Build a batch `{ facility_id, since_id, rows[] }`.
3. `POST https://central/sync/ingest` with the API key over TLS.
4. On `200 { applied_through: <id> }`, stamp those outbox rows `synced_at`. On failure, exponential backoff and retry — offline simply means it keeps trying.
5. **Pull phase (Phase 2+):** `GET /sync/config?facility_id=...` returns the current user/permission/settings bundle; node applies it locally. Last-pulled bundle stays usable offline. A local "break-glass" admin always exists so a facility is never locked out if central is unreachable.

### 4.3 Initial backfill (first enrollment)
A new facility's outbox only has *future* changes. To seed central with existing data, enrollment runs a one-time full snapshot: enqueue an `upsert` for every existing row of every synced table, then let the agent drain normally.

### 4.4 Photos / blobs
`clients.photo`, `ua_records.photo`, log UA photos are files on disk. v1: inline base64 in the row payload (simple; payloads larger). v2: dedicated `POST /sync/blob` with content-hash dedupe. Flagged so it isn't forgotten.

### 4.5 Security
- **Transport:** TLS to central (you already generate certs; central gets a real or internal CA cert).
- **AuthN:** long random per-facility API key (hashed at rest in `facilities`). Upgrade path: mutual TLS (client certs per facility) for hardening.
- **Outbound-only** from facilities; central exposes exactly one ingress.
- Sync events are **audit-logged** on both ends (extends your existing `audit_log`).

---

## 5. Central database recommendation

**Start central on SQLite (same `better-sqlite3` stack). Switch to Postgres when you hit the signal below.**

Reasoning for your situation: one DB engine across the whole project while you're learning the distributed pieces; you reuse the `db.js` patterns you already know; zero new infra to stand up. SQLite in WAL mode handles concurrent readers + one writer well — and central writes are easy to serialize (process one facility's sync batch at a time through a queue), which is exactly SQLite's happy path. Reporting queries are reads.

**Switch-to-Postgres signal** (any one):
- More than ~15–20 facilities syncing, or sync batches start queueing noticeably.
- Cross-facility reports over years of history get slow.
- You want real point-in-time recovery / streaming replication for the central PHI store.

To make that switch cheap later: put **all** central DB access behind one module (`central/db.js`) with a small query API — never call SQL from routes directly. Then Postgres is a contained swap, not a rewrite.

---

## 6. Phased roadmap (each phase ships value on its own)

### Phase 0 — Central skeleton + enrollment (no PHI yet)
- New `central/` server: login, `central_users`, `facilities` table, enroll-a-facility flow (generates `facility_id` + API key).
- Node side: store `facility_id` / `central_url` / `central_api_key` in settings; "Connect to HQ" action in Admin → System.
- **Ships:** the backbone + a facility registry. Low risk, no patient data moves.

### Phase 1 — One-way sync (local → central) = **offsite backup**
- `sync_outbox` + triggers on synced tables; sync agent; `/sync/ingest`; initial backfill; photos inline.
- Central ingests into `facility_id`-tagged tables.
- **Ships:** continuous offsite backup of every facility (DR + compliance), and the raw data behind reporting.

### Phase 2 — Org console = **cross-facility reporting** + **central admin/users**
- Read-only dashboards across facilities (census, incidents, UA rates, med logs, occupancy).
- Central becomes master for users / permission profiles / pushed settings; node pulls config down (4.2 pull phase); local break-glass admin retained.
- **Ships:** the HQ visibility + central account management you asked for.

### Phase 3 — **Easier updates** + hardening
- Point each node's updater at central; "release to fleet" action in the console (reuses Option B).
- Optional: mutual TLS, blob endpoint, per-facility health/online status, alerting on a node gone dark.
- **Ships:** one-place updates + production hardening.

### Phase 4 — (only if ever needed) two-way / central editing
- Editing a facility's operational data from HQ. This is the only phase that introduces real conflict resolution. **Deferred until a concrete need exists.**

---

## 7. HIPAA / 42 CFR Part 2 notes (on-prem central)

**Encryption-at-rest decision:** full-disk encryption (BitLocker) on every facility box and the HQ box, managed by the operator. This is the HIPAA at-rest baseline and covers the DB *and* the photo files on the same volume. Application-level DB encryption (SQLCipher) is **not** being added now — revisit only if encrypted DB files start leaving a controlled box (e.g. backups shipped off-site) or the threat model changes.

- The central box now holds **aggregate PHI for the whole org** — it becomes your highest-value target. Treat it accordingly: full-disk encryption, locked-down OS, minimal services, restricted physical access.
- **Central backup is now mission-critical and is on you** — automated, encrypted, tested restores. (Offsite backup of the *central* box itself.)
- Part 2 consent (`consent_records`) and disclosure tracking already exist per-facility; central reporting must respect the same minimum-necessary stripping you already do in `getAllData()` — the console should default to de-identified/aggregate views and gate record-level PHI behind explicit permission.
- Sync is PHI in transit → TLS mandatory, keys rotated, both ends audit-logged.
- Update your risk analysis + policies to cover the new central tier and the node→central data flow.

---

## 8. Open sub-decisions (not blocking; decide before the relevant phase)

1. **Central repo layout:** subfolder `central/` in this repo (simplest for solo) vs. its own repo. *Recommendation: subfolder for now.*
2. **Sync agent placement:** background timer inside `server.js` (one less process) vs. separate sibling process (cleaner isolation). *Recommendation: in-process to start.*
3. **Reach to HQ:** site-to-site VPN vs. one published TLS endpoint at HQ with API keys. *Recommendation: VPN if you have it; otherwise published TLS + keys, outbound-only from facilities.*
4. **User model depth (Phase 2):** fully central accounts vs. central-managed with local fallback. *Recommendation: central master + last-pulled bundle usable offline + local break-glass admin.*

---

## 9. Suggested first concrete step

Build **Phase 0** against one test facility (your dev copy) before touching any real building:
1. Scaffold `central/` (server + minimal console + `facilities`/`central_users` tables).
2. Add the enroll flow + the node-side "Connect to HQ" action.
3. Prove a facility can register and central can list it.

Phase 1's sync then has a backbone to attach to, and nothing patient-facing has moved yet.

---

## 10. Implementation status

- **Sub-decisions taken:** repo layout = **subfolder `central/`**; sync-agent placement = in-process (deferred to P1); central DB = **SQLite** behind a single DAL module (`central/db.js`).
- **Phase 0 — COMPLETE & verified (E2E exit 0).** Facility ↔ HQ enrollment + check-in proven through the real routes (login → enroll → connect → liveness → bad-key reject → disconnect). Central server scaffolded under `central/`:
  - `central/server.js` — Express: admin login/session, facility CRUD, node-facing `POST /enroll/checkin` (API-key auth).
  - `central/db.js` — SQLite DAL: `central_users`, `facilities`, `sync_state`, `audit`, settings. PBKDF2 admin auth (mirrors facility app); per-facility API keys stored as SHA-256 hashes, plaintext shown once at creation.
  - `central/public/index.html` — minimal org console (login + facility registry + enroll).
  - `central/scripts/smoke.mjs` — end-to-end check: login -> create facility -> node check-in -> verify `last_seen`.
  - First-run admin password: `CENTRAL_ADMIN_PW` env, else random (printed once).
- **Node side (Connect to HQ) — DONE.** Settings keys seeded in `db.js`; `/api/central/connect|checkin|disconnect|status` added to `server.js` (outbound-only, self-signed-TLS opt-in, full key never returned to clients); "Central / HQ Connection" card added to Admin → System. Verified: `node --check` (all files), client build (847 KB), `npm test` (26 pass), and the Phase 0 E2E.
- **Phase 1 — COMPLETE & verified (E2E exit 0).** One-way sync = offsite backup, working end-to-end.
  - Facility `db.js`: `sync_outbox` + AFTER INSERT/UPDATE/DELETE triggers on 21 operational/clinical tables (`SYNC_TABLES`); `recursive_triggers=ON` so FK cascade deletes propagate. Helpers: `enqueueSyncBackfill`, `getSyncBatch` (photos inlined to base64), `markSynced`, `outboxPending`, `pruneOutbox`, `clearOutbox`.
  - Facility `server.js`: in-process sync agent (`syncTick`) on a 20s timer + after-connect + `/api/central/sync-now`; batches of 50, up to 20 batches/tick; standalone (no HQ) keeps the outbox bounded; identity/config/settings intentionally NOT synced.
  - Central: generic `facility_data` JSON store keyed by `(facility_id, table_name, source_id)` — schema-agnostic; `POST /sync/ingest` (idempotent upsert/delete, advances `applied_through`); `GET /api/facilities/:id/stats` and `/rows` (admin; feed Phase 2 reporting).
  - Admin → System card shows pending count + last-sync + a **Sync now** button.
  - E2E verified: backfill, live insert/update/delete, multi-table, `applied_through` advance, disconnect clears outbox. Regression: `npm test` 26/26, build 848 KB.
- **Phase 2a — COMPLETE & verified (E2E exit 0).** Cross-facility reporting. HQ console gained an Overview dashboard (org tiles + per-facility table) over `facility_data` via `reportOverview()` (json_extract aggregate counts); `GET /api/report/overview`. HIPAA: counts only, no PHI (E2E asserts no resident names leak).
- **Phase 2b — COMPLETE & verified (E2E exit 0, 20 assertions).** Central user management, **opt-in** (`central_manages_users`, default off → zero change to existing facilities).
  - HQ: `managed_users` + `managed_user_facilities`; admin CRUD + assignment; `GET /sync/users` (facility-key) returns assigned active users with initial PBKDF2 credential. Console "Users" tab.
  - Facility: opt-in pull (on toggle / connect / 20s tick / on-demand) → `applyManagedUsers()` provisions into local `users` with `central_managed`/`central_uid`. **Safety rails:** never touches local (non-managed) accounts, never removes the last admin, HQ master for identity+role (role→local `ROLE_PRESETS`), **facility owns the password after first change** (pull never overwrites hash). Disconnect keeps real accounts (no lockout).
  - Decision recorded: central-master + local break-glass + offline-usable; true shared-password SSO deferred (future opt-in).
- **Phase 3 — COMPLETE & verified (E2E exit 0, 17 assertions).** Fleet health + update coordination. `updater.js` deliberately untouched (it live-swaps the running server — too risky to rework here).
  - HQ: `fleet_target_version` + `GET/POST /api/fleet/target`; target served in checkin + ingest responses. `reportOverview` gained per-facility `version` / `online` / `dark` (>15 min) / `behind`, and org totals `online` / `dark` / `on_target`.
  - Facility: heartbeat — `syncTick` now always sends ≥1 ingest (even empty) so liveness + target refresh even with nothing pending; stores `central_target_version`; status exposes `target_version` / `current_version` / `update_available`.
  - HQ console Overview: version column, gone-dark highlighting, "On target" / "Gone dark" tiles, fleet-target control. Facility Admin shows "HQ target version" + behind hint beside the existing Software Updates flow.
  - **Deferred (documented):** HQ-hosted binary distribution (needs careful work on the security-critical updater allowlist + signed bundles) and Phase 4 two-way editing (§6 — pending a concrete need).
- **HQ admin accounts — COMPLETE & verified (E2E exit 0, 26 assertions).** Self-service password change, forced change-on-first-login (seeded admin is flagged `must_change_pw`), and multi-admin management on the HQ console.
  - HQ: `central_users` CRUD — `GET/POST /api/central-users`, `POST /api/central-users/:id/password` (admin reset → re-flags must-change), `DELETE /api/central-users/:id`. **Lock-out rails:** cannot delete yourself or the last remaining admin. **Server-side teeth:** `requireAdmin` blocks every admin API except the password change itself while `must_change_pw` is set (not just UI-gated).
  - Console: header "Change password" action, forced change-password view (no Cancel until done), new "HQ Admins" tab (add admin / reset password / delete). HQ admins log into the console only — they never sync to any facility (distinct from managed_users).

---

## 11. Status: Phases 0–3 COMPLETE

All planned phases are built, verified (per-phase E2E + `npm test` 26/26 + client build), committed, and pushed to `origin/master`. The fleet now: runs offline-first per facility, continuously backs up to an on-prem HQ, reports cross-facility aggregates (no PHI), optionally accepts HQ-managed user accounts (opt-in, with local break-glass), and coordinates a target version. **Phase 4 (two-way / central editing) remains deferred** until a concrete need exists, since it's the only part requiring real conflict resolution.
- **Lint note:** repo carries ~63 pre-existing eslint errors (`react-hooks/*`) in untouched tab files; new code matches existing in-file conventions. `node --check`, `npm test` (26), client build, and per-phase E2Es are the enforced gates.
