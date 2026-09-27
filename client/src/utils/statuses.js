// ── Resident statuses ─────────────────────────────────────────────────
//
// Single source of truth for the selectable statuses. These used to be
// hardcoded in eight places with labels that had already drifted apart
// ("Work" vs "At Work", "Out / Other" vs "Out/Other"). They are now editable
// in Admin -> Facility -> Statuses and delivered on the data payload.
//
// `key` is what gets written into reports.statuses, so a label can be renamed
// freely but a key cannot be removed while any report still references it —
// the API enforces that.

// Fixed tone palette. Restricting to a set (rather than free hex) keeps every
// status legible and dark-mode safe no matter what an admin picks.
// The built-in statuses, and the whole of a new facility's list. 'building'
// is the default state, 'pass' is owned by the Passes tab (see
// effectiveStatuses below), and 'hospital' and 'out' are the off-site buckets
// every facility gets. The server enforces this too — these can be renamed
// and recoloured, not removed.
export const SYSTEM_STATUS_KEYS = ['building', 'pass', 'hospital', 'out']
export const isSystemStatus = (k) => SYSTEM_STATUS_KEYS.includes(k)

// Everything that is not 'building' counts as off site.
export function offSiteStatuses(data) {
  return statusList(data).filter(s => s.key !== 'building')
}

export const STATUS_TONES = ['green', 'blue', 'amber', 'purple', 'pink', 'red', 'orange', 'gray']

export const TONE_BADGE = {
  green:  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  blue:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  amber:  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  pink:   'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  red:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  gray:   'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

// Solid colours for canvas-rendered charts, which can't use Tailwind classes.
export const TONE_HEX = {
  green: '#22c55e', blue: '#3b82f6', amber: '#f59e0b', purple: '#a855f7',
  pink: '#ec4899', red: '#ef4444', orange: '#f97316', gray: '#9ca3af',
}

export const TONE_DOT = {
  green: 'bg-green-500', blue: 'bg-blue-500', amber: 'bg-amber-500',
  purple: 'bg-purple-500', pink: 'bg-pink-500', red: 'bg-red-500',
  orange: 'bg-orange-500', gray: 'bg-gray-400',
}

// Light fill + dark text for prints and the DOCX export, which can't use
// Tailwind classes and don't follow dark mode. Hex without the '#', which is
// how WordprocessingML wants it; prefix one for CSS.
export const TONE_PRINT = {
  green:  { bg: 'D8F3DC', fg: '14532D' },
  blue:   { bg: 'DBEAFE', fg: '1D4ED8' },
  amber:  { bg: 'FEF9C3', fg: '854D0E' },
  purple: { bg: 'EDE9FE', fg: '5B21B6' },
  pink:   { bg: 'FCE7F3', fg: '9D174D' },
  red:    { bg: 'FEE2E2', fg: '991B1B' },
  orange: { bg: 'FFF7ED', fg: '7C2D12' },
  gray:   { bg: 'F1F5F9', fg: '475569' },
}

// Fallback if the payload hasn't loaded or predates the setting. Mirrors the
// server seed so a first paint never shows raw slugs. A new facility starts
// with the built-in set only; anything else is added in Admin.
export const DEFAULT_STATUSES = [
  { key: 'building', label: 'In Building',  tone: 'green',  system: true },
  { key: 'pass',     label: 'Weekend Pass', tone: 'amber',  system: true },
  { key: 'hospital', label: 'Hospital',     tone: 'red',    system: true },
  { key: 'out',      label: 'Out / Other',  tone: 'orange', system: true },
]

// Every configured status, archived ones included. Use this for RENDERING —
// a closed report may reference a retired status and should still show its
// real label rather than a raw slug.
export function allStatuses(data) {
  const raw = data?.client_statuses
  const arr = typeof raw === 'string' ? safeParse(raw) : raw
  return Array.isArray(arr) && arr.length ? arr : DEFAULT_STATUSES
}

// What staff can actually pick. Archived statuses are retired from the picker
// but deliberately still resolve above.
export function statusList(data) {
  return allStatuses(data).filter(s => !s.archived)
}
function safeParse(s) { try { return JSON.parse(s) } catch { return null } }

// key -> {label, tone}. Unknown keys (e.g. a status removed before the guard
// existed, or 'vacant') degrade to a titlecased slug rather than blank.
export function statusMap(data) {
  const m = {}
  for (const s of allStatuses(data)) m[s.key] = s   // includes archived
  return m
}
export function statusLabel(data, key) {
  if (key === 'vacant') return 'Vacant'
  return statusMap(data)[key]?.label || titlecase(key)
}
export function statusTone(data, key) {
  if (key === 'vacant') return 'gray'
  return statusMap(data)[key]?.tone || 'gray'
}
export function statusBadge(data, key) {
  return TONE_BADGE[statusTone(data, key)] || TONE_BADGE.gray
}
export function statusPrint(data, key) {
  return TONE_PRINT[statusTone(data, key)] || TONE_PRINT.gray
}

// Census columns: the configured statuses in the admin's order, then any key
// a resident actually holds that isn't in that list (a retired status on an
// old report, a legacy slug). Without the second part those residents are in
// the total but in no column, and the row stops adding up.
export function censusKeys(data, counts = {}) {
  const keys = statusList(data).map(s => s.key)
  for (const k of Object.keys(counts)) if (counts[k] > 0 && !keys.includes(k)) keys.push(k)
  return keys
}

// Residents per status, seeded from the configured list so an unused status
// reads 0 rather than blank. Pass the active, non-special, non-vacant rows
// and an effectiveStatuses() map.
export function countStatuses(data, residents, statuses) {
  const cnt = {}
  for (const s of statusList(data)) cnt[s.key] = 0
  for (const c of residents) { const k = statuses[c.id] || 'building'; cnt[k] = (cnt[k] || 0) + 1 }
  return cnt
}

// ── Weekend Pass belongs to the Passes tab ────────────────────────────
//
// A pass never writes a status. While it is Out or Extended the resident IS
// on pass, whatever the report last stored, so the status is laid over the
// top at read time. Everything that shows or counts statuses has to read them
// through effectiveStatuses(): reading report.statuses directly is how a
// resident away on pass showed as In Building on Mobile, in the DOCX, in the
// wellness filing and in the UA draw pool.
//
// With Passes turned off in Admin -> Features there's no lifecycle to follow,
// so there's no overlay and Weekend Pass is picked by hand like any other.
export function passesEnabled(data) {
  const raw = data?.ui_visibility
  const vis = typeof raw === 'string' ? safeParse(raw) : raw
  return vis?.tabs?.passes !== false
}

// client_id -> 'pass' for every resident currently away on a pass.
export function passOverlay(data) {
  const m = {}
  if (!passesEnabled(data)) return m
  for (const p of data?.passes || []) {
    if (p.status === 'Out' || p.status === 'Extended') m[p.client_id] = 'pass'
  }
  return m
}

// What a report's statuses mean right now. `stored` defaults to the report's
// own map; ReportTab hands in its unsaved local copy instead.
//
// A closed report is a frozen record: Close Shift writes the overlay into it,
// and laying today's passes over last week's shift would rewrite history.
export function effectiveStatuses(data, report, stored = report?.statuses) {
  if (report?.is_closed) return stored || {}
  return { ...(stored || {}), ...passOverlay(data) }
}

function titlecase(k) {
  return String(k || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
