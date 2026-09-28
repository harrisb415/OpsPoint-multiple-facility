// Derived views of the snapshot shared by the mobile screens.
import { effectiveStatuses } from '../utils/statuses.js'
import { parseServerTime, parseWhen } from '../utils/dates.js'
import { fmtClock } from './schedule.js'

// ── Announcements: which ones this phone has seen (ids only, no content) ──
const SEEN_KEY = 'opspoint-m-announcements-seen'
export function lastSeenAnnouncement() {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0 } catch { return 0 }
}
export function markAnnouncementsSeen(list) {
  const max = Math.max(0, ...(list || []).map(b => Number(b.id) || 0))
  if (max > lastSeenAnnouncement()) {
    try { localStorage.setItem(SEEN_KEY, String(max)) } catch { /* private mode */ }
  }
}
export function unseenAnnouncements(snap) {
  const seen = lastSeenAnnouncement()
  return (snap.announcements || []).filter(b => Number(b.id) > seen).length
}
// When a resident is due back, short enough for a list row: '11:15 PM'
// today, 'Mon 11:15 PM' within the week, 'Oct 12' beyond.
export function fmtBack(v) {
  const d = parseWhen(v)
  if (!d) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return fmtClock(d)
  if (Math.abs(d - now) < 6 * 86400000) return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${fmtClock(d)}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// '9:41 PM' today, 'Sat, Sep 26, 9:41 PM' before.
export function fmtSent(v) {
  const d = parseServerTime(v)
  if (!d) return ''
  if (new Date().toDateString() === d.toDateString()) return fmtClock(d)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtClock(d)}`
}

// The shape utils/statuses.js reads: configured statuses, feature flags, passes.
export function statusData(snap) {
  return {
    client_statuses: snap.facility.client_statuses,
    ui_visibility: snap.facility.ui_visibility,
    passes: snap.passes,
  }
}

// client_id -> status key right now (passes laid over the report).
export function currentStatuses(snap) {
  return effectiveStatuses(statusData(snap), snap.report)
}

// Away = any status but In Building. Away residents are accounted for.
export function isAway(statuses, id) {
  const s = statuses[id]
  return !!s && s !== 'building'
}

export function marksOf(round) {
  return new Map((round?.marks || []).map((m) => [m.client_id, m]))
}

// Progress of the open round across every resident.
export function roundStats(snap, statuses = currentStatuses(snap)) {
  const marks = marksOf(snap.round)
  let accounted = 0, missing = 0, unchecked = 0
  for (const c of snap.residents) {
    const m = marks.get(c.id)?.mark
    if (m === 'missing') missing++
    else if (m === 'ok' || isAway(statuses, c.id)) accounted++
    else unchecked++
  }
  return { accounted, missing, unchecked, total: snap.residents.length }
}

// 'Floor 2' for rooms like 201; everything else shares one group.
export function floorOf(room) {
  const m = String(room || '').match(/^(\d)\d{2}$/)
  return m ? `Floor ${m[1]}` : 'Other rooms'
}

// 'Jamie O.' from 'Jamie Ortiz'
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/)
  if (parts.length < 2) return parts[0] || ''
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

// The latest wellness line in the log: { time, summary } for "Last check".
export function lastWellness(entries) {
  for (let i = (entries || []).length - 1; i >= 0; i--) {
    const e = entries[i]
    const text = String(e.text || '')
    if (!/^wellness check/i.test(text)) continue
    let summary = ''
    const all = text.match(/All (\d+) clients accounted for/i)
    const some = text.match(/(\d+) of (\d+) clients accounted for/i)
    if (all) summary = `all ${all[1]} accounted for`
    else if (some) summary = `${some[1]} of ${some[2]} accounted for`
    return { time: e.time, summary }
  }
  return null
}

// Residents marked not located on the last finished round and not yet found.
export function openNotLocated(snap) {
  const last = snap.last_round
  if (!last) return []
  const names = new Map(snap.residents.map((c) => [c.id, c]))
  return last.marks
    .filter((m) => m.mark === 'missing' && !m.found_at)
    .map((m) => ({ ...m, resident: names.get(m.client_id) || null }))
}

export function uiFlags(snap) {
  const buttons = snap.facility.ui_visibility?.buttons || {}
  const wellnessOn = buttons.wellness !== false
  const walkOn = buttons.walkthrough !== false
  return { wellnessOn, walkOn, roundsOn: wellnessOn || walkOn }
}
