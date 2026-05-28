import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react'
import { useData } from '../contexts/DataContext.jsx'
import { usePermission } from '../hooks/usePermission.js'
import PrintScopeModal from '../components/PrintScopeModal.jsx'
import ConductUAModal from '../components/ConductUAModal.jsx'
import { openPrintWindow, fmtDateFriendly, classifyLogEntry } from '../utils/printLog.js'

const STATUS_OPTS = [
  { v: 'building', l: 'In Building', c: 's-building' },
  { v: 'work',     l: 'Work',        c: 's-work' },
  { v: 'pass',     l: 'Weekend Pass',c: 's-pass' },
  { v: 'out',      l: 'Out / Other', c: 's-out' },
  { v: 'bhc',      l: 'BHC',         c: 's-bhc' },
  { v: 'efc',      l: 'EFC',         c: 's-efc' },
  { v: 'hospital', l: 'Hospital',    c: 's-hospital' },
]


const LOG_TYPE_STYLE = {
  Wellness:      { bg: '#ccfbf1', color: '#0f766e' },
  Walkthrough:   { bg: '#ccfbf1', color: '#0f766e' },
  UA:            { bg: '#fef3c7', color: '#92400e' },
  Lunch:         { bg: '#f0fdf9', color: '#6b7280' },
  'Room Search': { bg: '#ede9fe', color: '#6d28d9' },
  Mail:          { bg: '#dbeafe', color: '#1d4ed8' },
  Violation:     { bg: '#fee2e2', color: '#991b1b' },
  Intake:        { bg: '#dcfce7', color: '#15803d' },
  Discharge:     { bg: '#f0fdf9', color: '#6b7280' },
  Note:          { bg: '#f1f5f9', color: '#475569' },
}

const DEFAULT_WALK_AREAS = [
  'Supply Room','Basement / Offices','Kitchen','Meeting Room','Dining Room',
  'Laundry Area','Clothing Closet','Stairs to Roof','Floors 2, 3 & 4',
  'Stairs Down to Main','Perimeter Check',
]

function todayStr() { return new Date().toISOString().slice(0, 10) }
function autoShift() {
  const h = new Date().getHours()
  if (h >= 7 && h < 15) return 'Day Shift'
  if (h >= 15 && h < 23) return 'Swing Shift'
  return 'Graveyard Shift'
}
function fmtTime(d = new Date()) {
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0')
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`
}
function parseTimeMins(t) {
  const m = t?.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1]), mn = parseInt(m[2]), ap = m[3].toUpperCase()
  if (ap === 'AM' && h === 12) h = 0
  if (ap === 'PM' && h !== 12) h += 12
  return h * 60 + mn
}
function parseLogTimeToDate(timeStr) {
  const m = timeStr?.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return null
  const d = new Date()
  let h = parseInt(m[1]), mn = parseInt(m[2])
  const ap = m[3].toUpperCase()
  if (ap === 'AM' && h === 12) h = 0
  if (ap === 'PM' && h !== 12) h += 12
  d.setHours(h, mn, 0, 0)
  // If in future (>30min ahead), assume yesterday
  if (d.getTime() > Date.now() + 30 * 60000) d.setDate(d.getDate() - 1)
  return d
}
function fmtMinutes(ms) {
  const min = Math.round(Math.abs(ms) / 60000)
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}
function stOpt(v) { return STATUS_OPTS.find(o => o.v === v) || { v, l: v, c: '' } }

function dateStamp() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Reminder helpers ─────────────────────────────────────────────────
function getMostRecentLogTime(entries, keyword) {
  const kw = keyword.toLowerCase()
  let best = null
  for (const e of entries) {
    if (!e.text?.toLowerCase().includes(kw)) continue
    const d = parseLogTimeToDate(e.time)
    if (d && (!best || d.getTime() > best.getTime())) best = d
  }
  return best
}

function calcReminderStatus(last, intervalMins) {
  const intervalMs = intervalMins * 60000
  if (!last) return { status: 'overdue', elapsed: null, remaining: 0 }
  const elapsed = Date.now() - last.getTime()
  const remaining = intervalMs - elapsed
  if (remaining <= 0) return { status: 'overdue', elapsed, remaining }
  if (remaining <= 15 * 60000) return { status: 'warn', elapsed, remaining }
  return { status: 'ok', elapsed, remaining }
}

// ── Main component ────────────────────────────────────────────────────
export default function ReportTab({ onNavigate }) {
  const { data, patchData, saveData, loadData } = useData()
  const { hasPerm } = usePermission()

  const clients  = data?.clients  || []
  const reports  = data?.reports  || []
  const activeId = data?.active_report_id ?? null
  const activeReport = reports.find(r => r.id === activeId) ?? null

  const canStatus     = hasPerm('status.edit')
  const canLog        = hasPerm('log.add')
  const canDelLog     = hasPerm('log.delete')
  const canIssues     = hasPerm('issues.edit')
  const canCreate     = hasPerm('reports.create')
  const canClose      = hasPerm('reports.close')
  const canUA         = hasPerm('ua.request')
  const canReminders  = hasPerm('reminders.view')
  const canViolations = hasPerm('violations.log')
  const canMailLog    = hasPerm('mail.log')

  // Settings from data
  const wellnessMins = Number(data?.wellness_interval_mins ?? 120)
  const walkMins     = Number(data?.walk_interval_mins     ?? 240)
  const walkAreas    = Array.isArray(data?.walk_areas) ? data.walk_areas : DEFAULT_WALK_AREAS
  const uaPanel      = Array.isArray(data?.ua_panel) ? data.ua_panel : ['ETG','THC','FEN','AMP','MET','BZO','MTD','BUP','COC']

  // UI visibility
  const uiVis = useMemo(() => {
    const def = { tabs: {}, buttons: {} }
    if (!data?.ui_visibility) return def
    try { return typeof data.ui_visibility === 'string' ? JSON.parse(data.ui_visibility) : data.ui_visibility }
    catch { return def }
  }, [data?.ui_visibility])
  const showWellness    = uiVis.buttons?.wellness    !== false
  const showWalkthrough = uiVis.buttons?.walkthrough !== false

  // Local editable state
  const [reportDate, setReportDate] = useState(todayStr)
  const [shift, setShift]           = useState(autoShift)
  const [modName, setModName]       = useState('')
  const [statuses, setStatuses]     = useState({})
  const [comments, setComments]     = useState({})
  const [issues, setIssues]         = useState([])
  const [medNotes, setMedNotes]     = useState([])

  // Add-form state
  const [logTime, setLogTime] = useState('')
  const [logText, setLogText] = useState('')
  const [issueText, setIssueText] = useState('')
  const [medText, setMedText]   = useState('')

  // Roster UI
  const [sortKey, setSortKey] = useState('room')
  const [sortDir, setSortDir] = useState(1)
  const [search, setSearch]   = useState('')
  const [creating, setCreating] = useState(false)

  // Quick modal
  const [quickModal, setQuickModal] = useState(null)

  // Reminder tick (every 30s)
  const [reminderTick, setReminderTick] = useState(0)
  useEffect(() => {
    if (!canReminders) return
    const id = setInterval(() => setReminderTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [canReminders])

  // Refs
  const syncedIdRef  = useRef(null)
  const stateRef     = useRef({})
  const dataRef      = useRef(data)
  const saveTimer    = useRef(null)
  const logTextRef   = useRef(null)
  const issueRef     = useRef(null)
  const medRef       = useRef(null)

  useEffect(() => {
    stateRef.current = { reportDate, shift, modName, statuses, comments, issues, medNotes }
  })
  useEffect(() => { dataRef.current = data }, [data])

  // Sync local state when active report changes
  useEffect(() => {
    if (activeReport && activeReport.id !== syncedIdRef.current) {
      syncedIdRef.current = activeReport.id
      setReportDate(activeReport.report_date || todayStr())
      setShift(activeReport.shift || 'Swing Shift')
      setModName(activeReport.mod_name || '')
      setStatuses({ ...(activeReport.statuses || {}) })
      setComments({ ...(activeReport.comments || {}) })
      setIssues([...(activeReport.issues || [])])
      setMedNotes([...(activeReport.med_notes || [])])
    } else if (!activeId && syncedIdRef.current !== null) {
      syncedIdRef.current = null
    }
  }, [activeReport, activeId])

  // Census
  const census = useMemo(() => {
    const cnt = { building: 0, work: 0, pass: 0, bhc: 0, efc: 0, hospital: 0, out: 0 }
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .forEach(c => { const st = statuses[c.id] || 'building'; if (Object.hasOwn(cnt, st)) cnt[st]++ })
    return cnt
  }, [clients, statuses])
  const censusTotal = Object.values(census).reduce((a, b) => a + b, 0)

  // Log entries — sortable by time or type
  const [logSortKey, setLogSortKey] = useState('time') // 'time' | 'type'
  const [logSortDir, setLogSortDir] = useState(1)      // 1 asc, -1 desc

  // Raw chronological entries (used for reminder calcs — must stay time-asc regardless of UI sort)
  const logEntriesRaw = useMemo(
    () => [...(activeReport?.log_entries ?? [])].sort((a, b) => parseTimeMins(a.time) - parseTimeMins(b.time)),
    [activeReport?.log_entries]
  )

  // Display-sorted entries (drives the rendered log list)
  const logEntries = useMemo(() => {
    const arr = [...logEntriesRaw]
    if (logSortKey === 'type') {
      arr.sort((a, b) => {
        const ta = classifyLogEntry(a.text), tb = classifyLogEntry(b.text)
        if (ta !== tb) return ta.localeCompare(tb) * logSortDir
        return (parseTimeMins(a.time) - parseTimeMins(b.time)) * logSortDir
      })
    } else {
      arr.sort((a, b) => (parseTimeMins(a.time) - parseTimeMins(b.time)) * logSortDir)
    }
    return arr
  }, [logEntriesRaw, logSortKey, logSortDir])

  function toggleLogSort(key) {
    if (logSortKey === key) setLogSortDir(d => -d)
    else { setLogSortKey(key); setLogSortDir(1) }
  }

  // Print modal state for Activity Log
  const [logPrintOpen, setLogPrintOpen] = useState(false)

  // Reminders — separate the "last" timestamp from the status calc so we can key dismiss state to it
  const wellnessLast = useMemo(
    () => getMostRecentLogTime(logEntriesRaw, 'wellness check'),
    [logEntriesRaw]
  )
  const walkLast = useMemo(
    () => getMostRecentLogTime(logEntriesRaw, 'walkthrough'),
    [logEntriesRaw]
  )

  const wellnessReminder = useMemo(() => {
    if (!canReminders) return null
    return calcReminderStatus(wellnessLast, wellnessMins)
  // reminderTick forces recalc every 30s
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wellnessLast, wellnessMins, canReminders, reminderTick])

  const walkReminder = useMemo(() => {
    if (!canReminders) return null
    return calcReminderStatus(walkLast, walkMins)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkLast, walkMins, canReminders, reminderTick])

  // Dismissed reminders — keyed by (reportId|type|lastLogTime). When a new log gets added, lastLogTime
  // changes and the key no longer matches, so the reminder re-shows naturally.
  const [dismissedReminders, setDismissedReminders] = useState(() => new Set())
  function reminderKey(type, last) {
    return `${activeId}|${type}|${last ? last.getTime() : 'none'}`
  }
  const wellnessDismissed = canReminders && dismissedReminders.has(reminderKey('wellness', wellnessLast))
  const walkDismissed     = canReminders && dismissedReminders.has(reminderKey('walk',     walkLast))
  function dismissReminder(type, last) {
    setDismissedReminders(prev => {
      const next = new Set(prev)
      next.add(reminderKey(type, last))
      return next
    })
  }

  const hasReminderAlert = canReminders && (
    (wellnessReminder?.status !== 'ok' && !wellnessDismissed) ||
    (walkReminder?.status     !== 'ok' && !walkDismissed)
  )

  // Debounced save
  const scheduleSave = useCallback(() => {
    if (!activeId) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const s = stateRef.current
      const report = dataRef.current?.reports?.find(r => r.id === activeId)
      if (!report) return
      await saveData({
        reports: [{
          ...report,
          report_date: s.reportDate, shift: s.shift, mod_name: s.modName,
          statuses: s.statuses, comments: s.comments, issues: s.issues, med_notes: s.medNotes,
        }],
      })
    }, 900)
  }, [activeId, saveData])

  // New report
  const handleNewReport = useCallback(async () => {
    if (!window.confirm('Start a new shift report?\n\nIssues and current statuses will carry over.')) return
    setCreating(true)
    try {
      const s = stateRef.current
      const nextId = Math.max(0, ...reports.map(r => r.id)) + 1
      await saveData({
        reports: [{
          id: nextId, report_date: todayStr(), shift: autoShift(), mod_name: '',
          is_closed: false, statuses: { ...s.statuses }, comments: {},
          last_ua: {}, last_room_search: {},
          issues: [...s.issues], med_notes: [...s.medNotes], log_entries: [],
        }],
        active_report_id: nextId,
      })
    } finally { setCreating(false) }
  }, [reports, saveData])

  // Close shift
  const handleCloseShift = useCallback(async () => {
    if (!activeId) return
    const report = dataRef.current?.reports?.find(r => r.id === activeId)
    if (!report) return
    const s = stateRef.current
    if (!window.confirm(`Close ${s.shift || 'this shift'}? This will lock the report.`)) return
    await saveData({
      reports: [{
        ...report, report_date: s.reportDate, shift: s.shift, mod_name: s.modName,
        statuses: s.statuses, comments: s.comments, issues: s.issues, med_notes: s.medNotes,
        is_closed: true, roster_snapshot: clients.slice(),
      }],
      active_report_id: null,
    })
  }, [activeId, clients, saveData])

  // Status change
  const handleStatusChange = useCallback((clientId, val) => {
    setStatuses(prev => ({ ...prev, [clientId]: val }))
    if (activeId) patchData({ reportId: activeId, statuses: { [clientId]: val } })
  }, [activeId, patchData])

  // Comment change
  const handleCommentChange = useCallback((clientId, val) => {
    setComments(prev => ({ ...prev, [clientId]: val }))
    scheduleSave()
  }, [scheduleSave])

  // Meta change
  const handleMetaChange = useCallback((field, val) => {
    if (field === 'date') setReportDate(val)
    else if (field === 'shift') setShift(val)
    else if (field === 'mod') setModName(val)
    if (!activeId) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const s = stateRef.current
      patchData({ reportId: activeId, shiftData: { report_date: s.reportDate, shift: s.shift, mod_name: s.modName } })
    }, 900)
  }, [activeId, patchData])

  // Add log entry helper (used by manual form and quick actions)
  const addLogEntry = useCallback(async (text, timeStr) => {
    if (!text || !activeId) return
    await patchData({ reportId: activeId, log_entry: { time: timeStr || fmtTime(), text } })
    await loadData()
  }, [activeId, patchData, loadData])

  // Manual add log
  const handleAddLog = useCallback(async () => {
    const text = logText.trim()
    if (!text || !activeId) return
    let ts = logTime
    if (ts) {
      const [h, m] = ts.split(':')
      const hr = parseInt(h)
      ts = `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
    } else {
      ts = fmtTime()
    }
    setLogText(''); setLogTime('')
    await patchData({ reportId: activeId, log_entry: { time: ts, text } })
    await loadData()
    logTextRef.current?.focus()
  }, [logTime, logText, activeId, patchData, loadData])

  // Delete log entry
  const handleDelLog = useCallback(async (entryId) => {
    if (!window.confirm('Delete this log entry?')) return
    await fetch(`/api/log/${entryId}`, { method: 'DELETE', credentials: 'include' })
    await loadData()
  }, [loadData])

  // Issues
  const handleAddIssue = useCallback(async () => {
    const text = issueText.trim()
    if (!text || !activeId) return
    const next = [...issues, text]
    setIssues(next); setIssueText('')
    issueRef.current?.focus()
    await patchData({ reportId: activeId, issues: next })
  }, [issueText, issues, activeId, patchData])

  const handleRemoveIssue = useCallback(async (i) => {
    const next = issues.filter((_, idx) => idx !== i)
    setIssues(next)
    if (activeId) await patchData({ reportId: activeId, issues: next })
  }, [issues, activeId, patchData])

  // Medical notes
  const handleAddMed = useCallback(async () => {
    const text = medText.trim()
    if (!text || !activeId) return
    const next = [...medNotes, text]
    setMedNotes(next); setMedText('')
    medRef.current?.focus()
    await patchData({ reportId: activeId, med_notes: next })
  }, [medText, medNotes, activeId, patchData])

  const handleRemoveMed = useCallback(async (i) => {
    const next = medNotes.filter((_, idx) => idx !== i)
    setMedNotes(next)
    if (activeId) await patchData({ reportId: activeId, med_notes: next })
  }, [medNotes, activeId, patchData])

  // UA request from roster
  const handleUARequest = useCallback(async (clientId, clientName, room) => {
    if (!window.confirm(`Request UA for ${clientName} (Room ${room})?`)) return
    await fetch('/api/ua-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ client_id: clientId, client_name: clientName, room }),
    })
  }, [])

  // Roster sort
  const handleSort = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) { setSortDir(d => d * -1); return prev }
      setSortDir(1); return key
    })
  }, [])

  // Sorted + filtered roster
  const lastUa = activeReport?.last_ua || {}
  const lastRs = activeReport?.last_room_search || {}
  const sortedClients = useMemo(() => {
    return clients.filter(c => c.is_active)
      .filter(c => {
        if (!search) return true
        const q = search.toLowerCase()
        return String(c.room).toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
      })
      .slice()
      .sort((a, b) => {
        let av, bv
        switch (sortKey) {
          case 'room': return ((parseInt(a.room) || 0) - (parseInt(b.room) || 0)) * sortDir
          case 'name': av = (a.name||'').toLowerCase(); bv = (b.name||'').toLowerCase(); break
          case 'status': {
            const lbls = { building:'In Building',work:'Work',pass:'Weekend Pass',bhc:'BHC',efc:'EFC',hospital:'Hospital',out:'Out/Other',vacant:'Vacant' }
            av = lbls[statuses[a.id]||(a.name==='VACANT'?'vacant':'building')]||''
            bv = lbls[statuses[b.id]||(b.name==='VACANT'?'vacant':'building')]||''
            break
          }
          case 'last_ua': av = lastUa[a.id]||''; bv = lastUa[b.id]||''; break
          case 'last_rs': av = lastRs[a.id]||''; bv = lastRs[b.id]||''; break
          default: av = ''; bv = ''
        }
        return av < bv ? -sortDir : av > bv ? sortDir : 0
      })
  }, [clients, search, sortKey, sortDir, statuses, lastUa, lastRs])

  const isClosed = activeReport?.is_closed ?? false

  // Active non-special, non-VACANT clients for quick action dropdowns
  const rosterClients = useMemo(
    () => clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT'),
    [clients]
  )

  // ── No active report ──────────────────────────────────────────────
  if (!activeId && !creating) {
    return (
      <div className="empty-state" style={{ paddingTop: 60 }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📋</div>
        <h2 style={{ fontWeight: 700, marginBottom: 8, color: 'var(--dark)', fontSize: '1.1rem' }}>
          No Active Shift Report
        </h2>
        <p style={{ marginBottom: 20 }}>Start a new report to begin logging this shift.</p>
        {canCreate && (
          <button className="btn btn-primary" onClick={handleNewReport}>
            + New Shift Report
          </button>
        )}
      </div>
    )
  }

  // ── Report ────────────────────────────────────────────────────────
  return (
    <div>
      {/* Meta */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left">
            <span className="sh-dot" />
            <span>Shift Report {activeId ? `#${activeId}` : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            {isClosed && (
              <span style={{ fontSize: '.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '.08em' }}>
                CLOSED
              </span>
            )}
            {canClose && !isClosed && activeId && (
              <button className="btn btn-sm btn-danger-sm" onClick={handleCloseShift}>Close Shift</button>
            )}
            {canCreate && (
              <button className="btn btn-sm btn-primary" onClick={handleNewReport} disabled={creating}>
                {creating ? 'Creating…' : '+ New Report'}
              </button>
            )}
          </div>
        </div>
        <div className="section-body">
          <div className="meta-grid">
            <div className="field">
              <label>Date</label>
              <input type="date" value={reportDate} disabled={isClosed}
                onChange={e => handleMetaChange('date', e.target.value)} />
            </div>
            <div className="field">
              <label>Shift</label>
              <select value={shift} disabled={isClosed}
                onChange={e => handleMetaChange('shift', e.target.value)}>
                <option value="Day Shift">Day Shift ({data?.shift_day_start || '7:00 AM'} – {data?.shift_swing_start || '3:00 PM'})</option>
                <option value="Swing Shift">Swing Shift ({data?.shift_swing_start || '3:00 PM'} – {data?.shift_grave_start || '11:00 PM'})</option>
                <option value="Graveyard Shift">Graveyard Shift ({data?.shift_grave_start || '11:00 PM'} – {data?.shift_day_start || '7:00 AM'})</option>
              </select>
            </div>
            <div className="field">
              <label>Program Assistant on Duty (PA)</label>
              <input type="text" value={modName} placeholder="Name(s)" disabled={isClosed}
                onChange={e => handleMetaChange('mod', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Census */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Census</span></div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>
            {censusTotal} residents
          </span>
        </div>
        <div className="section-body">
          <div className="census-grid">
            {[
              { key: 'building', label: 'In Building' },
              { key: 'work',     label: 'Work' },
              { key: 'pass',     label: 'Pass' },
              { key: 'bhc',      label: 'BHC' },
              { key: 'efc',      label: 'EFC' },
              { key: 'hospital', label: 'Hospital' },
              { key: 'out',      label: 'Out / Other' },
            ].map(({ key, label }) => (
              <div key={key} className={`census-card${census[key] > 0 ? ' hi' : ''}`}>
                <div className="count">{census[key]}</div>
                <div className="clabel">{label}</div>
              </div>
            ))}
            <div className="census-card hi">
              <div className="count">{censusTotal}</div>
              <div className="clabel">Total</div>
            </div>
          </div>
        </div>
      </div>

      {/* Reminder bar */}
      {canReminders && (
        (showWellness && wellnessReminder && !wellnessDismissed) ||
        (showWalkthrough && walkReminder && !walkDismissed)
      ) && (
        <div className="reminder-bar">
          {showWellness && wellnessReminder && !wellnessDismissed && (
            <ReminderCard
              label="Wellness Check"
              status={wellnessReminder.status}
              remaining={wellnessReminder.remaining}
              intervalMins={wellnessMins}
              onDismiss={() => dismissReminder('wellness', wellnessLast)}
            />
          )}
          {showWalkthrough && walkReminder && !walkDismissed && (
            <ReminderCard
              label="Walkthrough"
              status={walkReminder.status}
              remaining={walkReminder.remaining}
              intervalMins={walkMins}
              onDismiss={() => dismissReminder('walk', walkLast)}
            />
          )}
        </div>
      )}

      {/* Activity Log */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Activity Log</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>
              {logEntries.length} {logEntries.length === 1 ? 'entry' : 'entries'}
            </span>
            <div style={{ display: 'flex', gap: 4, fontSize: '.7rem' }}>
              <button onClick={() => toggleLogSort('time')} title="Sort by time"
                style={sortBtnStyle(logSortKey === 'time', logSortDir)}>
                Time {logSortKey === 'time' ? (logSortDir > 0 ? '↑' : '↓') : ''}
              </button>
              <button onClick={() => toggleLogSort('type')} title="Sort by type"
                style={sortBtnStyle(logSortKey === 'type', logSortDir)}>
                Type {logSortKey === 'type' ? (logSortDir > 0 ? '↑' : '↓') : ''}
              </button>
            </div>
            <button onClick={() => setLogPrintOpen(true)}
              title="Print activity log"
              style={{
                fontSize: '.72rem', padding: '4px 10px',
                background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
                color: '#fff', borderRadius: 5, cursor: 'pointer', fontWeight: 600,
              }}>
              🖨 Print
            </button>
          </div>
        </div>
        <div className="section-body">
          {/* Quick-action pills */}
          {canLog && !isClosed && (
            <div className="pill-bar">
              {showWellness && (
                <button className="pill pill-green" onClick={() => setQuickModal('wellness')}>
                  ✓ Wellness Check
                </button>
              )}
              {showWalkthrough && (
                <button className="pill pill-blue" onClick={() => setQuickModal('walk')}>
                  ⊕ Walkthrough
                </button>
              )}
              <button className="pill pill-yellow" onClick={() => setQuickModal('lunch')}>
                🍕 Lunch Break
              </button>
              <button className="pill pill-orange" onClick={() => setQuickModal('ua')}>
                🧪 UA
              </button>
              <button className="pill pill-slate" onClick={() => setQuickModal('roomsearch')}>
                🔎 Room Search
              </button>
              {canMailLog && (
                <button className="pill pill-slate" onClick={() => setQuickModal('mail')}>
                  ✉ Mail
                </button>
              )}
              {canViolations && (
                <button className="pill pill-red" onClick={() => setQuickModal('violation')}>
                  ⚠ Violation
                </button>
              )}
            </div>
          )}

          <div className="roster-wrap log-table-wrap">
            {logEntries.length === 0 && (
              <div style={{ color: '#94a3b8', fontSize: '.84rem', padding: '4px 2px' }}>No entries yet.</div>
            )}
            {logEntries.length > 0 && (
              <table className="log-table">
                <thead>
                  <tr>
                    <th className="log-th">Time</th>
                    <th className="log-th">Type</th>
                    <th className="log-th">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logEntries.map(e => (
                    <LogEntry key={e.id ?? e.time + e.text} entry={e} canDelete={canDelLog} onDelete={handleDelLog} onPhotoSaved={loadData} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {canLog && !isClosed && (
            <div className="log-add">
              <input type="time" value={logTime} onChange={e => setLogTime(e.target.value)} />
              <input
                ref={logTextRef} type="text" value={logText}
                onChange={e => setLogText(e.target.value)}
                placeholder="Entry text…"
                onKeyDown={e => e.key === 'Enter' && handleAddLog()}
              />
              <button className="btn-add btn-add-b" onClick={handleAddLog}>+ Add</button>
            </div>
          )}
        </div>
      </div>

      {/* Issues & Concerns */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Issues & Concerns</span></div>
        </div>
        <div className="section-body">
          <div className="issues-list">
            {issues.length === 0 && (
              <div style={{ color: '#94a3b8', fontSize: '.84rem', padding: '4px 0' }}>None recorded.</div>
            )}
            {issues.map((v, i) => (
              <div key={i} className="issue-item">
                <span className="issue-text">{v}</span>
                {canIssues && !isClosed && (
                  <button className="del-btn" onClick={() => handleRemoveIssue(i)}>&times;</button>
                )}
              </div>
            ))}
          </div>
          {canIssues && !isClosed && (
            <div className="issue-add">
              <input ref={issueRef} type="text" value={issueText}
                onChange={e => setIssueText(e.target.value)}
                placeholder="Add issue…" onKeyDown={e => e.key === 'Enter' && handleAddIssue()} />
              <button className="btn-add btn-add-a" onClick={handleAddIssue}>+ Add</button>
            </div>
          )}
        </div>
      </div>

      {/* Medical Notes */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Medical Notes</span></div>
        </div>
        <div className="section-body">
          <div className="issues-list">
            {medNotes.length === 0 && (
              <div style={{ color: '#94a3b8', fontSize: '.84rem', padding: '4px 0' }}>None recorded.</div>
            )}
            {medNotes.map((v, i) => (
              <div key={i} className="issue-item" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
                <span className="issue-text">{v}</span>
                {canIssues && !isClosed && (
                  <button className="del-btn" onClick={() => handleRemoveMed(i)}>&times;</button>
                )}
              </div>
            ))}
          </div>
          {canIssues && !isClosed && (
            <div className="issue-add">
              <input ref={medRef} type="text" value={medText}
                onChange={e => setMedText(e.target.value)}
                placeholder="Add medical note…" onKeyDown={e => e.key === 'Enter' && handleAddMed()} />
              <button className="btn-add btn-add-b" onClick={handleAddMed}>+ Add</button>
            </div>
          )}
        </div>
      </div>

      {/* Roster */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Roster</span></div>
          <input
            type="text" placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              fontSize: '.78rem', padding: '4px 10px',
              border: '1px solid rgba(255,255,255,.2)', borderRadius: 5,
              background: 'rgba(255,255,255,.1)', color: '#fff', outline: 'none', width: 160,
            }}
          />
        </div>
        <div className="section-body" style={{ padding: 0 }}>
          <div className="roster-wrap">
            <table>
              <thead>
                <tr>
                  <SortTh k="room"    label="Rm"               sortKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortTh k="name"    label="Name"             sortKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortTh k="status"  label="Status"           sortKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortTh k="last_ua" label="Last UA"          sortKey={sortKey} dir={sortDir} onSort={handleSort} className="tc" />
                  <SortTh k="last_rs" label="Last Room Search" sortKey={sortKey} dir={sortDir} onSort={handleSort} className="tc" />
                  <th>Comment</th>
                  {canUA && <th className="tc">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {sortedClients.map(c => (
                  <RosterRow
                    key={c.id} client={c}
                    status={statuses[c.id]} comment={comments[c.id] || ''}
                    lastUA={lastUa[c.id]} lastRS={lastRs[c.id]}
                    isClosed={isClosed} canStatus={canStatus} canUA={canUA}
                    onStatusChange={handleStatusChange}
                    onCommentChange={handleCommentChange}
                    onUARequest={handleUARequest}
                  />
                ))}
                {sortedClients.length === 0 && (
                  <tr>
                    <td colSpan={canUA ? 7 : 6}
                      style={{ textAlign: 'center', padding: '24px', color: '#94a3b8', fontSize: '.88rem' }}>
                      No residents found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Quick action modals */}
      {quickModal === 'wellness' && (
        <WellnessModal
          clients={data?.clients || []}
          statuses={statuses}
          onClose={() => setQuickModal(null)}
          onSubmit={addLogEntry}
        />
      )}
      {quickModal === 'walk' && (
        <WalkthroughModal
          areas={walkAreas}
          onClose={() => setQuickModal(null)}
          onSubmit={addLogEntry}
        />
      )}
      {quickModal === 'lunch' && (
        <LunchModal
          onClose={() => setQuickModal(null)}
          onSubmit={addLogEntry}
        />
      )}
      {quickModal === 'ua' && (
        <ConductUAModal
          clients={rosterClients}
          panel={uaPanel}
          onClose={() => setQuickModal(null)}
          onSaved={async () => { setQuickModal(null); await loadData() }}
        />
      )}
      {quickModal === 'roomsearch' && (
        <RoomSearchModal
          clients={rosterClients}
          onClose={() => setQuickModal(null)}
          onSubmit={async (text, timeStr, clientId) => {
            await addLogEntry(text, timeStr)
            if (clientId && activeId) {
              await patchData({ reportId: activeId, last_room_search: { [clientId]: dateStamp() } })
            }
          }}
        />
      )}
      {quickModal === 'mail' && (
        <MailQuickModal
          clients={rosterClients}
          onClose={() => setQuickModal(null)}
        />
      )}
      {quickModal === 'violation' && (
        <ViolationModal
          clients={rosterClients}
          onClose={() => setQuickModal(null)}
          onLogEntry={addLogEntry}
        />
      )}

      <PrintScopeModal
        open={logPrintOpen}
        title="Print Activity Log"
        shiftLabel="This shift"
        defaultMode="shift"
        onClose={() => setLogPrintOpen(false)}
        onConfirm={({ mode, startDate, endDate }) => {
          setLogPrintOpen(false)
          const facility = data?.facility_name || 'OpsPoint'
          if (mode === 'shift') {
            printActivityLogReport({
              facility,
              report: activeReport,
              entries: logEntries,
            })
          } else {
            const inRange = reports.filter(r =>
              r.report_date && r.report_date >= startDate && r.report_date <= endDate
            )
            const allEntries = []
            inRange.forEach(r => {
              (r.log_entries || []).forEach(e => {
                allEntries.push({ ...e, _report: r })
              })
            })
            allEntries.sort((a, b) => {
              const da = a._report?.report_date || ''
              const db = b._report?.report_date || ''
              if (da !== db) return da.localeCompare(db)
              return parseTimeMins(a.time) - parseTimeMins(b.time)
            })
            printActivityLogReport({
              facility,
              entries: allEntries,
              rangeLabel: `${fmtDateFriendly(startDate)} – ${fmtDateFriendly(endDate)}`,
              includeReportContext: true,
            })
          }
        }}
      />
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────
function sortBtnStyle(active, dir) {
  return {
    padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
    fontSize: '.7rem', fontWeight: 600,
    background: active ? '#D97706' : 'rgba(255,255,255,.1)',
    border: `1px solid ${active ? '#D97706' : 'rgba(255,255,255,.2)'}`,
    color: '#fff',
  }
}

function printActivityLogReport({ facility, report, entries, rangeLabel, includeReportContext }) {
  let subtitle = ''
  if (report) {
    subtitle = `${report.shift || 'Shift'} — ${fmtDateFriendly(report.report_date)}`
    if (report.mod_name) subtitle += `  ·  MOD: ${report.mod_name}`
  } else if (rangeLabel) {
    subtitle = `Date range: ${rangeLabel}`
  }

  const summary = [
    ['Entries',       entries.length],
    ['Wellness',      entries.filter(e => /wellness check/i.test(e.text || '')).length],
    ['Walkthroughs',  entries.filter(e => /walkthrough/i.test(e.text || '')).length],
    ['UA records',    entries.filter(e => /\s—\sua:/i.test(e.text || '')).length],
    ['Violations',   entries.filter(e => /violation/i.test(e.text || '')).length],
  ]

  const columns = [
    ...(includeReportContext
      ? [
        { key: 'date', label: 'Date',  width: '95px', mono: true },
        { key: 'shift', label: 'Shift', width: '70px' },
      ]
      : []
    ),
    { key: 'time',  label: 'Time', width: '70px',  mono: true },
    { key: 'type',  label: 'Type', width: '100px' },
    { key: 'text',  label: 'Entry' },
  ]

  const rows = entries.map(e => {
    const isPos = e.text && /POS:/.test(e.text)
    const row = {
      time: e.time || '—',
      type: classifyLogEntry(e.text),
      text: e.text || '',
      _flagged: isPos,
    }
    if (includeReportContext) {
      const r = e._report || {}
      row.date  = r.report_date ? fmtDateFriendly(r.report_date) : '—'
      row.shift = r.shift ? r.shift.replace(' Shift', '') : '—'
    }
    return row
  })

  openPrintWindow({
    title: 'Activity Log',
    facility,
    subtitle,
    summary,
    columns,
    rows,
    rowStyle: r => r._flagged ? 'background:#fff5f5;border-left:3px solid #dc2626;' : '',
    emptyMessage: 'No log entries in the selected scope.',
  })
}

// ── Reminder Card ─────────────────────────────────────────────────────
function ReminderCard({ label, status, remaining, intervalMins, onDismiss }) {
  let cls = 'reminder-card ok'
  let text = ''
  if (status === 'overdue') {
    cls = 'reminder-card overdue'
    text = `OVERDUE — ${label} past ${intervalMins}m interval`
  } else if (status === 'warn') {
    cls = 'reminder-card warn'
    text = `${label} due in ${fmtMinutes(remaining)}`
  } else {
    text = `${label} — next in ${fmtMinutes(remaining)}`
  }
  return (
    <div className={cls} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span>{status === 'overdue' ? '🔴' : status === 'warn' ? '🟡' : '🟢'}</span>
      <span className="rtime">{text}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss until next log entry"
          aria-label="Dismiss reminder"
          style={{
            marginLeft: 6, padding: '0 6px',
            background: 'transparent', border: 'none',
            color: 'currentColor', opacity: .55,
            cursor: 'pointer', fontSize: '1.05rem', lineHeight: 1,
            fontWeight: 700, borderRadius: 4,
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '.55' }}
        >×</button>
      )}
    </div>
  )
}

// ── Quick-action modals ───────────────────────────────────────────────

function timeFieldDefault() {
  const now = new Date()
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
}

function tsFromInput(val) {
  if (!val) return fmtTime()
  const [h, m] = val.split(':')
  const hr = parseInt(h)
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
}

// Wellness Check
function WellnessModal({ clients = [], statuses = {}, onClose, onSubmit }) {
  const [by, setBy]       = useState('')
  const [time, setTime]   = useState(timeFieldDefault)
  const [saving, setSaving] = useState(false)
  // notLocated: Set of client IDs checked as "not found"
  const [notLocated, setNotLocated] = useState(new Set())
  const byRef = useRef(null)
  useEffect(() => { setTimeout(() => byRef.current?.focus(), 60) }, [])

  const activeClients = (clients || [])
    .filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
    .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0))

  const stLabel = { building: 'In Building', work: 'Work', pass: 'Pass', bhc: 'BHC', efc: 'EFC', hospital: 'Hospital', out: 'Out/Other' }

  function toggleNotLocated(id) {
    setNotLocated(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleSubmit() {
    setSaving(true)
    const notFoundList = activeClients.filter(c => notLocated.has(c.id))
    const total = activeClients.length
    let msg = `Wellness check conducted${by ? ' by ' + by.trim() : ''}. `
    if (notFoundList.length === 0) {
      msg += `All ${total} clients accounted for.`
    } else {
      const names = notFoundList.map(c => `Rm. ${c.room} ${c.name}`).join(', ')
      msg += `${total - notFoundList.length} of ${total} clients accounted for. Not located: ${names}.`
    }
    await onSubmit(msg, tsFromInput(time))
    setSaving(false)
    onClose()
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <h2>✓ Wellness Check</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Conducted by</label>
            <input ref={byRef} type="text" value={by} onChange={e => setBy(e.target.value)}
              placeholder="PA name" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          </div>
          <div className="field">
            <label>Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
          {activeClients.length > 0 && (
            <div className="field">
              <label>
                Not Located
                <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>
                  (check anyone not found)
                </span>
              </label>
              <div style={{
                maxHeight: 240, overflowY: 'auto', overflowX: 'hidden',
                border: '1.5px solid var(--line)', borderRadius: 6,
                background: '#fff',
              }}>
                {activeClients.map((c, i) => {
                  const st = statuses[c.id] || 'building'
                  const marked = notLocated.has(c.id)
                  return (
                    <div key={c.id} onClick={() => toggleNotLocated(c.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px',
                      borderBottom: i < activeClients.length - 1 ? '1px solid #f1f5f9' : 'none',
                      cursor: 'pointer', userSelect: 'none',
                      background: marked ? '#fee2e2' : 'transparent',
                      transition: 'background .1s',
                    }}>
                      <input type="checkbox" checked={marked} onChange={() => {}}
                        style={{ pointerEvents: 'none', accentColor: '#dc2626', flexShrink: 0, width: 14, height: 14 }} />
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: '.75rem', fontWeight: 700,
                        color: marked ? '#dc2626' : '#94a3b8',
                        background: marked ? '#fecaca' : '#f1f5f9',
                        padding: '1px 6px', borderRadius: 4,
                        flexShrink: 0, minWidth: 32, textAlign: 'center',
                      }}>
                        {c.room}
                      </span>
                      <span style={{
                        flex: 1, fontSize: '.85rem',
                        fontWeight: marked ? 700 : 500,
                        color: marked ? '#991b1b' : '#1e293b',
                      }}>{c.name}</span>
                      <span style={{ fontSize: '.7rem', color: '#94a3b8', flexShrink: 0 }}>{stLabel[st] || st}</span>
                    </div>
                  )
                })}
              </div>
              {notLocated.size > 0 && (
                <div style={{ fontSize: '.75rem', color: '#dc2626', fontWeight: 600, marginTop: 4 }}>
                  {notLocated.size} resident{notLocated.size !== 1 ? 's' : ''} not located
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Logging…' : 'Log Entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Walkthrough
function WalkthroughModal({ areas, onClose, onSubmit }) {
  const [by, setBy]         = useState('')
  const [checked, setChecked] = useState(() => Object.fromEntries(areas.map(a => [a, true])))
  const [issues, setIssues] = useState('')
  const [time, setTime]     = useState(timeFieldDefault)
  const [saving, setSaving] = useState(false)

  function toggleArea(a) { setChecked(prev => ({ ...prev, [a]: !prev[a] })) }
  function setAll(val)   { setChecked(Object.fromEntries(areas.map(a => [a, val]))) }

  async function handleSubmit() {
    setSaving(true)
    const checkedAreas   = areas.filter(a => checked[a])
    const uncheckedAreas = areas.filter(a => !checked[a])
    let msg
    if (checkedAreas.length === 0) {
      msg = `Building walkthrough conducted${by ? ' by ' + by.trim() : ''}. ${issues.trim() || 'All is well, nothing to report.'}`
    } else if (uncheckedAreas.length === 0) {
      msg = `Building walkthrough conducted${by ? ' by ' + by.trim() : ''}. All areas checked: ${checkedAreas.join(', ')}. ${issues.trim() || 'All is well, nothing to report.'}`
    } else {
      msg = `Building walkthrough conducted${by ? ' by ' + by.trim() : ''}. Areas checked: ${checkedAreas.join(', ')}. Not checked: ${uncheckedAreas.join(', ')}. ${issues.trim() || 'All is well, nothing to report.'}`
    }
    await onSubmit(msg, tsFromInput(time))
    setSaving(false)
    onClose()
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h2>⊕ Building Walkthrough</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Conducted by</label>
            <input type="text" value={by} onChange={e => setBy(e.target.value)} placeholder="PA name" autoFocus />
          </div>
          <div className="field">
            <label>Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ marginBottom: 0 }}>Areas Checked</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setAll(true)}
                  style={{ fontSize: '.7rem', padding: '2px 8px', border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer', background: '#dcfce7', color: '#15803d', fontWeight: 600 }}>
                  All ✓
                </button>
                <button type="button" onClick={() => setAll(false)}
                  style={{ fontSize: '.7rem', padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer', background: '#f8fafc' }}>
                  None
                </button>
              </div>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4,
              border: '1.5px solid var(--line)', borderRadius: 7, padding: '8px', background: '#f8fafc',
            }}>
              {areas.map(a => (
                <div key={a} onClick={() => toggleArea(a)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: '.83rem', cursor: 'pointer',
                  padding: '7px 10px', borderRadius: 5,
                  background: checked[a] ? '#dcfce7' : '#fff',
                  border: `1px solid ${checked[a] ? '#86efac' : '#e2e8f0'}`,
                  transition: 'all .1s', userSelect: 'none',
                  minWidth: 0,
                }}>
                  <input type="checkbox" checked={!!checked[a]} onChange={() => {}}
                    style={{ pointerEvents: 'none', accentColor: '#16a34a', flexShrink: 0, width: 14, height: 14 }} />
                  <span style={{
                    lineHeight: 1.3,
                    fontWeight: checked[a] ? 600 : 400,
                    color: checked[a] ? '#15803d' : '#374151',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{a}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Issues <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
            <input type="text" value={issues} onChange={e => setIssues(e.target.value)}
              placeholder="All is well, nothing to report." />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Logging…' : 'Log Entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Lunch Break
function LunchModal({ onClose, onSubmit }) {
  const [direction, setDirection] = useState('out')
  const [name, setName]           = useState('')
  const [time, setTime]           = useState(timeFieldDefault)
  const [saving, setSaving]       = useState(false)
  const nameRef = useRef(null)
  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 60) }, [])

  async function handleSubmit() {
    if (!name.trim()) { nameRef.current?.focus(); return }
    setSaving(true)
    const msg = direction === 'out' ? `${name.trim()} took lunch.` : `${name.trim()} returned from lunch.`
    await onSubmit(msg, tsFromInput(time))
    setSaving(false)
    onClose()
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-head">
          <h2>🍕 Lunch Break</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Direction</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" onClick={() => setDirection('out')} style={{
                flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer', fontSize: '.85rem', fontWeight: 700,
                border: `2px solid ${direction === 'out' ? '#16a34a' : '#CBD5E1'}`,
                background: direction === 'out' ? '#dcfce7' : '#F1F5F9',
                color: direction === 'out' ? '#15803d' : '#475569',
                transition: 'all .12s',
              }}>🚪 Out — took lunch</button>
              <button type="button" onClick={() => setDirection('in')} style={{
                flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer', fontSize: '.85rem', fontWeight: 700,
                border: `2px solid ${direction === 'in' ? '#FCD34D' : '#CBD5E1'}`,
                background: direction === 'in' ? '#FEF3C7' : '#F1F5F9',
                color: direction === 'in' ? '#92400E' : '#475569',
                transition: 'all .12s',
              }}>↩ In — returned</button>
            </div>
          </div>
          <div className="field">
            <label>Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
          <div className="field">
            <label>PA name</label>
            <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Name" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Logging…' : 'Log Entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Room Search
function RoomSearchModal({ clients, onClose, onSubmit }) {
  const [clientId, setClientId] = useState('')
  const [staff, setStaff]       = useState('')
  const [findings, setFindings] = useState('')
  const [time, setTime]         = useState(timeFieldDefault)
  const [saving, setSaving]     = useState(false)

  async function handleSubmit() {
    const client = clients.find(c => c.id === parseInt(clientId))
    if (!client) return
    const msg = `Room search conducted on ${client.name} (Rm. ${client.room}) by ${staff.trim()}. Findings: ${findings.trim()}.`
    setSaving(true)
    await onSubmit(msg, tsFromInput(time), client.id)
    setSaving(false)
    onClose()
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2>🔎 Room Search</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
          <div className="field">
            <label>Resident</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)} autoFocus>
              <option value="">— Select resident —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>Rm. {c.room} — {c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Conducted by</label>
            <input type="text" value={staff} onChange={e => setStaff(e.target.value)} placeholder="Staff name" />
          </div>
          <div className="field">
            <label>Findings</label>
            <input type="text" value={findings} onChange={e => setFindings(e.target.value)}
              placeholder="Describe findings…"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !clientId || !staff.trim() || !findings.trim()}>
            {saving ? 'Logging…' : 'Log Entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Mail quick log
function MailQuickModal({ clients, onClose }) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [clientNotes, setClientNotes] = useState({}) // { [id]: string }
  const [clientTypes, setClientTypes] = useState({}) // { [id]: {letter:bool, package:bool, ...} }
  const [time, setTime]               = useState(timeFieldDefault)
  const [saving, setSaving]           = useState(false)

  function toggleClient(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function setNote(id, val) {
    setClientNotes(prev => ({ ...prev, [id]: val }))
  }
  function toggleType(id, t) {
    setClientTypes(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [t]: !(prev[id] || {})[t] } }))
  }
  function selectAll() { setSelectedIds(new Set(clients.map(c => c.id))) }
  function clearAll()  { setSelectedIds(new Set()); setClientNotes({}); setClientTypes({}) }

  async function handleSubmit() {
    if (selectedIds.size === 0) return
    setSaving(true)
    const selected = clients.filter(c => selectedIds.has(c.id))
    const clientsList = selected.map(c => {
      const t = clientTypes[c.id] || {}
      const typeArr = ['letter', 'package'].filter(k => t[k])
      return {
        client_id: c.id,
        client_name: c.name,
        room: c.room,
        notes: (clientNotes[c.id] || '').trim(),
        mail_type: typeArr.join(','),
      }
    })
    try {
      await fetch('/api/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clients: clientsList, log_time: tsFromInput(time) }),
      })
    } catch {}
    setSaving(false)
    onClose()
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <h2>✉ Mail</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <label style={{ marginBottom: 0 }}>Recipients</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={selectAll}
                  style={{ fontSize: '.68rem', padding: '2px 7px', border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer', background: '#f8fafc' }}>
                  All
                </button>
                <button type="button" onClick={clearAll}
                  style={{ fontSize: '.68rem', padding: '2px 7px', border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer', background: '#f8fafc' }}>
                  None
                </button>
              </div>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', overflowX: 'hidden', border: '1.5px solid var(--line)', borderRadius: 6, padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {clients.map(c => {
                const sel = selectedIds.has(c.id)
                return (
                  <Fragment key={c.id}>
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 6px', borderRadius: sel ? '5px 5px 0 0' : 5, cursor: 'pointer',
                      background: sel ? '#eff6ff' : '#f8fafc',
                      border: `1px solid ${sel ? '#93c5fd' : 'transparent'}`,
                      borderBottom: sel ? '1px solid transparent' : undefined,
                      fontSize: '.83rem', userSelect: 'none', color: 'var(--text)',
                    }}>
                      <input type="checkbox" checked={sel} onChange={() => toggleClient(c.id)}
                        style={{ accentColor: '#1d4ed8', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: '#64748b', minWidth: 34, flexShrink: 0 }}>{c.room}</span>
                      <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </label>
                    {sel && (
                      <div style={{
                        padding: '4px 8px 6px 34px',
                        background: '#eff6ff',
                        border: '1px solid #93c5fd', borderTop: 'none',
                        borderRadius: '0 0 5px 5px', marginTop: -2,
                        display: 'flex', gap: 6, alignItems: 'center',
                      }}>
                        {['letter', 'package'].map(t => {
                          const checked = !!(clientTypes[c.id] || {})[t]
                          return (
                            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', userSelect: 'none', whiteSpace: 'nowrap' }}>
                              <input type="checkbox" checked={checked}
                                onChange={() => toggleType(c.id, t)}
                                style={{ accentColor: '#1d4ed8', flexShrink: 0 }} />
                              {t}
                            </label>
                          )
                        })}
                        <input
                          type="text"
                          value={clientNotes[c.id] || ''}
                          onChange={e => setNote(c.id, e.target.value)}
                          placeholder="Notes (optional)"
                          style={{
                            flex: 1, minWidth: 0, fontSize: '.78rem', padding: '4px 8px',
                            border: '1px solid #bfdbfe', borderRadius: 4, outline: 'none',
                            background: '#fff', color: 'var(--text)', fontFamily: 'var(--sans)',
                          }}
                          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                        />
                      </div>
                    )}
                  </Fragment>
                )
              })}
              {clients.length === 0 && <div style={{ color: '#94a3b8', fontSize: '.82rem', padding: '6px 4px' }}>No active residents.</div>}
            </div>
            {selectedIds.size > 0 && (
              <div style={{ fontSize: '.74rem', color: '#1d4ed8', fontWeight: 600, marginTop: 4 }}>
                {selectedIds.size} recipient{selectedIds.size !== 1 ? 's' : ''} selected
              </div>
            )}
          </div>
          <div className="field" style={{ maxWidth: 180 }}>
            <label>Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || selectedIds.size === 0}>
            {saving ? 'Logging…' : `Log Mail${selectedIds.size > 1 ? ` (${selectedIds.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// Violation quick-log
function ViolationModal({ clients, onClose, onLogEntry }) {
  function todayStrLocal() { return new Date().toISOString().slice(0, 10) }
  const [form, setForm]     = useState({ client_id: '', client_name: '', room: '', violation_date: todayStrLocal(), description: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  function handleClientSelect(cid) {
    const c = clients.find(x => String(x.id) === String(cid))
    setForm(f => ({ ...f, client_id: cid, client_name: c?.name || '', room: c?.room || '' }))
  }

  async function handleSubmit() {
    if (!form.client_id) { setErr('Select a resident'); return }
    if (!form.description.trim()) { setErr('Description required'); return }
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/violations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          client_id:       parseInt(form.client_id),
          client_name:     form.client_name,
          room:            form.room,
          violation_date: form.violation_date,
          description:     form.description.trim(),
          notes:           form.notes,
        }),
      })
      if (!r.ok) { const j = await r.json(); setErr(j.error || 'Save failed'); return }
      // Log to activity log
      await onLogEntry(
        `Violation filed — ${form.client_name} (Rm. ${form.room}): ${form.description.trim()}`,
        fmtTime()
      )
      onClose()
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <h2>⚠ Log Violation</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {err && <div className="auth-error" style={{ marginBottom: 10 }}>{err}</div>}
          <div className="field">
            <label>Resident</label>
            <select value={form.client_id} onChange={e => handleClientSelect(e.target.value)} autoFocus>
              <option value="">— Select resident —</option>
              {clients.map(c => <option key={c.id} value={c.id}>Rm. {c.room} — {c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.violation_date} onChange={e => setForm(f => ({ ...f, violation_date: e.target.value }))} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={3} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the violation…"
              style={{ resize: 'vertical', width: '100%', fontFamily: 'var(--sans)', fontSize: '.88rem', padding: '7px 10px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div className="field">
            <label>Notes <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
            <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Additional context…" />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Log Violation'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────

function SortTh({ k, label, sortKey, dir, onSort, className }) {
  const active = sortKey === k
  return (
    <th className={className} onClick={() => onSort(k)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label}
      {active && <span style={{ marginLeft: 3, opacity: .65, fontSize: '.7em' }}>{dir === 1 ? '▲' : '▼'}</span>}
    </th>
  )
}

function RosterRow({ client: c, status, comment, lastUA, lastRS, isClosed, canStatus, canUA, onStatusChange, onCommentChange, onUARequest }) {
  const cur = status || (c.name === 'VACANT' ? 'vacant' : 'building')
  const opt = stOpt(cur)
  return (
    <tr className={c.is_special ? 'srow' : ''}>
      <td className="rm">{c.room}</td>
      <td className="name-cell">{c.name}</td>
      <td>
        {c.is_special ? (
          <span style={{ color: '#cbd5e1' }}>—</span>
        ) : c.name === 'VACANT' ? (
          <span className="ss s-vacant" style={{ display: 'inline-block', pointerEvents: 'none' }}>Vacant</span>
        ) : isClosed || !canStatus ? (
          <span className={`ss ${opt.c}`} style={{ display: 'inline-block', pointerEvents: 'none' }}>{opt.l}</span>
        ) : (
          <select className={`ss ${opt.c}`} value={cur} onChange={e => onStatusChange(c.id, e.target.value)}>
            {STATUS_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        )}
      </td>
      <td className="date-cell tc">{!c.is_special ? (lastUA || '—') : ''}</td>
      <td className="date-cell tc">{!c.is_special ? (lastRS || '—') : ''}</td>
      <td>
        {!c.is_special && (
          <input type="text" value={comment} placeholder="—" disabled={isClosed}
            onChange={e => onCommentChange(c.id, e.target.value)}
            style={{
              width: '100%', fontFamily: 'var(--sans)', fontSize: '.84rem',
              padding: '4px 8px', border: '1.5px solid var(--line)', borderRadius: 5,
              background: isClosed ? '#f8fafc' : '#fff', outline: 'none', color: 'var(--text)',
            }}
          />
        )}
      </td>
      {canUA && (
        <td style={{ textAlign: 'center' }}>
          {!c.is_special && c.name !== 'VACANT' && (
            <button onClick={() => onUARequest(c.id, c.name, c.room)}
              style={{
                fontSize: '.7rem', padding: '3px 8px', background: '#C8500A',
                color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
              title={`Request UA for ${c.name}`}>
              🧪 UA
            </button>
          )}
        </td>
      )}
    </tr>
  )
}

function LogEntry({ entry: e, canDelete, onDelete, onPhotoSaved }) {
  const isPos   = e.text && /POS:/.test(e.text)
  const isUA    = e.text && /— UA:/i.test(e.text)
  const type    = classifyLogEntry(e.text)
  const ts      = LOG_TYPE_STYLE[type] || LOG_TYPE_STYLE.Note
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [photoSrc, setPhotoSrc]   = useState(null)
  const [showPhoto, setShowPhoto] = useState(false)

  async function handleFile(ev) {
    const file = ev.target.files?.[0]
    if (!file || !e.id) return
    setUploading(true)
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result)
        r.onerror = rej
        r.readAsDataURL(file)
      })
      const resp = await fetch(`/api/log/${e.id}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ photo: b64 }),
      })
      if (resp.ok) onPhotoSaved?.()
    } catch {}
    setUploading(false)
    if (ev.target) ev.target.value = ''
  }

  async function handleViewPhoto() {
    if (photoSrc) { setShowPhoto(true); return }
    try {
      const resp = await fetch(`/api/log/${e.id}/photo`, { credentials: 'include' })
      if (resp.ok) {
        const j = await resp.json()
        if (j.photo) { setPhotoSrc(j.photo); setShowPhoto(true) }
      }
    } catch {}
  }

  return (
    <>
      <tr style={isPos ? { background: '#fff5f5' } : {}}>
        <td className="log-td-time" style={isPos ? { borderLeft: '3px solid #DC2626' } : {}}>
          {e.time}
        </td>
        <td className="log-td-type">
          <span className="log-type-badge" style={{ background: ts.bg, color: ts.color }}>
            {type}
          </span>
        </td>
        <td className="log-td-details">
          <span className="msg">
            {isPos
              ? e.text.split(/(POS:[^|<]+)/).map((part, i) =>
                  /^POS:/.test(part)
                    ? <strong key={i} style={{ color: '#DC2626' }}>{part}</strong>
                    : part
                )
              : e.text
            }
          </span>
          {isUA && e.id && (
            e.ua_photo
              ? <button onClick={handleViewPhoto} title="View UA photo"
                  style={{ marginLeft: 6, fontSize: '.72rem', cursor: 'pointer', background: '#eff6ff',
                    border: '1px solid #bfdbfe', borderRadius: 4, padding: '1px 7px', color: '#3b82f6', lineHeight: 1.6 }}>
                  📷 View
                </button>
              : <button onClick={() => fileRef.current?.click()} title="Attach UA photo"
                  disabled={uploading}
                  style={{ marginLeft: 6, fontSize: '.72rem', cursor: uploading ? 'not-allowed' : 'pointer',
                    background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
                    padding: '1px 7px', color: '#94a3b8', lineHeight: 1.6 }}>
                  {uploading ? '⏳' : '📷 Photo'}
                </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          {canDelete && e.id && (
            <button className="del-btn" onClick={() => onDelete(e.id)} title="Delete">&times;</button>
          )}
        </td>
      </tr>
      {showPhoto && photoSrc && (
        <tr><td colSpan={3} style={{ padding: 0, border: 'none' }}>
          <div className="modal-overlay open" onClick={() => setShowPhoto(false)} style={{ zIndex: 2000 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, maxWidth: '92vw',
              display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}
              onClick={ev => ev.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: '.9rem', color: '#0f172a' }}>UA Photo</span>
                <button className="xbtn" onClick={() => setShowPhoto(false)}>&times;</button>
              </div>
              <img src={photoSrc} alt="UA photo"
                style={{ maxWidth: '80vw', maxHeight: '70vh', objectFit: 'contain', borderRadius: 8 }} />
            </div>
          </div>
        </td></tr>
      )}
    </>
  )
}
