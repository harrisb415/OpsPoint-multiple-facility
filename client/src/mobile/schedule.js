// Wellness / walkthrough schedule — the phone's copy of the desktop reminder
// rules (calcScheduledStatus / getMostRecentLogTime in pages/ReportTab.jsx)
// and of server/lib/schedule.js, which sends the push alerts. All three must
// agree on when a check is due.

// 'h:mm AM/PM' (a log entry's time) -> Date, yesterday when that would put it
// more than 30 minutes in the future.
export function parseLogTime(timeStr, now = new Date()) {
  const m = String(timeStr || '').match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const mn = parseInt(m[2], 10)
  const ap = m[3].toUpperCase()
  if (ap === 'AM' && h === 12) h = 0
  if (ap === 'PM' && h !== 12) h += 12
  const d = new Date(now)
  d.setHours(h, mn, 0, 0)
  if (d.getTime() > now.getTime() + 30 * 60000) d.setDate(d.getDate() - 1)
  return d
}

export function mostRecentLogTime(entries, keyword, now = new Date()) {
  const kw = keyword.toLowerCase()
  let best = null
  for (const e of entries || []) {
    if (!String(e.text || '').toLowerCase().includes(kw)) continue
    const d = parseLogTime(e.time, now)
    if (d && (!best || d > best)) best = d
  }
  return best
}

function slots(schedule, now) {
  return (Array.isArray(schedule) ? schedule : [])
    .map((t) => {
      const m = String(t).match(/^(\d{1,2}):(\d{2})/)
      if (!m) return null
      const d = new Date(now)
      d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0)
      return d
    })
    .filter(Boolean)
    .sort((a, b) => a - b)
}

// { status: 'ok'|'overdue', nextTime, overdueAt, prevTime } or null.
export function scheduledStatus(last, schedule, now = new Date()) {
  const times = slots(schedule, now)
  if (!times.length) return null
  const past = times.filter((t) => t <= now)
  const nextTime = times.find((t) => t > now) || null
  const prevTime = past.length ? past[past.length - 1] : null
  if (!prevTime) return { status: 'ok', nextTime, overdueAt: null, prevTime }
  if (last && last >= prevTime) return { status: 'ok', nextTime, overdueAt: null, prevTime }
  return { status: 'overdue', nextTime, overdueAt: prevTime, prevTime }
}

export function fmtClock(d) {
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// 'HH:MM' from a time input -> 'h:mm AM/PM', the format log entries use.
export function toLogTime(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((n) => parseInt(n, 10))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fmtClock(new Date())
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return fmtClock(d)
}

export function nowHHMM() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// '12 min', '1 h 5 min'
export function fmtSpan(ms) {
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
