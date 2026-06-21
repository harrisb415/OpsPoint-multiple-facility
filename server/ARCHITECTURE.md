# Server architecture — modular-monolith refactor (Part A)

Goal: turn the two god-files (`server.js` ~2.8k lines / 147 routes, `db.js`
~1.9k lines) into a **modular monolith** — feature modules with a clean
route → service → repository split — without changing behaviour, and while
leaving the seams the eventual cloud migration needs.

**Not** microservices. One deployable process; clear internal boundaries.

## Target layout

```
server/
  config.js              ← env-driven config (the only file that knows disk paths/knobs)   ✅ DONE
  lib/
    crypto.js            ← hashPw / verifyPw / validatePw                                   ✅ DONE
    time.js              ← nowLocal / timeToMins                                            ✅ DONE
    net.js               ← getLocalIP                                                       ✅ DONE
    text.js              ← validTime / sanitizeText                                         ✅ DONE
  realtime/
    broadcast.js         ← setWss + broadcast (cloud seam → swap for Redis pub/sub later)   ✅ DONE
  middleware/            ← security.js (headers+cors), csrf.js, auth.js (requireAuth,
                           requirePermission(+Any), userPerms), session.js (idle +
                           force-pw), audit.js, rateLimit.js                                ✅ DONE
  db/
    connection.js        ← opens the DB + run/query/query1; the ONLY file that knows SQLite ✅ DONE
    migrate.js           ← schema (createSchema) + ALTER-TABLE migrations                   ✅ DONE
  modules/               ← one folder per domain; each = routes.js + service.js + repository.js
    staff/ ✅  passes/ ✅  mail/ ✅  chores/ ✅  ua/ ✅  violations/ ✅  groups/ ✅
    broadcasts/ ✅  clients/ ✅  reports/ ✅   (reports = the core /api/data engine)
    facility/  users/  admin/  clinical/  auth/                                              ⬜
  storage/
    photoStore.js        ← put/getUrl interface (cloud seam → swap local disk for S3/GCS)   ⬜
  app.js                 ← express wiring / composition root (was the top of server.js)     ⬜
```

## The three layers (per module)

- **routes.js** — HTTP only: validate input, call the service, shape the response.
- **service.js** — business logic. No SQL, no `req`/`res`. This is what becomes
  unit-testable and what could be lifted out *if* a real scaling need appears.
- **repository.js** — the only place that writes SQL. **Migrating SQLite→Postgres
  touches repositories and nothing else.** That discipline is the whole payoff.

## Cloud seams already in place

- `realtime/broadcast.js` — ~75 call sites call `broadcast({...})`; the transport
  is swappable to a pub/sub backplane for multi-instance deploys.
- `config.js` — every path/secret/knob reads from env with the old hard-coded
  value as fallback, so single-box installs are byte-for-byte unchanged.
- (planned) `storage/photoStore.js` — local-disk photo I/O behind an interface so
  blobs can move to object storage.

## Migration order (incremental, each independently shippable + verified)

1. ✅ **Foundation** — config + lib/* + realtime/broadcast. Pure extraction,
   zero behaviour change. Verified: `node --check`, unit smoke test, full
   `require('./server.js')` module-graph load (guarded by `require.main`).
2. ✅ **Middleware module** — auth/csrf/audit/idle/force-pw/rate-limit/security
   extracted to server/middleware/* (they require the `db` singleton directly).
   server.js imports them with the same names (`userPerms` aliased `_userPerms`).
   Session bootstrap (buildSession/_sessionMiddleware) stays in the composition
   root — its cookie.secure flag is rebuilt after TLS is known. Verified via
   isolated module-graph load + guard/rate-limit assertions.
3. 🟡 **db/ split** — `migrate.js` ✅ DONE (`createSchema`/`runColumnMigrations`).
   `connection.js` ✅ DONE (owns `new Database` + WAL/FK pragmas + run/query/query1;
   db.js's `_run`/`_q`/`_q1` delegate to it; db.js keeps a local `_db` handle for
   its not-yet-extracted direct `.transaction`/`.prepare`/`.exec` calls).
   Remaining: per-entity repositories ⬜ (move the SQL out of db.js domain by
   domain, each importing `connection` instead of touching the handle).
4. 🟡 **Domain modules** — extracted so far: **staff ✅, passes ✅, mail ✅,
   chores ✅, ua ✅, violations ✅, groups ✅, broadcasts ✅, clients ✅,
   reports ✅** (reports = the core /api/data engine + log/report delete + UA
   photo; clients = POST/PUT/profile resident routes, facility-rooms still inline).
   FOLLOW-UP now unblocked: mail/groups/clients repos hold temporary
   getActiveReportId/insertLogEntry/touchReport copies for the active-report log
   entry — those can now delegate to reports/repository and the dupes deleted.
   (each route→service→repository;
   `routes.register(app)` keeps Express precedence identical; each verified with a
   dedicated end-to-end HTTP test — staff 24, passes 20, mail 21, chores 17,
   ua 23, violations 23, groups 18 assertions). Two shared helpers were promoted
   into middleware along the way: `apiRateCheck` → `middleware/rateLimit.js`,
   `auditRead` → `middleware/audit.js`. Remaining domains: reports, clients,
   broadcasts, users, facility, admin, clinical, auth — one at a time, each
   verified before the next. Conventions: repo imports `server/db/connection`
   (never the handle directly); service throws `Error` with `.status`; routes do
   audit + broadcast; settings k/v reads mirror `db.getSetting` (JSON-parse w/ raw
   fallback). Cross-domain SQL (e.g. consolidated active-report log entries) and
   already-abstracted db.js helpers sit in the consuming module's repo, isolated +
   commented, until their own domain is extracted.
5. ⬜ **storage/photoStore** — interface + local impl (cloud impl later).
6. ⬜ **Frontend** — `client/src/api/*` client layer; consider TanStack Query to
   retire the manual DataContext + WebSocket merge.
7. ⬜ **Monorepo workspaces** — dedupe the auth/csrf/session/WS/updater currently
   duplicated between the facility app and `central/` (HQ control plane).

## Rules while refactoring this codebase

- `db.run()` must return its result (for `lastInsertRowid`).
- Server always re-reads permissions from the DB — never trust `session.permissions`.
- Verify after each increment: `node --check server.js` + isolated module-graph
  load (`OPSPOINT_DB`/`OPSPOINT_DATA` pointed at a temp path) + `cd client && npm run build`.
