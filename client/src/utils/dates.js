// ── Dates and instants ────────────────────────────────────────────────
//
// Three shapes of value reach the client, and they are not read the same way:
//
//   calendar date   '2026-09-01'            intake, report, incident dates.
//                   No zone. Pinned to local noon so no offset can move it
//                   onto another day.
//   instant         '2026-09-29T06:22:00.000Z' — SQLite stores it that way and
//                   the pg driver converts timestamptz to it. Postgres's raw
//                   '2026-09-29 06:22:00+00' is still accepted. Pass times, UA
//                   test times. A moment in time: read whole, so the LOCAL day and
//                   hour come out. Its first ten characters are the UTC date,
//                   already "tomorrow" for an evening pass.
//   local datetime  '2026-09-28T23:22' (old datetime-local values) or
//                   '2026-09-27 04:22:33' (nowLocal). Wall-clock time with no
//                   zone, so it is local already.
//
// new Date() alone is not enough: WebKit rejects the space-separated spellings
// and the two-digit '+00' offset Postgres prints, so they are normalised to
// strict ISO before parsing.

const SHAPE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i

// A Date for any of the shapes above (or a Date), or null if unreadable.
export function parseWhen(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  const s = String(v).trim()
  const m = s.match(SHAPE)
  if (!m) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d }
  const [, day, time, frac, zone] = m
  if (!time) return new Date(`${day}T12:00:00`)                 // calendar date
  const ms  = frac ? frac.slice(0, 4) : ''                     // JS reads 3 digits
  const off = !zone ? ''
    : zone.toUpperCase() === 'Z' ? 'Z'
    : zone.replace(/^([+-]\d{2}):?(\d{2})?$/, (_, h, mm) => `${h}:${mm || '00'}`)
  const d = new Date(`${day}T${time}${ms}${off}`)
  return Number.isNaN(d.getTime()) ? null : d
}

// Timestamps the SERVER stamps from a "now" default: created_at, requested_at
// and the like. Different convention from the shapes above: SQLite writes these
// with datetime('now'), which is UTC but carries no zone marker, so a zone-less
// value here means UTC — that is why timeAgo() used to append a 'Z'. Postgres
// hands the same columns back with an explicit offset, and '…+00' + 'Z' is an
// Invalid Date: every "time ago" read NaN and the 24-hour UA-draw window never
// matched anything.
export function parseServerTime(v) {
  if (v instanceof Date) return parseWhen(v)
  const s = String(v ?? '').trim()
  if (!s) return null
  return parseWhen(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(s) ? s : s.replace(' ', 'T') + 'Z')
}

// 'YYYY-MM-DD' of the local calendar day, for comparing against date cutoffs.
// Slicing the string gives the UTC day for an instant — tomorrow, for an
// evening entry.
export function localDayKey(v) {
  const d = parseWhen(v)
  if (!d) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// '2026-09-28 16:22:05' — local wall-clock time for exports: sortable, and
// spreadsheets read it as a date. The raw value is UTC on Postgres.
export function localStamp(v) {
  const d = parseWhen(v)
  if (!d) return v == null ? '' : String(v)
  const p = n => String(n).padStart(2, '0')
  return `${localDayKey(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 'Sep 28, 2026' — the local calendar day.
export function fmtDay(v) {
  if (!v) return '—'
  const d = parseWhen(v)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : String(v).slice(0, 10)
}

// 'Sep 28, 4:22 PM' — local date and time, for instants.
export function fmtWhen(v) {
  if (!v) return '—'
  const d = parseWhen(v)
  return d ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : String(v)
}
