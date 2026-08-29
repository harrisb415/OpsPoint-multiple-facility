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

// Fallback if the payload hasn't loaded or predates the setting. Mirrors the
// server seed so a first paint never shows raw slugs.
export const DEFAULT_STATUSES = [
  { key: 'building', label: 'In Building',  tone: 'green',  system: true },
  { key: 'work',     label: 'At Work',      tone: 'blue'   },
  { key: 'pass',     label: 'Weekend Pass', tone: 'amber'  },
  { key: 'bhc',      label: 'BHC',          tone: 'purple' },
  { key: 'efc',      label: 'EFC',          tone: 'pink'   },
  { key: 'hospital', label: 'Hospital',     tone: 'red'    },
  { key: 'out',      label: 'Out / Other',  tone: 'orange' },
]

// Normalise whatever the payload gives us into a usable list.
export function statusList(data) {
  const raw = data?.client_statuses
  const arr = typeof raw === 'string' ? safeParse(raw) : raw
  return Array.isArray(arr) && arr.length ? arr : DEFAULT_STATUSES
}
function safeParse(s) { try { return JSON.parse(s) } catch { return null } }

// key -> {label, tone}. Unknown keys (e.g. a status removed before the guard
// existed, or 'vacant') degrade to a titlecased slug rather than blank.
export function statusMap(data) {
  const m = {}
  for (const s of statusList(data)) m[s.key] = s
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
function titlecase(k) {
  return String(k || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
