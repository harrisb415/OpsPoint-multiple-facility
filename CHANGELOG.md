# ShiftPoint Changelog

---

## v1.13.3 — Polish & Bug Fixes (2026-05-05)

### UI
- **Custom app icon** — new ShiftPoint icon: dark green rounded square, white circular shift arrow, gold diamond centre point; replaces the generic placeholder
- **Favicon** — icon shown in browser tab on all pages (login, desktop, mobile, admin, facility)
- **Apple touch icon** — icon used when adding any page to iOS or Android home screen
- **Login page** — icon replaces the "ShiftPoint" wordmark heading
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
