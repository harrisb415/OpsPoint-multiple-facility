# OpsPoint Changelog

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
