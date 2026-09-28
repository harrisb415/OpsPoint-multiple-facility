# OpsPoint Changelog

---

## Unreleased — Anyone can conduct a UA (2026-09-28)

### Changed

- **Every role records UA results** (`ua.record`). It is in every role preset, and existing
  installs grant it once to every group, custom ones included, on the first start. An
  admin can still remove it from a group; it is not re-added.
- **Saving a UA is one request that `ua.record` covers.** `POST /api/ua-records` with
  `log_time` now writes the UA's line in the open shift log and stamps the resident's last
  UA itself. The form used to send those in a separate request that needed `log.add` and
  `ua.request`. So a PA (no `ua.request`) got "Permission denied" on Save, and a case
  manager (no `log.add`) would have too. The server builds the line from the record's
  fields, in the same wording as before, so this is no way to write arbitrary log entries.
  With no open report the UA is saved without a line, as before.
- The Report tab's 🧪 UA quick button shows only to people who can record UAs.

---

## Unreleased — Notification bell: Conduct UA, past 24 hours (2026-09-28)

### Added

- **Conduct UA** next to Ack on each UA request in the bell. It acknowledges the request,
  which clears it for everyone, and opens the UA form with that resident filled in and
  locked. Staff who can record UA results (`ua.record`) see it; everyone else keeps Ack.
- **Past 24 hours** at the bottom of the bell. UA requests acknowledged in the last day show
  there with who acknowledged them, for everyone who sees UA requests. Anything a person
  dismisses with ✕ (UA draws, pass extensions, infraction counts, incidents,
  announcements) shows there for them for a day. The browser keeps only a reference to
  each dismissal, never a name, and the row is drawn from current data.
- `GET /api/ua-requests/recent`: requests acknowledged in the last 24 hours.

### Fixed

- The bell showed a UA request's age wrong on SQLite installs: `requested_at` is local time
  there and was read as UTC.

---

## Unreleased — Mobile app: "For you", quick actions, PIN unlock (2026-09-28)

Step 4 of the mobile rewrite.

### Added

- **"For you" on Home.** A list of what this person can act on now, built on the server from
  their permissions: passes due back or late, residents leaving on an approved pass today,
  UA requests, infractions to review, consequences to carry out, mail to approve or deliver,
  chores not yet signed off (skipping anyone away), milestones due within a week, open
  incidents, consents expiring within two weeks and treatment plan reviews due. Each group
  appears only with the permission that acts on it. Most rows can be done from the phone
  (Returned, Acknowledge, Review, Done, Checked out, Delivered, Approve, Sign off); incidents,
  consents and plan reviews are headlines to take to the desktop. Every button calls an
  endpoint the desktop already uses.
- **Quick actions.** Random UA draw (same pool and 30-day skip as the desktop), log an
  infraction, send an announcement, each shown only with its permission.
- **Actions on the resident card:** extend a pass, mark returned, log an infraction.
- **Unlock with a PIN** (More → Signing in). After the idle sign-out, a phone can sign back in
  with a 6-digit PIN instead of the password. The PIN only works together with a random
  token that phone holds in an httpOnly cookie, so a PIN seen over a shoulder is useless on
  any other device, and only hashes are stored. Five wrong PINs switch it off. It also ends
  on signing out, a password change or reset, losing mobile access, or 30 days unused.
  Unlocks share the login rate limit, and setup, unlocks and failures go to the audit log.
  Patterns (`123456`, `111111`, `121212`…) are refused.

### Changed

- Signing out on purpose (desktop, classic or new mobile) also switches off that phone's PIN.
  The idle sign-out doesn't, so the PIN can be used after it.
- Bottom sheets in the mobile app leave the tab order and screen-reader view while closed,
  and move focus in when they open.
- Tests allow 60 seconds per test: each test account is a real 600,000-round password hash,
  and on a busy machine setting several up could pass Jest's 5-second default.

### Database

- New table `device_pins` (one row per phone with a PIN). Postgres:
  `migrations/pg/008_device_pins.sql`, applied before restarting; SQLite creates it itself.

---

## Unreleased — Mobile app: residents, staff directory, announcements (2026-09-27)

Step 3 of the mobile rewrite.

### Added

- **Residents tab.** The whole roster with search, status filters and floors; each row shows
  when a resident on a pass is due back and whether a UA has been requested. The census
  tiles on Home open the list filtered to that status.
- **Resident card.** Room, admission date, status; today's pass, chore and mail; last UA
  result and open infractions; and a button to request a UA. Staff with clinical permissions
  also see **clinical headlines, read-only**: treatment plan status and review date, the last
  note's type, date and signature, the last assessment, and the next milestone — never a
  note's content or a plan's goals. Each section needs the same permission its desktop screen
  does, and the server leaves out what the caller can't see. Every card opened is written to
  the audit log as a record read.
- **Staff directory** (More): grouped as on the desktop, with tap to call or text.
- **Announcements** (More): the last week's, for staff who receive them; staff who can send
  them can do it from the phone. The latest shows on Home, with a count of new ones.
- New push alert: **Announcements** — "New announcement from Dana W." and nothing of the
  message itself, which may mention a resident.

---

## Unreleased — New mobile app: rounds, install, push alerts (2026-09-27)

Step 2 of the mobile rewrite. The new app runs alongside the classic `/mobile` page.

### Added

- **A new mobile app at `/m`.** Home (the next wellness check on the desktop's schedule,
  census, latest log entries), Rounds (wellness rounds and walkthroughs), Log and More. It
  follows the facility theme and the phone's own dark mode. A phone that opens it once lands
  there from then on, and More has a way back; the classic page links to it ("New app").
  Its data comes from one small snapshot (`GET /api/m/snapshot`) rather than `/api/data`,
  which carries every resident photo.
- **Wellness rounds kept on the server.** Tap each resident seen or not located. Progress
  survives a reload or a dead zone, and two phones can split the floors of one round.
  Residents away (a pass, hospital, any status but In Building) count as accounted for.
  Finishing writes the usual shift-log line, which now also names anyone not checked; a
  resident not located gets a follow-up that logs when they were found and who reported it.
- **Installable app with push alerts.** Add it to the Home Screen (an iPhone only delivers
  alerts that way). Each phone chooses its alerts: wellness check or walkthrough due (10
  minutes ahead, and when overdue), UA requests, resident not located, pass overdue, pass
  extended, consequence assigned, each only for staff holding the matching permission.
  Alert text never includes a resident's name or room. Signing out turns alerts off on that
  phone.
- New permission `rounds.notify_missing` ("Notification — resident not located"), granted
  to Supervisor and Administrator.

### Changed

- The security policy allows same-origin workers (`worker-src 'self' blob:`); it allowed
  only `blob:`, which blocked the service worker.
- Login honors `?next=` (same-site paths only), so an installed app returns to where it was.

### Deploy notes

- Apply `migrations/pg/007_mobile_rounds_push.sql` before restarting.
- Push keys: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in `.env`. Without
  them a pair is generated once into `data/vapid.json`. Changing the keys cancels every
  phone's alerts.

---

## Unreleased — Postgres audit (2026-09-27)

A full audit of the SQLite → Postgres port: production error logs, a column-by-column schema
diff, a sweep by bug class, and the whole test suite run against a real Postgres database.

### Fixed

- **HQ's facility list, facility detail, update reports and rollouts failed on Postgres** —
  `opscentral.facilities` never got the `upd_*` columns SQLite adds at boot.
  `migrations/pg/006` adds them.
- **Creating a shift report could fail on Postgres** (`reports_pkey`) — the id sequence was
  resynced outside the report's transaction, so it stayed one behind. It now resyncs on the
  transaction's own connection.
- **Postgres timestamps read wrong in the browser** — "time ago" showed NaN, Safari rejected
  them outright, and date/time slices came out in UTC. The driver now returns ISO-8601 UTC,
  and each database session runs in the server's time zone, so the local times the server
  writes mean local time on both sides. Hosted installs must set `TZ` (web-hestia now has
  `TZ=America/Los_Angeles`; the container ran UTC, so server-written log times were UTC).
- **Blank date or number fields returned a 500 on Postgres.** Blanks are now stored empty;
  for a required date (an incident's) the value on file is kept.
- **The server's "today" was the UTC date** — already tomorrow by 5 PM Pacific, so the chore
  log emptied early and consents lapsed hours early. It is the server's local day now.
- **Saving staff categories returned 404** (500 on Postgres): `/api/staff/:id` caught the
  request first.
- **Reset Facility with residents on record** returned a raw database error; now a clear 409.
- Consent disclosure times, mail "logged today" and day grouping, milestone and violation
  dates, and the audit viewer read UTC or failed in Safari; they go through `utils/dates.js`
  now. The audit-log **CSV export** writes local time (it wrote UTC on Postgres).
- **A Postgres install whose `.env` lost `OPSPOINT_DB_DRIVER` booted on a new, empty SQLite
  database** — indistinguishable from total data loss. Both apps now refuse to start, and the
  boot line names the Postgres database actually in use.

### Security

- **`POST /api/data` no longer accepts a resident list.** Given one, it deleted every resident
  not on it, so a single hand-built request from any account with `residents.edit` could empty
  the roster. No screen has sent a list since May 2026 — residents change through the resident
  and room screens — so a request carrying one is now refused (400) before anything is written.

### Added

- `scripts/pg-audit.sh` — runs the whole suite on Postgres, rebuilding a scratch database from
  `migrations/pg/` before each test file. Refuses any database without verify/test/audit/scratch
  in its name.
- `scripts/schema-parity.cjs` — compares the SQLite schema with a Postgres one (the migration
  files, or production); fails on a missing table or column.
- `tests/api.tour.test.js`, `tests/central.tour.test.js` — every module's real flows,
  collecting all failures rather than stopping at the first; run on either driver.

---

## Unreleased — UA test times (2026-09-26)

### Fixed

- **UA test times were stored hours early on Postgres** — the same bug as pass times: the
  Conduct UA dialog sent `tested_at` as local text with no timezone, which Postgres reads as
  UTC (7 hours early in PDT). It now sends an absolute instant.
  `scripts/pg-repair-ua-tested-at.sql` corrects existing records. It only touches rows whose
  test time, read as local time, lands within two minutes before the row's own `created_at` —
  the exact signature of the bug — and writes each correction to the audit log.
- **The UA record's time ignored the dialog's Time field.** The log entry used the entered
  time but `tested_at` was stamped at the moment of saving, so a backdated test (collected at
  8:30, entered at 9:45) left the log and the chain-of-custody record disagreeing. The record
  now uses the entered time (yesterday's date if that time would be more than 30 minutes in
  the future, as for log times).
- **"Time ago" read NaN on Postgres**, and the 24-hour UA-draw window never matched, so the
  UA Draws bell section never appeared; announcements also never became dismissable. The
  bell's parser appended a `Z` to timestamps that already carry `+00`. Now handled by
  `parseServerTime()` (utils/dates.js).
- UA lists sort by the actual instant, and read Postgres timestamps in Safari as well.
- **A positive UA never set the resident profile's "Needs Attention" flag** — it compared the
  result against `'POS'`, but positives are stored as `'fail'`. Likewise the client report
  printed results as bare "fail"/"pass" with no colour, and a "Type" column from a field that
  doesn't exist; it now shows Method and Positive/Negative like the UA tab.

---

## Unreleased — Pass-extension notifications; pass times fixed on Postgres (2026-09-26)

### Added

- **Notification when a pass is extended.** Everyone with the new permission
  `passes.notify_extended` ("Notification — pass extended", under Weekend Passes) gets a
  bell entry — resident, room, the new return time, what it was, who extended it — plus a
  chime, and a toast on Mobile. The entry stays until that person dismisses it or the
  resident is marked Returned; extending the same pass again raises a fresh one.
  Every role starts with the permission: new installs seed it into all four presets, and
  on upgrade it is granted once to **every** group, custom ones included. An admin can
  still remove it per group, and later boots respect that.
- Passes now record the latest extension as data (`extended_at`, `extended_by`,
  `extended_from`) alongside the existing note. Postgres: apply
  `migrations/pg/005_pass_extension_stamp.sql` before deploying; SQLite migrates itself.

### Fixed

- **Pass times were stored hours early on the Postgres deployment.** The pass forms sent
  `datetime-local` values with no timezone; SQLite kept the text and browsers read it as
  local time, but Postgres reads a zone-less timestamp as UTC — so a return entered as
  11:22 PM showed as 4:22 PM (PDT). The client now sends absolute instants. Passes saved
  before this fix keep their shifted times and need re-entering.
- **Opening Edit or Extend and saving moved the time** by the UTC offset, on both drivers:
  the picker was pre-filled with UTC digits. It now shows local time.
- **The extension note was written in the server's timezone** (UTC when hosted), so it
  disagreed with the Passes table for the same pass. It is now written in the browser's.
- Pass dates in the resident profile and client report showed the next day for evening
  passes (they read the UTC date); they now use the local day. `client/src/utils/dates.js`
  reads both timestamp spellings (ISO from SQLite, raw text from Postgres) — plain
  `new Date()` rejects the Postgres one in Safari.

---

## Unreleased — Resident statuses: built-in defaults, Passes owns Weekend Pass (2026-09-26)

### Changed

- **A new facility starts with the four built-in statuses only** — In Building, Weekend
  Pass, Hospital and Out / Other, all of which can be renamed and recoloured but not
  removed. At Work, BHC and EFC are no longer seeded; a facility that wants them adds them
  in Admin → Facility → Statuses. Existing facilities keep their current list.

- **Weekend Pass belongs to the Passes tab.** While the Passes feature is on, it is no
  longer offered in the roster dropdown: a resident goes onto it when their pass is marked
  Out and comes off it when the pass is Returned. Turning Passes off in Admin → Features
  makes it an ordinary hand-picked status again.

- **Every screen, print and export now follows the configured status list.** The DOCX
  export, wellness filing print, Mobile, Archive, Clients, Caseloads and the resident
  profile each carried their own hard-coded copy (with At Work / BHC / EFC columns and
  chips baked in); they now read `client/src/utils/statuses.js`, so an added, renamed or
  retired status shows up everywhere at once.

### Fixed

- **A resident away on pass showed as In Building almost everywhere.** A pass never writes
  a status — it is laid over the stored one — but only the shift report and dashboard
  applied that overlay. Mobile, Clients, Caseloads, the profile, the DOCX export and the
  wellness filing print all read the stored value, and the **UA draw could pick a resident
  who was away on pass**. All of them now read through `effectiveStatuses()`.

- **Closed shifts recorded residents on pass as In Building.** Close Shift saved the
  stored statuses without the overlay, and once the pass was Returned nothing could
  reconstruct it. The overlay is now frozen into the record at close.

- The roster's attempt to hide Weekend Pass keyed on a pass status (`In`) that no longer
  exists, so it never fired; replaced by the Passes-owns-it rule above.

---

## Unreleased — Session-security hardening for the hosted deployment (2026-09-01)

### Security

- **Session cookie now carries `Secure` behind a TLS-terminating proxy.** `cookie.secure`
  was derived at boot from whether *this process* held a certificate. In the hosted
  deployment nginx owns the certificate and Node listens on plain HTTP, so the flag was
  never set and the session cookie was attached to any `http://` request in cleartext.
  It is now `'auto'`, which resolves per-request from `req.secure` and is correct for the
  direct-HTTPS (LAN install) and behind-proxy (hosted) cases alike. The boot-time session
  rebuild that existed only to patch this flag is gone.

- **`trust proxy` is now set (`config.TRUST_PROXY`, default `'loopback'`).** Behind nginx
  every request previously read as `127.0.0.1`, which meant:
  - audit rows recorded the proxy rather than the client, leaving the trail unable to
    attribute access to an origin (45 CFR §164.312(b));
  - the per-IP login limiter degenerated into one shared bucket, so ten failed logins from
    anywhere locked out every staff member for 15 minutes;
  - the 300/min API limiter was likewise global rather than per-client.

  `'loopback'` is self-configuring: forwarded headers are honoured only when the peer is
  loopback (a same-box proxy), so a LAN client with no proxy in front cannot forge its own
  address. nginx must send `X-Forwarded-For` / `X-Forwarded-Proto` for this to take effect.

- **Dependencies patched** — `ws` 8.20.0 → 8.21.3 (GHSA-58qx-3vcg-4xpx uninitialized memory
  disclosure, plus a fragment-based memory-exhaustion DoS), `express` 4.21 → 4.22.2, and the
  `body-parser` / `qs` advisories that came with it. `npm audit` is clean.

- **HSTS** is now sent by nginx (`max-age=31536000; includeSubDomains`), closing the
  plaintext first request that the cookie fix alone would still have allowed.

### Changed

- **Sessions persist in the database** (`server/lib/sessionStore.js`, new `sessions` table)
  instead of express-session's `MemoryStore`, which leaks and empties on every restart —
  including the restart the auto-updater performs to apply an update, which would sign every
  staff member out mid-shift. The store implements the express-session contract over the
  existing connection primitives, so it adds no dependency, and sessions inherit the
  database's SQLCipher encryption at rest. Expired rows are reaped every 15 minutes.

### Tests

- `tests/session.security.test.js` — 9 tests covering the `Secure` flag in both deployment
  modes, forwarded-IP attribution in the audit log, and store round-trip / restart-survival /
  expiry / prune behaviour. Suite is 59/59.

---

## v2.6.1 — Release signing key rotated (2026-08-31)

### Security

- **Release signing key rotated.** The private half of the previously pinned key
  (`X0QuuIYyg9Ev…`) was not recoverable — the `release-private.pem` on the build machine
  derived to the older `FtGFXRfmB1goFWdp…` instead, so no release could be signed at all.
  A new Ed25519 pair was generated and its public half pinned in `updater.js` and
  `central/updater.js`: `T+OjqALSKqG9ZCLj8kON/A1VpxDd3tBDWkWlNn91jY4=`.
  Verified end to end — the new private key derives to the pinned public key and a signed
  manifest round-trips through `verifyManifestSignature`.

  **Consequence for existing installs:** any node still running a build that pins an older
  key will reject updates signed with this one. Such a node has to be brought to a v2.6.1+
  build by other means (git pull and rebuild, or a fresh install) before the updater will
  accept releases again. Installs updated to v2.6.1 need no further action.

- **Central HQ bumped to 0.1.5** with no feature change. The rotation edited
  `central/updater.js`, so the bundle differs from the 0.1.4 already published; the updater
  only offers a release when its version is strictly greater, so republishing changed content
  under 0.1.4 would have left every HQ node reporting "up to date" while still pinning the
  retired key.

### Fixed

- **`tests/updater.signing.test.js` had been failing since the previous rotation.** Its
  positive case used a signature checked into the file, produced with a key that no longer
  matched the pinned one. It now signs with an ephemeral key generated at test time, so it
  cannot go stale, and asserts the pinned key's fingerprint separately — a rotation now
  reports itself as one named failure instead of looking like a broken updater.

---
## v2.6.0 — Facility colour themes, themed modals, pass lifecycle (2026-08-30)

A facility can now pick its brand colour, and that choice reaches every surface rather than
just the sidebar. Plus a reworked weekend-pass flow.

### Added

- **Facility colour themes.** Six: Indigo (default), Blue, Teal, Emerald, Rose and Salvation
  Army. Chosen in **Admin → Facility → Appearance**, stored on the facility record, and applied
  to every signed-in session without a reload — the existing `settings_updated` broadcast
  already refreshes the data the theme rides on. Light/dark stays a separate per-user choice;
  the two are independent.
- **Themes reach the neutral surfaces, not only the brand ones.** The page behind the cards, the
  cards themselves, the top bar, hover fills, hairlines and the Admin panels all follow the
  selected theme. Card headers and the top bar carry the primary *and* accent colour.
- **Salvation Army theme** built from their published palette: SA Red `#ef3e42` (PMS 185),
  SA Blue `#002056`, SA Navy `#132230`. Their red is the accent rather than the primary — it
  sits 4.4° of CIELab hue from the red this app uses for destructive actions, so a Save button
  in it would be indistinguishable from Delete, and it reaches only 3.86:1 behind white text.
- **Three-stage weekend passes.** Approved → Active → Returned, with **Mark Departed** and
  **Mark Returned** replacing the old status dropdown. Mark Departed unlocks ten minutes before
  the scheduled departure. **Extend** opens a modal asking for the new return date and time, and
  the server appends a line to the pass notes recording who moved it and from what, so repeat
  extensions accumulate as history. Extending counts as a status action, so a user with
  `status.edit` but not `passes.edit` can extend without being able to edit pass details.

### Changed

- **Modals match the rest of the app.** Headers carry the same tinted band and display face as
  card headers, and follow the facility theme. Applied through a flowbite `ThemeProvider`
  override, so modals added later inherit it.
- Colour choices are generated and checked rather than hand-picked. `scripts/gen-themes.cjs`
  asserts every theme against seven rules — contrast for buttons, brand text, on-rail text and
  card headers, plus a minimum 25° CIELab hue separation from the destructive reds. Teal and
  emerald carry their ramp one step darker because `teal-600` and `emerald-600` are 3.1:1 and
  3.3:1 behind white button text, under the 4.5 AA floor.

### Fixed

- **The Clinical rail never darkened.** It used `dark:bg-gray-800`, which sets `background-color`
  and so never covered the gradient's `background-image` — it stayed purple in dark mode while
  the app and Admin rails correctly went grey.
- **Leftover v2.1 palette.** Ten sites still carried the old teal `#0a4655` and gold `#c9780c` as
  literal hex. Three were written `text-[#0a4655] dark:text-primary-400`, so light mode rendered
  the old teal while dark rendered the current brand colour.
- **Form controls in dark modals had no contrast against their own panel.** Flowbite's modal
  surface and its text inputs were both `gray-700`, the same value.

---
## v2.5.0 — Encryption at rest, six-year audit retention, scheduled backups, dark rail (2026-08-28)

Security and compliance work from a code-level review of the clinical and records layer,
plus the light-mode redesign.

### Security & compliance

- **Encryption at rest.** The database is now SQLCipher-encrypted via
  `better-sqlite3-multiple-ciphers`. A key is generated on first run (32 random bytes, mode 0600, at
  `data/.dbkey`) and an existing plaintext database is converted in place with `PRAGMA rekey`,
  keeping a `*.pre-encryption-*.bak` safety copy. Backups inherit the same encryption.
  **Key loss is unrecoverable by design — back `data/.dbkey` up separately from the database
  backups.** This does not replace full-disk encryption, since the key lives on the same volume.
  Set `OPSPOINT_ENCRYPT=0` to opt out.
- **Audit retention raised to six years (45 CFR §164.316(b)(2)(i)).** `pruneAuditLog(365)` previously
  ran unconditionally on every boot, silently and irreversibly destroying the audit trail at one
  year against a six-year statutory requirement. Retention is now a setting
  (`audit_retention_days`, default 2190) and `pruneAuditLog()` floors any value at the statutory
  minimum, so a bad setting or caller cannot shorten it. **Rows already pruned on existing installs
  are gone and cannot be recovered.**
- **Scheduled database backups (45 CFR §164.308(a)(7)(ii)(A) — a Required specification).** No
  scheduled backup existed; `data/opspoint.db` was the sole copy of all clinical and audit data.
  New `backup.js` takes dated snapshots on an interval (default every 6h, keeping 28), prunes old
  generations, and audit-logs each run. Snapshots use `VACUUM INTO`, which is atomic against a live
  WAL-mode database and inherits its encryption. Warns when the destination shares a volume with the
  database. Configure with `backup_enabled`, `backup_interval_hours`, `backup_keep`, `backup_dir`.

### Removed

- **Witnessed self-administration (Med Log) removed entirely.** Free-text medication and dose fields
  with no drug dictionary are a transcription-error surface — look-alike/sound-alike pairs such as
  clonidine and Klonopin are a known source of medication error — and the feature sat outside the
  "no medications" scope line the schema already declared. Removes the table creation, CRUD helpers,
  the clinical module's route/service/repository slices, `MedLogTab`, the client-profile and
  client-report sections, the consent disclosure option, and the Central HQ rollup.
  `med.witness` / `med.delete` are dropped from `PERMISSIONS`, so the existing retirement migration
  strips them from users, groups, and profiles on next boot.
  **The `med_administration_log` table is deliberately not dropped** — on an existing install it may
  hold records subject to retention. It is inert; export and drop it manually if wanted.

### Admin → Features

- Rebuilt. The panel listed only 9 tabs and 2 buttons and offered no way to switch off the Clinical
  section at all. It is now grouped to mirror the sidebar with a description per feature, and covers
  everything hideable — adding **UA Draw** and a **Clinical master switch** with per-page toggles for
  all seven charting pages.
- `CLINICAL_NAV` entries carry a stable `key`, so the Admin panel and the clinical rail read the same
  `ui_visibility` keys and cannot drift apart as pages are added.
- Disabling Clinical now also guards the `/clinical` route, not just the sidebar button — a bookmark
  or typed URL no longer walks past the setting.
- Every key defaults to visible, so existing installs are unchanged until something is unchecked.

### Light mode — dark navigation rail

- The shell painted a white sidebar and topbar around white cards on a near-white page, so chrome
  and content sat on the same visual layer — reading as glary and low-contrast at once.
- Navigation rails (main, Admin, Clinical) are now slate-800. The page drops to a soft blue-slate
  (`#e8edf4`) so white cards float; borders firm up slightly; cards, topbar and menus stay white.
- The topbar now matches the page rather than being a second bright slab, and the global search is
  hidden on `/admin`, where residents, rooms and logs do not apply.
- Admin and Clinical rails are pinned to the top of the viewport, matching the main sidebar instead
  of starting below the header.
- Rail scrollbars are slate-toned; light mode previously had no scrollbar styling at all (the
  existing rules are `.dark`-scoped) and fell back to the browser default.
- Login background comes down to the rail family.
- Dark mode is untouched — every CSS rule is scoped to `html:not(.dark)`, and semantic/status colors
  are unchanged throughout.

### Fixes

- **Blank page after a rebuild.** `index.html` was cacheable but names content-hashed assets, so a
  cached copy requested files from a previous build; the SPA catch-all then answered those with
  `index.html`, producing HTTP 200 `text/html` for a `.js` request and a strict-MIME failure rather
  than a plain 404. `index.html` is now served `no-store`, and `/assets/*` or any known static
  extension 404s instead of falling through.
- **Invisible checked checkboxes.** Flowbite's checkbox is `bg-gray-100` with `checked:bg-current`;
  the new light-mode surface override outranked it on specificity, leaving checked boxes pale with a
  near-invisible white tick. The overrides now exclude form controls.

### Documentation

- README gains a **Scope and limitations** section stating plainly that the software implements
  technical safeguards but does not make an organization HIPAA compliant, what it does not do, and
  what remains the operator's responsibility. "HIPAA clinical modules" and the "HIPAA Clinical"
  About tile are retitled — accurate CFR citations in code comments are kept.

---

## v2.4.0 — Backend modular-monolith refactor + UI polish (2026-06-21)

### Backend architecture (no behaviour change)
- **`server.js` decomposed ~2,796 → ~575 lines.** All 15 domains extracted into `server/modules/<domain>/{routes,service,repository}.js` (staff, passes, mail, chores, ua, violations, groups, broadcasts, clients, reports, facility, users, admin, auth, clinical). Each is a clean route → service → repository split.
- **db layer split:** `server/db/connection.js` (the only file that knows it's SQLite — opens the handle + `run`/`query`/`query1`) and `server/db/migrate.js` (schema + column migrations). All SQL now lives in repositories, making a future SQLite→Postgres move cheap.
- **Shared middleware extracted** to `server/middleware/*`: security headers/CORS, CSRF, auth/permission guards, HIPAA idle timeout + force-password, audit + PHI-read audit, login/API rate limiting, clinical record-lock + consent guards. Plus `server/realtime/broadcast.js` (the WebSocket fan-out behind a stable API — the cloud pub/sub seam) and `server/db/reportLog.js` (shared active-report log helper).
- Every domain verified with live end-to-end HTTP tests (real login/session/CSRF); behaviour is byte-for-byte unchanged.

### UI
- **Client photo thumbnails** — resident avatars now show the uploaded photo (rounded thumbnail) everywhere a client appears: Clients, Dashboard, Report roster, and the Mail/Violations/Med Log/Milestones/Incidents/Passes/UA Requests lists.
- **Photo viewers close properly** — the UA photo, chain-of-custody, and client photo pop-out modals can now be dismissed (close button, backdrop click, or Esc).
- **Login dark-mode autofill** no longer flashes a white field.

---

## v2.3.7 — Chores overhaul, archive reorder, session fix (2026-06-11)

### Chores
- **Per-day AM/PM shift selector** — each day chip now has its own AM/PM toggle (stacked vertically). Activating a day defaults to AM; toggle per-day independently
- **Single initials box per day** — chore log cells show one input labeled with that day's assigned shift instead of stacked AM/PM inputs
- **Weekly print grid** — Print List opens a landscape weekly table (Rm / Name / Chore / Mon–Sun) with an initials line per assigned day and greyed-out unscheduled days; prints the currently viewed week

### Passes
- Delete and status changes now call `loadData()` immediately on success — no more stale row until the next WebSocket event

### Report tab
- Fixed: status changes on residents with an active "In" pass were silently blocked by a passOverride that forced "In Building". Now only Out/Extended passes lock the status (to Weekend Pass); In-pass residents are freely editable and the Weekend Pass option is filtered from their dropdown

### Archive
- Reordered both the in-app view and the print output: **Census → Activity Log → Issues & Concerns → Medical Notes → Roster**

### Session
- Fixed HIPAA idle timeout firing during active read-only work (browsing the report, viewing chores). Physical activity (mouse, keyboard, touch, scroll) now resets the idle clock via a throttled heartbeat ping — at most one signal per 5 minutes

---

## v2.3.6 � Facility removal, HQ central v0.1.3 (2026-06-08)

### HQ Central
- **Remove facility** � HQ admins can permanently remove a facility record, its API key, and all backed-up data; a two-step confirm dialog prevents accidental deletion

---

## v2.3.5 � Fleet update system, cross-platform (2026-06-08)

### Multi-facility fleet updates
- **Cross-platform updates** � release bundles are now `.tar.gz` (Linux, macOS, Windows); `tar -xf` extracts on every OS. Added `run.sh` launchers for Linux/macOS. (v2.3.4's `.zip` bundles failed to extract on Linux.)
- **Signed releases** � Ed25519-signed manifests; the in-app updater verifies signature + sha256 + size before applying anything
- **HQ self-update** and **on-prem bundle relay** � facilities pull updates from HQ over the LAN; no internet needed at the buildings
- **Auto-rollback launcher** � a bootstrap supervisor health-checks each update and reverts a failed boot automatically
- **Staged rollouts** � canary ? fleet with health-gated auto-advance and auto-pause on a rollback; opt-in auto-apply with a maintenance window

---

## v2.3.3 � One-Click Auto-Updater (2026-06-04)

### Software updates (Admin ? System ? Software Updates)
- **Check for updates** against a signed release manifest, view the changelog, and **Download & Install** in one click � with a restart confirmation and a live progress bar
- Pull-based and integrity-checked: manifest + bundle fetched over HTTPS from a host-allowlisted source, **sha256 + size verified** before anything is applied
- Apply sequence: download ? verify ? **back up database + current code** ? swap runtime files ? `npm install` only if the lockfile changed ? restart
- Manual rollback via `restore-last-backup.bat`; pre-update database copies retained under `data/backups/`
- `scripts/release.mjs` builds the versioned bundle (prebuilt client), checksums it, and rewrites the manifest

### Notes
- Release bundles are hosted on a separate **public** repo (`opspoint-releases`) so the tokenless updater can reach them; the application source stays private
- Fixed the System tab showing a stale hardcoded version; it now reports the live running version
- Auto-rollback launcher (failed-boot auto-revert) is planned for a future release

---

## v2.3.2 � Structured Clinical Lite & Admin Rebuild (2026-06-04)

### Structured Clinical Lite � new Clinical section
- New `/clinical` area with a left-rail layout: **Clinical Notes, Treatment Plans, Milestones, Assessments, Group Notes, Incident Reports, Discharge Summaries**
- New tables (`migrations/001_clinical_lite.sql`, idempotent): `clinical_notes`, `treatment_plans`, `assessments`, `group_notes`, `group_note_attendees`, `discharge_summaries`
- Draft ? **sign/finalise** workflow; signed records are locked from further edits/deletes
- Five new permissions: `clinical.notes`, `clinical.treatment`, `clinical.assessments`, `clinical.groups`, `clinical.discharge`. Clinical button appears when a user holds **any** clinical-section permission

### Group notes � unified PA ? clinician workflow
- Main **Groups** tab is now attendance-entry only (`groups.log`), writing to the shared `group_notes` record
- Clinician completes and signs the note in **Clinical ? Group Notes** (`clinical.groups`)
- Server strips note content/status from attendance-only role; two-role split enforced server-side

### Incidents & Milestones moved into Clinical
- Both removed from the main sidebar and the Display/Features visibility list � they're now permission-gated inside the Clinical section, eliminating the milestone/treatment-plan double-up

### Milestone ? Treatment Plan soft link
- Treatment-plan goals get stable IDs; a milestone can optionally **advance a specific goal**
- Treatment Plan view shows a per-goal milestone rollup chip; milestone views show **completed date** and **logged date**

### Permission editor � domain grouping
- Reorganised into 6 collapsible domains with tri-state master toggles and granted/total counts; search auto-expands matches
- Added previously-missing permissions: `ua.draw`, `broadcast.send`, `broadcast.receive`; new **Clinical Charting** category

### Admin panel � clinical-rail rebuild
- `/admin` rebuilt to the clinical left-rail layout (Accounts / Facility / Records / System), permission-filtered � replaces the nested top-tabs + sub-tabs
- Panels restyled to the clinical card look: full-width, no boxed `.section` chrome, forms flow into responsive columns
- Facility **Display ? Features**; **Facility Name + Shift Times + Reminders** consolidated into a single **General** page

### Fixes
- Milestone "Custom objective" input no longer disappears on first keystroke
- Milestone logged-date timezone handling

### Tests
- Added clinical unit + integration test suites (`tests/clinical.unit.test.js`, `tests/clinical.integration.test.js`)

---

## v2.3.1 � Scheduled Reminders, Permission Fixes & UI Polish (2026-06-02)

### Wellness & walkthrough reminders � schedule-based
- Reminders now fire at **specific clock times** configured in Admin ? Facility Setup ? Reminders, replacing the old interval-based system
- Cards show "next at 2:00 PM" or "OVERDUE � missed at 1:00 PM"; no cards shown when no schedule is configured
- Dismiss expires when the schedule advances to the next time slot

### Permissions � group stability fix
- Group permissions no longer reset on server restart; boot migration now only adds genuinely new permissions (delta tracking via `known_permissions` settings key), preserving intentional removals

### `mail.deliver` permission
- New gated permission for marking mail as delivered to resident
- Added to admin permission editor (Mail Management), PA/Supervisor/Admin role presets, and MailTab deliver button

### Permission editor � search
- Admin panel group/profile permission editor has a search bar filtering across all categories by key or label

### Admin panel layout
- `/admin` route no longer has a 210 px left indent when sidebar is hidden

### Client report builder � Activity Timeline
- New section option: **Activity Timeline** � log entries from any shift report mentioning the resident by name or room, newest-first with type badge

### About & Login pages
- About page redesigned: compact hero, feature grid, description block
- Version badge added to login page

### DB migration cleanup
- Removed legacy rebrand migration running on every boot (~80 lines)
- Replaced 70-line `_migratePermissions` with 5-line version
- Removed 16 redundant `ALTER TABLE` statements; complete column definitions now in `CREATE TABLE` schemas

---

## v2.3.0 � Client Records, Report Builder & Data Quality (2026-05-31)

### Client profile � Discharge tab
- **Discharge tab** added to client profile drawer (inactive clients only) � surfaces discharge date, reason, days in program, narrative, aftercare plan, and referrals made; previously collected but never displayed
- **Print support** � ?? Print button in the Discharge tab generates a print-ready summary with all discharge records for the client

### Clients tab � quality-of-life
- **Sortable columns** � every column header (Rm, Name, Case Manager, Phone, Intake, Discharge, Status) is clickable; ?/? indicator on active column, faint ? on inactive; default sort by room
- **Discharge immutability** � records lock 24 hours after the discharge date (`discharge_date < today`); locked rows show ?? Record locked instead of a Reactivate button; status column shows ?? Discharged
- **Edit removed for discharged** � Edit button no longer appears on inactive client rows regardless of lock state
- **Reactivate visibility** � Reactivate button is now green (`#15803d`) with white bold text to distinguish it from neutral actions

### Shift report auto-entries
- **Intake log entry** � admitting a new client (`POST /api/clients`) automatically inserts a log entry in the active shift report: `Resident admitted: Name, Rm. 101. Intake: May 18, 2026.`
- **Discharge log entry** � filing a discharge record (`POST /api/discharge-records`) automatically inserts: `Resident discharged: Name, Rm. 101. Reason: Graduate.`
- Both fire only when an active report is open; silently skipped if no report is active

### Custom client report builder
- **?? Report button** in Clients tab header opens the report builder modal
- **Client selection** � active only, all residents (incl. discharged), or hand-pick from a scrollable checklist
- **Section toggles** � 8 sections with gold highlight when active: Basic Info, Emergency Contacts, UA Records, Med Log, Milestones, Incidents, Passes, Discharge Info
- **Record limit** � configurable max records per time-sensitive section (UA/Meds/Incidents/Passes); defaults to 5
- **Print output** � one card per client; teal header with room, name, case manager, day count; each section as a labeled sub-block; print-optimized with `break-inside: avoid`; HIPAA footer

### Med Log � local time fix
- `Log Witnessed Dose` modal now pre-fills the administered-at field with local system time instead of UTC (`getHours()`/`getMinutes()` instead of `toISOString()`)

### Code quality � ESLint (106 ? 66 warnings)
- Removed unused imports (`useCallback`, `Link`, `LayoutDashboard`, `saveData`, `loadData`, etc.)
- Dead initializations fixed (`let subtitle = ''`, `let bodyHtml = ''`, `let text = ''`)
- `obj.hasOwnProperty(key)` ? `Object.hasOwn(obj, key)` in AppShell and Mobile
- `useMemo` deps `[data?.ui_visibility]` ? `[data]` in AppShell, Dashboard, ReportTab
- Empty `catch {}` ? `catch { /* empty */ }` across all tabs and utilities
- `([_, v]) =>` ? `([, v]) =>` in UARequestsTab (standard skip pattern)
- Removed dead state (`reports`/`setReports` in Mobile, `hasReminderAlert` in ReportTab, unused `key` in ChoresTab, dead `fmtDT` in ViolationsTab)

---

## v2.2.0 � Jewel Teal Design System & UI Polish (2026-05-31)

### Design system � Jewel Teal + Warm Gold
- **Full palette reskin** � new jewel teal (`#0a4655` sidebar, `#106f88` links/active) and warm gold (`#c9780c` accent, `#fcc858` hero numbers) replaces the flat clinical teal
- **Header** � teal gradient (`135deg #106f88 ? #0a4655`); OpsPoint | Facility branding with logo ring; pill nav buttons (File Walkthrough, File Wellness, Email, Announce) with gold icons; gear settings dropdown
- **Sidebar** � gradient background; user identity card pinned at top of sidebar (above nav groups, always visible); gold glowing active-item rail; UA Draw moved into Health & Compliance group
- **Page background** � teal-tinted gradient wash (`var(--grad-page)`)
- **Section heads** � `#eaf3f6` raised surface, teal-700 text, gold dot
- **Census cards** � only Total tile gets teal gradient fill + gold number; other tiles plain white
- **Report hero band** � teal gradient header band for shift report title with eyebrow, date/range meta, and action buttons; New Report gated to closed-shift state only
- **Auth page** � teal gradient card top with gold radial glow

### Layout fixes
- **Tab full-width** � `.app-content` now uses `flex: 1; min-width: 0` to properly fill the flex-row parent; all tabs (Clients, Staff, etc.) render at full width
- **Scrollable About page** � fixed `min-height: 100vh` on `.app-content` (grew to fit content, preventing child scroll); changed to `height: 100%`; About page outside AppShell fixed separately with `height: 100vh; overflowY: auto`
- **Sidebar scroll** � sidebar outer container uses `overflow: hidden`; only `.sidebar-body` scrolls; user card stays locked at top

### Input & focus improvements
- **Global focus ring** � all `input`, `select`, and `textarea` elements show gold glow (`border-color: var(--gold-500)`, `box-shadow: var(--glow-gold)`) on focus; `!important` used to override inline border styles consistently
- **Global input normalization** � bare inputs (no `.field` wrapper) now get a visible `1px solid var(--border-light)` border and `outline: none` base style
- **EHR/Compliance textareas** � previously had no visible border; resolved by global base rule

### Admin panel
- **Display settings** � TAB_OPTS updated to match current sidebar: added Med Log, Milestones, Incidents, Consents; corrected labels (Staff not "Staff Directory", UA not "UA Log"); removed "Violations / Violations" duplicate
- **Tab contrast** � top-level tabs now use teal-600 underline and teal-700 active text; SubTabs redesigned with teal-200 border, raised-bg fill for active, transparent inactive; fixed bug where both active and inactive had identical `borderColor: var(--line)`

### Other
- **CSS encoding** � replaced mojibake box-drawing characters (`�"�`, UTF-8 re-encoded from CP1252) with plain ASCII hyphens; file re-saved as UTF-8 without BOM
- **Section head meta consistency** � removed inline color overrides from Report/Census/Log count spans; all fall through to unified `color: var(--text-muted)` CSS rule
- **Version label** � removed "React Edition" label from About page

---

## v2.1.0 � HIPAA Clinical Modules & Clinical Teal (2026-05-28)

### HIPAA clinical modules
- **UA Records** � full result records linked to shift log entries; photo attachment on each record; table view with filters and export
- **Witnessed self-administration log** � per-resident log of witnessed medication self-administration events; links to log entries
- **Milestone tracker** � configurable milestones per resident; track completion dates and staff notes
- **Behavioral incident reports** � structured incident forms (type, severity, narrative, follow-up); review workflow; notification bell integration
- **Discharge records** � discharge summary with reason, destination, and follow-up fields; links discharged clients to their record history
- **42 CFR Part 2 consent & disclosures** � consent form tracking per resident; disclosure log for SUD-related record releases; re-disclosure warnings
- **HIPAA technical safeguards** � full audit log (actor, action, target, IP, timestamp); audit log viewer in Admin panel; log pruning on schedule

### Design system � Clinical Teal
- **Tailwind CSS v4** � installed `tailwindcss` + `@tailwindcss/vite`; `vite.config.js` updated; no `tailwind.config.js` needed
- **Clinical Teal palette** � `@theme {}` tokens: sidebar `#134e4a`, topnav `#0f766e`, accent `#0d9488`, page background `#f0fdf9`; all semantic CSS classes rewritten to teal
- **Legacy CSS vars preserved** � `:root` vars (`--dark`, `--crimson`, `--mid`, etc.) remapped to teal equivalents so inline JSX styles continue working without changes
- **Activity log table** � restructured from a flat div list to a `TIME | TYPE | DETAILS` table; color-coded `LOG_TYPE_STYLE` badges per entry type (Wellness, UA, Walkthrough, Violation, etc.)
- **Header buttons** � File Walkthrough, File Wellness, Email buttons now render as clean white-bg teal-text pills (`.btn-outline`) against the teal topnav

### Bug fixes
- **UA records photo button showed "�" on all records** � `db.run()` public wrapper was not returning the SQLite statement result; `lastInsertRowid` was inaccessible, so `log_entry_id` was never stored; fixed by adding `return` to the wrapper
- **Dismiss ? button not visible on UA requests** � button was gated on `ua.acknowledge` only; users with `ua.record` (Administrators) could not see it; fixed to `(canAck || canRecord)` on frontend
- **403 Forbidden when conducting a UA** � `POST /api/ua-requests/:id/acknowledge` only accepted `ua.acknowledge`; conducting a UA should auto-acknowledge the request; fixed with `requireAnyPermission('ua.acknowledge', 'ua.record')`

### Branding
- Removed all references to prior organization names from all source files; replaced with generic facility-name-from-settings pattern
- Login footer, About page, and AppShell header updated

---

## v2.0.0 � React Edition (2026-05-23)

Complete rewrite of the OpsPoint frontend as a React SPA (React 18 + Vite + React Router v6), deployed alongside the existing Express/SQLite backend. All v1.x features are carried forward; the database schema and API are fully backward-compatible.

### Architecture changes
- **React 18 SPA** � frontend rebuilt with React 18, React Router v6, and Vite; served from `client/dist/` by Express
- **better-sqlite3** � replaced in-memory `sql.js` with `better-sqlite3`; writes are synchronous and go directly to `data/opspoint.db` (no flush-to-disk step)
- **Context providers** � `AuthContext` manages session state; `DataContext` manages all app data, WebSocket connection, and real-time sync
- **No more `window.SESSION` injection** � auth state is fetched from `GET /api/me` and held in React context
- **Vite build** � `cd client && npm run build` outputs to `client/dist/`; must be run after any frontend change

### New features
- **Client photo popout** � clicking a client photo thumbnail in the Clients tab opens a full lightbox, matching the existing UA photo popout
- **Vacant and special rooms in Clients tab** � all rooms now visible: vacant rooms shown with a muted empty-room style; special rooms shown with amber badge and special label; "Assign Client" shortcut on vacant rows
- **About page** � link added to desktop header; page gated behind `requireAuth` (authenticated users only); shows version, features, tech stack, and org info

### Permission changes
- **`mobile.full` retired** � permission removed from the system; all existing users, groups, and profiles are automatically migrated to strip it on startup; `mobile.access` remains and gates the mobile interface
- **Mail, UA Log, and Infractions tabs** � tab visibility now controlled solely by Facility Setup display settings; no longer double-gated by group policy

### Bug fixes
- Client photo `src` fixed � `getAllData()` returns base64 data URIs; template was prepending `/` making an invalid URL
- Mobile scroll fixed � `body { overflow: hidden }` global CSS required proper flex chain (`overflow-y: auto` on `flex: 1` child) rather than `position: fixed` scroll
- `/about` route moved inside `AuthGuard` � previously accessible without authentication on the React router side

---

## v1.15.0 � Mobile-Full Overhaul, Permissions & Pagination (2026-05-09)

### Permissions
- **`mail.delete` permission** � new permission key separates mail record deletion from `log.delete`; configurable per user in Admin ? Permission Profiles; `DELETE /api/mail/:id` now requires `mail.delete`
- **Permission profiles persist across restarts** � added `known_permissions` DB setting to track which permissions existed on last boot; profiles now only receive genuinely new permission keys rather than being reset to role presets on every startup
- **Default role presets reworked** � monitor, supervisor, admin, and case_manager presets updated to reflect actual operational needs

### UX � Pagination
- **Report archive** � paginated at 20 per page (`#archive-pager`)
- **Delivered mail** � paginated at 25 per page
- **Returned passes** � paginated at 25 per page (`#returned-passes-pager`)
- **UA records** � paginated at 50 per page (`#uar-pager`)
- **Discharged clients** � paginated at 50 per page (`#client-pager`)
- Shared `_spPager()` helper in `app.js` generates prev/next controls with entry range display

### mobile-full � Feature changes
- **Passes tab** � converted to read-only; shows **Approved Passes** and **Returned** sections matching desktop layout; In/Out/Returned badge colours match desktop exactly; add/edit/delete removed
- **Chores tab** � converted to read-only; client name is now the primary label with chore name, time slot badge, and today's completion status (initials) clearly shown below; interactive checkbox removed
- **Reports tab** � "More" (?) renamed to "Reports" (??); UA system and incoming mail features removed; shift report archive is now the sole content, with caseloads also removed

### mobile-full � Bug fixes
- **Staff phone not rendering** � field was referenced as `phone1` throughout; corrected to `phone` in `renderStaff()`, `openStaffSheet()`, and `saveStaff()`; live-render fixed by re-fetching `GET /api/staff` after successful save instead of relying on sparse PUT response
- **Pass status comparisons** � filter/render used lowercase `'out'`/`'returned'` which never matched DB values (`'Out'`/`'In'`/`'Returned'`); all comparisons and select values corrected
- **Client edits not syncing to desktop** � `saveClient()` was calling `PATCH /api/data` which doesn't handle client updates; fixed to `PUT /api/clients/:id`, which saves to DB and broadcasts `data_saved` to all connected clients
- **Field name mismatch** � `admit_date` used in `openClientSheet()` and `saveClient()`; corrected to `intake_date` to match DB schema
- **Chore save failing** � `toggleChore()` used `method:'POST'` on `/api/chore-log` but server only exposes `PUT`; corrected HTTP method

---

## v1.13.3 � Polish & Bug Fixes (2026-05-05)

### UI
- **Custom app icon** � new OpsPoint icon: dark green rounded square, white circular shift arrow, gold diamond centre point; replaces the generic placeholder
- **Favicon** � icon shown in browser tab on all pages (login, desktop, mobile, admin, facility)
- **Apple touch icon** � icon used when adding any page to iOS or Android home screen
- **Login page** � icon replaces the "OpsPoint" wordmark heading
- **Desktop header** � icon displayed inline to the left of the facility name
- **Mobile header** � icon displayed to the left of the title/subtitle block

### Bug fixes
- **Favicon auth redirect** � `/static/icons/` is now served without authentication; previously the browser's automatic favicon request was intercepted by `requireAuth`, which saved the icon URL as `returnTo` and redirected users to the raw PNG after login
- **PWA manifest scope** � `<link rel="manifest">` removed from desktop pages; it belongs only on `mobile.html` (the manifest sets `start_url=/mobile.html` and `display=standalone`); having it on desktop pages caused Chrome to launch the app as a mobile standalone PWA
- **`/index.html` 404** � `GET /index.html` now redirects 301 to `/`

### Docs
- **Deployment guide** � corrected monitor role description (monitors can create reports and edit staff, passes, chores, and pass notices)
- **README, CHANGELOG, docs/DEPLOYMENT.md** � added for v1.13 / v1.13.2 release

---

## v1.13.2 � Security Hardening (2026-05-05)

### Security fixes
- **CSRF protection** � all 30 state-changing API routes now verify the `Origin` header against the server's own host; cross-origin writes are rejected with 403
- **Session fixation** � `session.regenerate()` called on every successful login so the pre-login session ID is never reused post-authentication
- **Stored XSS** � `r.shift`, `r.mod_name`, `r.room`, `r.client_name`, and `r.requested_by` now HTML-escaped before insertion into `innerHTML` in the archive renderer and UA request banner (`sync.js`)
- **Stored XSS** � walk area names escaped via `mesc()` before `innerHTML` in mobile `renderWalk()`; room number sanitized to alphanumeric in inline `onclick` handler
- **Session secret permissions** � `data/secret.key` now written with mode `0o600`; `chmodSync` applied on Unix after creation
- **Rate limiting expanded** � `POST /api/data` and the self-service password-change endpoint now count against the 300-req/min per-IP limit (previously only `GET /api/data` was covered)
- **Roster wipe prevention** � `POST /api/data` ignores a `clients: []` payload; an empty array no longer triggers deletion of all client records
- **Photo size cap** � UA photo uploads and client photos capped at 4 MB; oversized payloads rejected with 400 before magic-byte validation
- **Input length limits** � server-side maximums enforced: names 200 chars, phone fields 30 chars, notes 2000 chars, categories 100 chars, pass notice 1000 chars, pass notes 500 chars, facility name 200 chars
- **CSP hardened** � `'unsafe-eval'` removed from `script-src`
- **SRI hash added** � JSZip CDN script tag now includes `integrity="sha384-..."` to guard against supply-chain compromise
- **XSS in `tabEsc()`** � single quotes now escaped (`&#39;`) in the shared HTML-escape helper in `tabs.js`
- **`credentials:'include'`** � added to all 12 `fetch()` calls in `tabs.js` that were missing it
- **Rate limiter state** � login attempt counters kept in-memory only; IP addresses no longer written to the `settings` table
- **Random seed passwords** � first-run default credentials are now cryptographically random 16-character passwords printed to the server console; hardcoded `Admin@123` / `Super@123` / `Monitor@1` removed from source
- **`/about` page** � now calls `inject()` so `window.SESSION` is available consistently with all other pages
- **`X-Powered-By`** � suppressed via `app.disable('x-powered-by')`
- **CSRF on logout** � `/logout` now validates `Origin` header before destroying session
- **`tabEsc()` single-quote escape** � added `&#39;` replacement to prevent attribute-context injection in print views

### Bug fixes
- UA photos now load correctly from the UA Records tab in the admin panel (was fetching `/true` � a boolean sentinel coerced to string)
- UA photo viewer in the main app and UA report tab now detects the server sentinel (`true`/`1`) and fetches the real image from `/api/log/:id/photo`
- `db.upsertReport` no longer overwrites a real photo filename with the sentinel value `true` on desktop save
- Mobile horizontal overflow fixed (`overflow-x:hidden` on `html,body`)
- Mobile header no longer clips the Out button and live-dot at narrow widths; username moved to its own subtitle line
- Footer no longer pinned to the viewport; sits at the bottom of scrollable content

---

## v1.13.1 � Security Hardening Batch 1 (2026-04-xx)

### Security fixes
- **PBKDF2 upgraded** to SHA-512 at 600,000 iterations; legacy 100k hashes accepted on login and re-hashed on next password change
- **Password policy enforced** � 8+ chars, uppercase, lowercase, digit, symbol required for all password changes
- **Login CSRF** � `Origin` header validated against `Host` on `POST /login`
- **Rate limiting** � 10 login attempts per 15-minute window per IP, persisted across restarts; 300 API requests/min per IP
- **Safe redirect** � `returnTo` validated to be a relative path before redirect after login
- **Session hardening** � `HttpOnly`, `SameSite: lax`, 12-hour expiry; switches to `Secure` when TLS is active
- **CSP** � scoped Content Security Policy header; wildcard `default-src` removed
- **IDOR on UA photos** � upload endpoint verifies log entry exists and belongs to an open report before accepting photo
- **Magic-byte validation** � client photos and logos validated as JPEG/PNG/GIF/WebP before saving to disk
- **XSS prevention** � `esc()` helper added; substance codes, walkthrough areas, and log entry text escaped before HTML insertion
- **Stale login attempt cleanup** � expired rate-limit keys removed from DB on window expiry
- **`/about` and `/manifest.json`** � gated behind `requireAuth`
- **Constant-time invalid-user response** � dummy PBKDF2 run on unknown username to equalise timing

### UX additions (v1.13 continuation)
- Left icon sidebar stays fixed while content scrolls
- "Other" category in Add Staff modal allows free-text entry
- "CM Request" UA reason shows a case manager name field
- Staff modal correctly pre-fills custom categories when editing

---

## v1.13 � Feature Release (2026-04-xx)

### New features
- **Staff Directory tab** � add, edit, delete, and filter staff contacts by category; category management
- **Chores tab** � assign daily chores to residents; log completions with initials; print chore sheet
- **Weekend Passes tab** � create and manage resident passes; mark as Out / Extended / Returned; pass notice board; print pass sheet
- **Caseloads tab** � per-case-manager resident list; print caseload sheet
- **UA Request system** � supervisors can flag a resident for UA from mobile or desktop; banner notification for on-duty staff
- **Role-based UI** � monitors see read-only views on extended tabs; edit controls hidden by role
- **Green theme** � full green/gold colour scheme toggle on both desktop and mobile
- **Real-time chore log sync** � chore completions broadcast to all connected clients
- **Facility setup page** � room/roster management, walk area configuration, UA panel configuration, wellness/walk schedule

### Architecture
- `tabs.js` added for extended module rendering (Staff, Chores, Passes, Caseloads)
- `sync.js` extended with `passes_updated`, `pass_notice_updated`, `ua_request`, `settings_updated` WebSocket handlers
- Server routes added for staff, passes, chores, pass notice, UA requests, facility settings, and room management
- `ua_requests` table added to schema

---

## v1.12 and earlier

See prior release notes. Core shift report, wellness check, walkthrough log, census, DOCX export, and mobile status-update functionality established in v1.0�v1.12.
