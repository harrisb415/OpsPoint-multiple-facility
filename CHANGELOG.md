# OpsPoint Changelog

---

## v2.2.0 — Jewel Teal Design System & UI Polish (2026-05-31)

### Design system — Jewel Teal + Warm Gold
- **Full palette reskin** — new jewel teal (`#0a4655` sidebar, `#106f88` links/active) and warm gold (`#c9780c` accent, `#fcc858` hero numbers) replaces the flat clinical teal
- **Header** — teal gradient (`135deg #106f88 → #0a4655`); OpsPoint | Facility branding with logo ring; pill nav buttons (File Walkthrough, File Wellness, Email, Announce) with gold icons; gear settings dropdown
- **Sidebar** — gradient background; user identity card pinned at top of sidebar (above nav groups, always visible); gold glowing active-item rail; UA Draw moved into Health & Compliance group
- **Page background** — teal-tinted gradient wash (`var(--grad-page)`)
- **Section heads** — `#eaf3f6` raised surface, teal-700 text, gold dot
- **Census cards** — only Total tile gets teal gradient fill + gold number; other tiles plain white
- **Report hero band** — teal gradient header band for shift report title with eyebrow, date/range meta, and action buttons; New Report gated to closed-shift state only
- **Auth page** — teal gradient card top with gold radial glow

### Layout fixes
- **Tab full-width** — `.app-content` now uses `flex: 1; min-width: 0` to properly fill the flex-row parent; all tabs (Clients, Staff, etc.) render at full width
- **Scrollable About page** — fixed `min-height: 100vh` on `.app-content` (grew to fit content, preventing child scroll); changed to `height: 100%`; About page outside AppShell fixed separately with `height: 100vh; overflowY: auto`
- **Sidebar scroll** — sidebar outer container uses `overflow: hidden`; only `.sidebar-body` scrolls; user card stays locked at top

### Input & focus improvements
- **Global focus ring** — all `input`, `select`, and `textarea` elements show gold glow (`border-color: var(--gold-500)`, `box-shadow: var(--glow-gold)`) on focus; `!important` used to override inline border styles consistently
- **Global input normalization** — bare inputs (no `.field` wrapper) now get a visible `1px solid var(--border-light)` border and `outline: none` base style
- **EHR/Compliance textareas** — previously had no visible border; resolved by global base rule

### Admin panel
- **Display settings** — TAB_OPTS updated to match current sidebar: added Med Log, Milestones, Incidents, Consents; corrected labels (Staff not "Staff Directory", UA not "UA Log"); removed "Violations / Violations" duplicate
- **Tab contrast** — top-level tabs now use teal-600 underline and teal-700 active text; SubTabs redesigned with teal-200 border, raised-bg fill for active, transparent inactive; fixed bug where both active and inactive had identical `borderColor: var(--line)`

### Other
- **CSS encoding** — replaced mojibake box-drawing characters (`â"€`, UTF-8 re-encoded from CP1252) with plain ASCII hyphens; file re-saved as UTF-8 without BOM
- **Section head meta consistency** — removed inline color overrides from Report/Census/Log count spans; all fall through to unified `color: var(--text-muted)` CSS rule
- **Version label** — removed "React Edition" label from About page

---

## v2.1.0 — HIPAA Clinical Modules & Clinical Teal (2026-05-28)

### HIPAA clinical modules
- **UA Records** — full result records linked to shift log entries; photo attachment on each record; table view with filters and export
- **Witnessed self-administration log** — per-resident log of witnessed medication self-administration events; links to log entries
- **Milestone tracker** — configurable milestones per resident; track completion dates and staff notes
- **Behavioral incident reports** — structured incident forms (type, severity, narrative, follow-up); review workflow; notification bell integration
- **Discharge records** — discharge summary with reason, destination, and follow-up fields; links discharged clients to their record history
- **42 CFR Part 2 consent & disclosures** — consent form tracking per resident; disclosure log for SUD-related record releases; re-disclosure warnings
- **HIPAA technical safeguards** — full audit log (actor, action, target, IP, timestamp); audit log viewer in Admin panel; log pruning on schedule

### Design system — Clinical Teal
- **Tailwind CSS v4** — installed `tailwindcss` + `@tailwindcss/vite`; `vite.config.js` updated; no `tailwind.config.js` needed
- **Clinical Teal palette** — `@theme {}` tokens: sidebar `#134e4a`, topnav `#0f766e`, accent `#0d9488`, page background `#f0fdf9`; all semantic CSS classes rewritten to teal
- **Legacy CSS vars preserved** — `:root` vars (`--dark`, `--crimson`, `--mid`, etc.) remapped to teal equivalents so inline JSX styles continue working without changes
- **Activity log table** — restructured from a flat div list to a `TIME | TYPE | DETAILS` table; color-coded `LOG_TYPE_STYLE` badges per entry type (Wellness, UA, Walkthrough, Violation, etc.)
- **Header buttons** — File Walkthrough, File Wellness, Email buttons now render as clean white-bg teal-text pills (`.btn-outline`) against the teal topnav

### Bug fixes
- **UA records photo button showed "—" on all records** — `db.run()` public wrapper was not returning the SQLite statement result; `lastInsertRowid` was inaccessible, so `log_entry_id` was never stored; fixed by adding `return` to the wrapper
- **Dismiss ✕ button not visible on UA requests** — button was gated on `ua.acknowledge` only; users with `ua.record` (Administrators) could not see it; fixed to `(canAck || canRecord)` on frontend
- **403 Forbidden when conducting a UA** — `POST /api/ua-requests/:id/acknowledge` only accepted `ua.acknowledge`; conducting a UA should auto-acknowledge the request; fixed with `requireAnyPermission('ua.acknowledge', 'ua.record')`

### Branding
- Removed all references to prior organization names from all source files; replaced with generic facility-name-from-settings pattern
- Login footer, About page, and AppShell header updated

---

## v2.0.0 — React Edition (2026-05-23)

Complete rewrite of the OpsPoint frontend as a React SPA (React 18 + Vite + React Router v6), deployed alongside the existing Express/SQLite backend. All v1.x features are carried forward; the database schema and API are fully backward-compatible.

### Architecture changes
- **React 18 SPA** — frontend rebuilt with React 18, React Router v6, and Vite; served from `client/dist/` by Express
- **better-sqlite3** — replaced in-memory `sql.js` with `better-sqlite3`; writes are synchronous and go directly to `data/opspoint.db` (no flush-to-disk step)
- **Context providers** — `AuthContext` manages session state; `DataContext` manages all app data, WebSocket connection, and real-time sync
- **No more `window.SESSION` injection** — auth state is fetched from `GET /api/me` and held in React context
- **Vite build** — `cd client && npm run build` outputs to `client/dist/`; must be run after any frontend change

### New features
- **Client photo popout** — clicking a client photo thumbnail in the Clients tab opens a full lightbox, matching the existing UA photo popout
- **Vacant and special rooms in Clients tab** — all rooms now visible: vacant rooms shown with a muted empty-room style; special rooms shown with amber badge and special label; "Assign Client" shortcut on vacant rows
- **About page** — link added to desktop header; page gated behind `requireAuth` (authenticated users only); shows version, features, tech stack, and org info

### Permission changes
- **`mobile.full` retired** — permission removed from the system; all existing users, groups, and profiles are automatically migrated to strip it on startup; `mobile.access` remains and gates the mobile interface
- **Mail, UA Log, and Infractions tabs** — tab visibility now controlled solely by Facility Setup display settings; no longer double-gated by group policy

### Bug fixes
- Client photo `src` fixed — `getAllData()` returns base64 data URIs; template was prepending `/` making an invalid URL
- Mobile scroll fixed — `body { overflow: hidden }` global CSS required proper flex chain (`overflow-y: auto` on `flex: 1` child) rather than `position: fixed` scroll
- `/about` route moved inside `AuthGuard` — previously accessible without authentication on the React router side

---

## v1.15.0 — Mobile-Full Overhaul, Permissions & Pagination (2026-05-09)

### Permissions
- **`mail.delete` permission** — new permission key separates mail record deletion from `log.delete`; configurable per user in Admin → Permission Profiles; `DELETE /api/mail/:id` now requires `mail.delete`
- **Permission profiles persist across restarts** — added `known_permissions` DB setting to track which permissions existed on last boot; profiles now only receive genuinely new permission keys rather than being reset to role presets on every startup
- **Default role presets reworked** — monitor, supervisor, admin, and case_manager presets updated to reflect actual operational needs

### UX — Pagination
- **Report archive** — paginated at 20 per page (`#archive-pager`)
- **Delivered mail** — paginated at 25 per page
- **Returned passes** — paginated at 25 per page (`#returned-passes-pager`)
- **UA records** — paginated at 50 per page (`#uar-pager`)
- **Discharged clients** — paginated at 50 per page (`#client-pager`)
- Shared `_spPager()` helper in `app.js` generates prev/next controls with entry range display

### mobile-full — Feature changes
- **Passes tab** — converted to read-only; shows **Approved Passes** and **Returned** sections matching desktop layout; In/Out/Returned badge colours match desktop exactly; add/edit/delete removed
- **Chores tab** — converted to read-only; client name is now the primary label with chore name, time slot badge, and today's completion status (initials) clearly shown below; interactive checkbox removed
- **Reports tab** — "More" (⋯) renamed to "Reports" (📋); UA system and incoming mail features removed; shift report archive is now the sole content, with caseloads also removed

### mobile-full — Bug fixes
- **Staff phone not rendering** — field was referenced as `phone1` throughout; corrected to `phone` in `renderStaff()`, `openStaffSheet()`, and `saveStaff()`; live-render fixed by re-fetching `GET /api/staff` after successful save instead of relying on sparse PUT response
- **Pass status comparisons** — filter/render used lowercase `'out'`/`'returned'` which never matched DB values (`'Out'`/`'In'`/`'Returned'`); all comparisons and select values corrected
- **Client edits not syncing to desktop** — `saveClient()` was calling `PATCH /api/data` which doesn't handle client updates; fixed to `PUT /api/clients/:id`, which saves to DB and broadcasts `data_saved` to all connected clients
- **Field name mismatch** — `admit_date` used in `openClientSheet()` and `saveClient()`; corrected to `intake_date` to match DB schema
- **Chore save failing** — `toggleChore()` used `method:'POST'` on `/api/chore-log` but server only exposes `PUT`; corrected HTTP method

---

## v1.13.3 — Polish & Bug Fixes (2026-05-05)

### UI
- **Custom app icon** — new OpsPoint icon: dark green rounded square, white circular shift arrow, gold diamond centre point; replaces the generic placeholder
- **Favicon** — icon shown in browser tab on all pages (login, desktop, mobile, admin, facility)
- **Apple touch icon** — icon used when adding any page to iOS or Android home screen
- **Login page** — icon replaces the "OpsPoint" wordmark heading
- **Desktop header** — icon displayed inline to the left of the facility name
- **Mobile header** — icon displayed to the left of the title/subtitle block

### Bug fixes
- **Favicon auth redirect** — `/static/icons/` is now served without authentication; previously the browser's automatic favicon request was intercepted by `requireAuth`, which saved the icon URL as `returnTo` and redirected users to the raw PNG after login
- **PWA manifest scope** — `<link rel="manifest">` removed from desktop pages; it belongs only on `mobile.html` (the manifest sets `start_url=/mobile.html` and `display=standalone`); having it on desktop pages caused Chrome to launch the app as a mobile standalone PWA
- **`/index.html` 404** — `GET /index.html` now redirects 301 to `/`

### Docs
- **Deployment guide** — corrected monitor role description (monitors can create reports and edit staff, passes, chores, and pass notices)
- **README, CHANGELOG, docs/DEPLOYMENT.md** — added for v1.13 / v1.13.2 release

---

## v1.13.2 — Security Hardening (2026-05-05)

### Security fixes
- **CSRF protection** — all 30 state-changing API routes now verify the `Origin` header against the server's own host; cross-origin writes are rejected with 403
- **Session fixation** — `session.regenerate()` called on every successful login so the pre-login session ID is never reused post-authentication
- **Stored XSS** — `r.shift`, `r.mod_name`, `r.room`, `r.client_name`, and `r.requested_by` now HTML-escaped before insertion into `innerHTML` in the archive renderer and UA request banner (`sync.js`)
- **Stored XSS** — walk area names escaped via `mesc()` before `innerHTML` in mobile `renderWalk()`; room number sanitized to alphanumeric in inline `onclick` handler
- **Session secret permissions** — `data/secret.key` now written with mode `0o600`; `chmodSync` applied on Unix after creation
- **Rate limiting expanded** — `POST /api/data` and the self-service password-change endpoint now count against the 300-req/min per-IP limit (previously only `GET /api/data` was covered)
- **Roster wipe prevention** — `POST /api/data` ignores a `clients: []` payload; an empty array no longer triggers deletion of all client records
- **Photo size cap** — UA photo uploads and client photos capped at 4 MB; oversized payloads rejected with 400 before magic-byte validation
- **Input length limits** — server-side maximums enforced: names 200 chars, phone fields 30 chars, notes 2000 chars, categories 100 chars, pass notice 1000 chars, pass notes 500 chars, facility name 200 chars
- **CSP hardened** — `'unsafe-eval'` removed from `script-src`
- **SRI hash added** — JSZip CDN script tag now includes `integrity="sha384-..."` to guard against supply-chain compromise
- **XSS in `tabEsc()`** — single quotes now escaped (`&#39;`) in the shared HTML-escape helper in `tabs.js`
- **`credentials:'include'`** — added to all 12 `fetch()` calls in `tabs.js` that were missing it
- **Rate limiter state** — login attempt counters kept in-memory only; IP addresses no longer written to the `settings` table
- **Random seed passwords** — first-run default credentials are now cryptographically random 16-character passwords printed to the server console; hardcoded `Admin@123` / `Super@123` / `Monitor@1` removed from source
- **`/about` page** — now calls `inject()` so `window.SESSION` is available consistently with all other pages
- **`X-Powered-By`** — suppressed via `app.disable('x-powered-by')`
- **CSRF on logout** — `/logout` now validates `Origin` header before destroying session
- **`tabEsc()` single-quote escape** — added `&#39;` replacement to prevent attribute-context injection in print views

### Bug fixes
- UA photos now load correctly from the UA Records tab in the admin panel (was fetching `/true` — a boolean sentinel coerced to string)
- UA photo viewer in the main app and UA report tab now detects the server sentinel (`true`/`1`) and fetches the real image from `/api/log/:id/photo`
- `db.upsertReport` no longer overwrites a real photo filename with the sentinel value `true` on desktop save
- Mobile horizontal overflow fixed (`overflow-x:hidden` on `html,body`)
- Mobile header no longer clips the Out button and live-dot at narrow widths; username moved to its own subtitle line
- Footer no longer pinned to the viewport; sits at the bottom of scrollable content

---

## v1.13.1 — Security Hardening Batch 1 (2026-04-xx)

### Security fixes
- **PBKDF2 upgraded** to SHA-512 at 600,000 iterations; legacy 100k hashes accepted on login and re-hashed on next password change
- **Password policy enforced** — 8+ chars, uppercase, lowercase, digit, symbol required for all password changes
- **Login CSRF** — `Origin` header validated against `Host` on `POST /login`
- **Rate limiting** — 10 login attempts per 15-minute window per IP, persisted across restarts; 300 API requests/min per IP
- **Safe redirect** — `returnTo` validated to be a relative path before redirect after login
- **Session hardening** — `HttpOnly`, `SameSite: lax`, 12-hour expiry; switches to `Secure` when TLS is active
- **CSP** — scoped Content Security Policy header; wildcard `default-src` removed
- **IDOR on UA photos** — upload endpoint verifies log entry exists and belongs to an open report before accepting photo
- **Magic-byte validation** — client photos and logos validated as JPEG/PNG/GIF/WebP before saving to disk
- **XSS prevention** — `esc()` helper added; substance codes, walkthrough areas, and log entry text escaped before HTML insertion
- **Stale login attempt cleanup** — expired rate-limit keys removed from DB on window expiry
- **`/about` and `/manifest.json`** — gated behind `requireAuth`
- **Constant-time invalid-user response** — dummy PBKDF2 run on unknown username to equalise timing

### UX additions (v1.13 continuation)
- Left icon sidebar stays fixed while content scrolls
- "Other" category in Add Staff modal allows free-text entry
- "CM Request" UA reason shows a case manager name field
- Staff modal correctly pre-fills custom categories when editing

---

## v1.13 — Feature Release (2026-04-xx)

### New features
- **Staff Directory tab** — add, edit, delete, and filter staff contacts by category; category management
- **Chores tab** — assign daily chores to residents; log completions with initials; print chore sheet
- **Weekend Passes tab** — create and manage resident passes; mark as Out / Extended / Returned; pass notice board; print pass sheet
- **Caseloads tab** — per-case-manager resident list; print caseload sheet
- **UA Request system** — supervisors can flag a resident for UA from mobile or desktop; banner notification for on-duty staff
- **Role-based UI** — monitors see read-only views on extended tabs; edit controls hidden by role
- **Green theme** — full green/gold colour scheme toggle on both desktop and mobile
- **Real-time chore log sync** — chore completions broadcast to all connected clients
- **Facility setup page** — room/roster management, walk area configuration, UA panel configuration, wellness/walk schedule

### Architecture
- `tabs.js` added for extended module rendering (Staff, Chores, Passes, Caseloads)
- `sync.js` extended with `passes_updated`, `pass_notice_updated`, `ua_request`, `settings_updated` WebSocket handlers
- Server routes added for staff, passes, chores, pass notice, UA requests, facility settings, and room management
- `ua_requests` table added to schema

---

## v1.12 and earlier

See prior release notes. Core shift report, wellness check, walkthrough log, census, DOCX export, and mobile status-update functionality established in v1.0–v1.12.
