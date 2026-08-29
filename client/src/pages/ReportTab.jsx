import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react'
import { Plus, ClipboardList } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, Modal, ModalHeader, ModalBody, ModalFooter,
  TextInput, Select, Textarea, Checkbox, Label, Alert,
} from 'flowbite-react'
import { Field, useConfirm, StatusBadge, ColoredAvatar } from '../components/ui.jsx'
import { useData } from '../contexts/DataContext.jsx'
import { statusList, allStatuses, TONE_BADGE, TONE_DOT } from '../utils/statuses.js'
import { CARD_HEAD, CARD_HEAD_TITLE } from '../utils/ui.js'
import { usePermission } from '../hooks/usePermission.js'
import PrintScopeModal from '../components/PrintScopeModal.jsx'
import ConductUAModal from '../components/ConductUAModal.jsx'
import { openPrintWindow, fmtDateFriendly, classifyLogEntry } from '../utils/printLog.js'

const CARD = 'p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 sm:p-5 dark:bg-gray-800'

function Panel({ title, right, flush, children }) {
  if (flush) {
    return (
      <div className={`${CARD} mb-4 !p-0 overflow-hidden`}>
        <div className={CARD_HEAD}>
          <h3 className={CARD_HEAD_TITLE}>{title}</h3>
          {right}
        </div>
        {children}
      </div>
    )
  }
  return (
    <div className={`${CARD} mb-4 !p-0 overflow-hidden`}>
      <div className={CARD_HEAD}>
        <h3 className={CARD_HEAD_TITLE}>{title}</h3>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// Fallback only — the live list is editable in Admin -> Facility -> Statuses
// and arrives on the data payload. Kept so a first paint (or a payload that
// predates the setting) still renders real labels instead of raw slugs.
const STATUS_OPTS = [
  { v: 'building', l: 'In Building', c: 's-building' },
  { v: 'work',     l: 'Work',        c: 's-work' },
  { v: 'pass',     l: 'Weekend Pass',c: 's-pass' },
  { v: 'out',      l: 'Out / Other', c: 's-out' },
  { v: 'bhc',      l: 'BHC',         c: 's-bhc' },
  { v: 'efc',      l: 'EFC',         c: 's-efc' },
  { v: 'hospital', l: 'Hospital',    c: 's-hospital' },
]


const LOG_TYPE_CLS = {
  Wellness:      'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  Walkthrough:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  UA:            'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  Lunch:         'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'Room Search': 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  Mail:          'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  Infraction:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  Intake:        'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  Discharge:     'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  Note:          'bg-slate-100 text-slate-600 dark:bg-gray-700 dark:text-slate-400',
}

const STATUS_BADGE_CLS = {
  building: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  work:     'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  pass:     'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  out:      'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  bhc:      'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  efc:      'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  hospital: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  vacant:   'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
}

const DEFAULT_WALK_AREAS = [
  'Supply Room','Basement / Offices','Kitchen','Meeting Room','Dining Room',
  'Laundry Area','Clothing Closet','Stairs to Roof','Floors 2, 3 & 4',
  'Stairs Down to Main','Perimeter Check',
]

function todayStr() { return new Date().toLocaleDateString('en-CA') }
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
function stOpt(v, opts) { return (opts || STATUS_OPTS).find(o => o.v === v) || { v, l: v, c: '' } }

// Map the configured statuses onto the shape this file already uses.
function optsFrom(data) {
  return statusList(data).map(s => ({ v: s.key, l: s.label, c: `s-${s.key}`, tone: s.tone }))
}

// Picker vs render: a row already sitting on a retired status must still
// show its label, so lookups fall back to the full list (archived included).
function lookupFrom(data) {
  return allStatuses(data).map(s => ({ v: s.key, l: s.label, c: `s-${s.key}`, tone: s.tone }))
}

function dateStamp() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Reminder helpers ─────────────────────────────────────────────────
function fmtSchedTime(d) {
  if (!d) return ''
  const h = d.getHours(), m = d.getMinutes()
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function calcScheduledStatus(last, schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const todayTimes = schedule
    .map(t => { try { const d = new Date(`${todayStr}T${t}`); return isNaN(d) ? null : d } catch { return null } })
    .filter(Boolean)
    .sort((a, b) => a - b)
  if (!todayTimes.length) return null
  const pastTimes  = todayTimes.filter(t => t <= now)
  const nextTime   = todayTimes.find(t => t > now) ?? null
  if (!pastTimes.length) return { status: 'ok', nextTime, overdueAt: null }
  const mostRecent = pastTimes[pastTimes.length - 1]
  if (last && last >= mostRecent) return { status: 'ok', nextTime, overdueAt: null }
  return { status: 'overdue', nextTime, overdueAt: mostRecent }
}

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

// ── Main component ────────────────────────────────────────────────────
export default function ReportTab() {
  const { data, patchData, saveData, loadData } = useData()
  const { hasPerm } = usePermission()
  const confirm = useConfirm()

  const clients  = data?.clients  || []
  const reports  = data?.reports  || []
  const passes   = data?.passes   || []
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
  const wellnessSchedule = Array.isArray(data?.wellness_schedule) ? data.wellness_schedule : []
  const walkSchedule     = Array.isArray(data?.walk_schedule)     ? data.walk_schedule     : []
  const walkAreas        = Array.isArray(data?.walk_areas) ? data.walk_areas : DEFAULT_WALK_AREAS
  const uaPanel      = Array.isArray(data?.ua_panel) ? data.ua_panel : ['ETG','THC','FEN','AMP','MET','BZO','MTD','BUP','COC']

  // UI visibility
  const uiVis = useMemo(() => {
    const def = { tabs: {}, buttons: {} }
    if (!data?.ui_visibility) return def
    try { return typeof data.ui_visibility === 'string' ? JSON.parse(data.ui_visibility) : data.ui_visibility }
    catch { return def }
  }, [data])
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
  const [sortKey, setSortKey]         = useState('room')
  const [sortDir, setSortDir]         = useState(1)
  const [search, setSearch]           = useState('')
  const [showAllRooms, setShowAllRooms] = useState(false)
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

  // passOverride: only Out/Extended passes lock status to 'pass' (Weekend Pass)
  // In passes do NOT override — the user can still set any status except Weekend Pass
  const passOverride = useMemo(() => {
    const m = {}
    passes.forEach(p => {
      if (p.status === 'Out' || p.status === 'Extended') m[p.client_id] = 'pass'
    })
    return m
  }, [passes])

  // inPass: clients with an active In-status pass (not Returned) — used to filter out Weekend Pass option
  const inPass = useMemo(() => {
    const s = new Set()
    passes.forEach(p => { if (p.status === 'In') s.add(p.client_id) })
    return s
  }, [passes])
  // Census
  const census = useMemo(() => {
    const cnt = { building: 0, work: 0, pass: 0, bhc: 0, efc: 0, hospital: 0, out: 0 }
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .forEach(c => { const st = passOverride[c.id] ?? statuses[c.id] ?? 'building'; if (Object.hasOwn(cnt, st)) cnt[st]++ })
    return cnt
  }, [clients, statuses, passOverride])
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

  // Reminders — schedule-based. Fires when a scheduled time passes without a matching log entry.
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
    return calcScheduledStatus(wellnessLast, wellnessSchedule)
  // reminderTick forces recalc every 30s so schedule transitions are detected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wellnessLast, wellnessSchedule, canReminders, reminderTick])

  const walkReminder = useMemo(() => {
    if (!canReminders) return null
    return calcScheduledStatus(walkLast, walkSchedule)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkLast, walkSchedule, canReminders, reminderTick])

  // Dismissed reminders — keyed by (reportId|type|lastLogTime|overdueAt).
  // Re-shows when a new log entry changes lastLogTime OR when the schedule advances to a new time.
  const [dismissedReminders, setDismissedReminders] = useState(() => new Set())
  function reminderKey(type, last, overdueAt) {
    return `${activeId}|${type}|${last ? last.getTime() : 'none'}|${overdueAt ? overdueAt.getTime() : 'none'}`
  }
  const wellnessDismissed = canReminders && dismissedReminders.has(reminderKey('wellness', wellnessLast, wellnessReminder?.overdueAt))
  const walkDismissed     = canReminders && dismissedReminders.has(reminderKey('walk',     walkLast,     walkReminder?.overdueAt))
  function dismissReminder(type, last, overdueAt) {
    setDismissedReminders(prev => {
      const next = new Set(prev)
      next.add(reminderKey(type, last, overdueAt))
      return next
    })
  }

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
    if (!await confirm({ title: 'Start a new shift report?', body: 'Issues and current statuses will carry over.', confirmText: 'Start' })) return
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
    if (!await confirm({ title: `Close ${s.shift || 'this shift'}?`, body: 'This will lock the report.', confirmText: 'Close Shift', color: 'red' })) return
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
    if (!await confirm({ title: 'Delete this log entry?', confirmText: 'Delete', color: 'red' })) return
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
    if (!await confirm({ title: `Request UA for ${clientName}?`, body: `Room ${room}`, confirmText: 'Request UA' })) return
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
  // Statuses configured in Admin -> Facility -> Statuses, memoised so the
  // list identity is stable across renders.
  const statusOptions = useMemo(() => optsFrom(data), [data])
  const statusLookup  = useMemo(() => lookupFrom(data), [data])
  // Census cells follow the configured statuses (order included). TONE_DOT
  // keeps the pip in step with the colour chosen in Admin.
  const censusCells = useMemo(
    () => statusList(data).map(s => ({ key: s.key, label: s.label, dot: TONE_DOT[s.tone] || TONE_DOT.gray })),
    [data])
  const sortedClients = useMemo(() => {
    return clients.filter(c => c.is_active)
      .filter(c => showAllRooms || (!c.is_special && c.name !== 'VACANT'))
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
            av = lbls[a.name==='VACANT'?'vacant':(passOverride[a.id]??statuses[a.id]??'building')]||''
            bv = lbls[b.name==='VACANT'?'vacant':(passOverride[b.id]??statuses[b.id]??'building')]||''
            break
          }
          case 'last_ua': av = lastUa[a.id]||''; bv = lastUa[b.id]||''; break
          case 'last_rs': av = lastRs[a.id]||''; bv = lastRs[b.id]||''; break
          default: av = ''; bv = ''
        }
        return av < bv ? -sortDir : av > bv ? sortDir : 0
      })
  }, [clients, search, sortKey, sortDir, statuses, lastUa, lastRs, passOverride, showAllRooms])

  const isClosed = activeReport?.is_closed ?? false

  // Active non-special, non-VACANT clients for quick action dropdowns
  const rosterClients = useMemo(
    () => clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT'),
    [clients]
  )

  // ── No active report ──────────────────────────────────────────────
  if (!activeId && !creating) {
    return (
      <div>
        <div className="mb-5">
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Daily Ops</BreadcrumbItem>
            <BreadcrumbItem>Shift Report</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-gray-900 dark:text-white">Shift Report</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">No active report for this shift</p>
        </div>
        <div className={`${CARD} flex flex-col items-center justify-center py-16 text-center`}>
          <div className="flex items-center justify-center mb-4 rounded-full w-14 h-14 bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300">
            <ClipboardList className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">No Active Shift Report</h2>
          <p className="mt-1 mb-5 text-sm text-gray-500 dark:text-gray-400">Start a new report to begin logging this shift.</p>
          {canCreate && (
            <Button onClick={handleNewReport}><Plus className="w-4 h-4 mr-2" /> New Shift Report</Button>
          )}
        </div>
      </div>
    )
  }

  // ── Report ────────────────────────────────────────────────────────
  const facilityName = data?.facility_name || ''
  const shiftRange = shift === 'Day Shift'
    ? `${data?.shift_day_start || '7:00 AM'} – ${data?.shift_swing_start || '3:00 PM'}`
    : shift === 'Swing Shift'
      ? `${data?.shift_swing_start || '3:00 PM'} – ${data?.shift_grave_start || '11:00 PM'}`
      : `${data?.shift_grave_start || '11:00 PM'} – ${data?.shift_day_start || '7:00 AM'}`

  return (
    <div>
      {/* Report Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Daily Ops</BreadcrumbItem>
            <BreadcrumbItem>Shift Report</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-gray-900 dark:text-white">{shift} Report</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {reportDate} · {shiftRange}{facilityName ? ' · ' + facilityName : ''}{activeId ? ' · #' + activeId : ''}{isClosed ? ' · Closed' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canClose && !isClosed && activeId && <Button color="light" onClick={handleCloseShift}>Close Shift</Button>}
          {canCreate && isClosed && <Button onClick={handleNewReport}><Plus className="w-4 h-4 mr-2" /> {creating ? 'Creating…' : 'New Report'}</Button>}
        </div>
      </div>

      {/* Shift Details */}
      <Panel title="Shift Details" right={activeId && <span className="text-xs text-gray-400">Report #{activeId} · {isClosed ? 'Closed' : 'Open'}</span>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Date">
              <TextInput type="date" value={reportDate} disabled={isClosed}
                onChange={e => handleMetaChange('date', e.target.value)} />
            </Field>
            <Field label="Shift">
              <Select value={shift} disabled={isClosed}
                onChange={e => handleMetaChange('shift', e.target.value)}>
                <option value="Day Shift">Day Shift ({data?.shift_day_start || '7:00 AM'} – {data?.shift_swing_start || '3:00 PM'})</option>
                <option value="Swing Shift">Swing Shift ({data?.shift_swing_start || '3:00 PM'} – {data?.shift_grave_start || '11:00 PM'})</option>
                <option value="Graveyard Shift">Graveyard Shift ({data?.shift_grave_start || '11:00 PM'} – {data?.shift_day_start || '7:00 AM'})</option>
              </Select>
            </Field>
            <Field label="Program Assistant on Duty (PA)">
              <TextInput type="text" value={modName} placeholder="Name(s)" disabled={isClosed}
                onChange={e => handleMetaChange('mod', e.target.value)} />
            </Field>
          </div>
      </Panel>

      {/* Census */}
      <Panel title="Census" right={<span className="text-xs text-gray-400">{censusTotal} Residents</span>}>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(7rem,1fr))]">
          {/* Driven by the configured statuses, so a rename or recolour in
              Admin shows up here without a code change. */}
          {censusCells.map(({ key, label, dot }) => (
            <div key={key} className="flex flex-col items-center p-3 bg-white border border-gray-200 rounded-xl dark:bg-gray-700 dark:border-gray-600">
              <div className={`w-2 h-2 rounded-full mb-2 shrink-0 ${dot}`} />
              <div className="text-xl font-bold text-gray-900 dark:text-white">{census[key]}</div>
              <div className="mt-1 text-xs text-center text-gray-500 dark:text-gray-400 leading-tight">{label}</div>
            </div>
          ))}
          <div className="flex flex-col items-center p-3 bg-primary-600 border border-primary-700 rounded-xl">
            <div className="w-2 h-2 rounded-full mb-2 bg-white opacity-60 shrink-0" />
            <div className="text-xl font-bold text-white">{censusTotal}</div>
            <div className="mt-1 text-xs text-center text-primary-100 leading-tight">Total</div>
          </div>
        </div>
      </Panel>

      {/* Reminder bar */}
      {canReminders && (
        (showWellness && wellnessReminder && !wellnessDismissed) ||
        (showWalkthrough && walkReminder && !walkDismissed)
      ) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {showWellness && wellnessReminder && !wellnessDismissed && (
            <ReminderCard
              label="Wellness Check"
              status={wellnessReminder.status}
              nextTime={wellnessReminder.nextTime}
              overdueAt={wellnessReminder.overdueAt}
              onDismiss={() => dismissReminder('wellness', wellnessLast, wellnessReminder.overdueAt)}
            />
          )}
          {showWalkthrough && walkReminder && !walkDismissed && (
            <ReminderCard
              label="Walkthrough"
              status={walkReminder.status}
              nextTime={walkReminder.nextTime}
              overdueAt={walkReminder.overdueAt}
              onDismiss={() => dismissReminder('walk', walkLast, walkReminder.overdueAt)}
            />
          )}
        </div>
      )}

      {/* Activity Log */}
      <Panel
        title="Activity Log"
        right={
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{logEntries.length} {logEntries.length === 1 ? 'Entry' : 'Entries'}</span>
            <div className="flex gap-1">
              <button onClick={() => toggleLogSort('time')} title="Sort by time"
                className={`px-2 py-1 text-xs font-semibold rounded border cursor-pointer transition-colors ${logSortKey === 'time' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'}`}>
                Time {logSortKey === 'time' ? (logSortDir > 0 ? '↑' : '↓') : ''}
              </button>
              <button onClick={() => toggleLogSort('type')} title="Sort by type"
                className={`px-2 py-1 text-xs font-semibold rounded border cursor-pointer transition-colors ${logSortKey === 'type' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'}`}>
                Type {logSortKey === 'type' ? (logSortDir > 0 ? '↑' : '↓') : ''}
              </button>
            </div>
            <button onClick={() => setLogPrintOpen(true)} title="Print activity log"
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
              Print
            </button>
          </div>
        }
      >
          {/* Quick-action pills */}
          {canLog && !isClosed && (
            <div className="flex flex-wrap gap-2 mb-3">
              {showWellness && (
                <button onClick={() => setQuickModal('wellness')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-green-100 text-green-700 border-green-200 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800 dark:hover:bg-green-900/50">
                  ✓ Wellness Check
                </button>
              )}
              {showWalkthrough && (
                <button onClick={() => setQuickModal('walk')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-900/50">
                  ⊕ Walkthrough
                </button>
              )}
              <button onClick={() => setQuickModal('lunch')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800 dark:hover:bg-amber-900/50">
                🍕 Lunch Break
              </button>
              <button onClick={() => setQuickModal('ua')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-yellow-100 text-yellow-700 border-yellow-200 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700 dark:hover:bg-yellow-900/50">
                🧪 UA
              </button>
              <button onClick={() => setQuickModal('roomsearch')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-900/50">
                🔎 Room Search
              </button>
              {canMailLog && (
                <button onClick={() => setQuickModal('mail')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-sky-100 text-sky-700 border-sky-200 hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800 dark:hover:bg-sky-900/50">
                  ✉ Mail
                </button>
              )}
              {canViolations && (
                <button onClick={() => setQuickModal('violation')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-red-100 text-red-700 border-red-200 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/50">
                  ⚠ Infraction
                </button>
              )}
            </div>
          )}

          <div className="overflow-x-auto -mx-4 sm:-mx-5">
            {logEntries.length === 0 && (
              <div className="px-4 py-2 text-sm text-gray-400">No entries yet.</div>
            )}
            {logEntries.length > 0 && (
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="text-xs font-medium text-gray-500 uppercase bg-gray-50 dark:bg-gray-700/50 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                    <th className="px-4 py-2 whitespace-nowrap">Time</th>
                    <th className="px-4 py-2 whitespace-nowrap">Type</th>
                    <th className="px-4 py-2">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {logEntries.map(e => (
                    <LogEntry key={e.id ?? e.time + e.text} entry={e} canDelete={canDelLog} onDelete={handleDelLog} onPhotoSaved={loadData} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {canLog && !isClosed && (
            <div className="flex gap-2 mt-3">
              <TextInput type="time" value={logTime} onChange={e => setLogTime(e.target.value)}
                sizing="sm" className="w-[130px] shrink-0" />
              <TextInput
                ref={logTextRef} type="text" value={logText}
                onChange={e => setLogText(e.target.value)}
                placeholder="Entry text…"
                sizing="sm"
                className="flex-1"
                onKeyDown={e => e.key === 'Enter' && handleAddLog()}
              />
              <Button size="xs" onClick={handleAddLog}>+ Add</Button>
            </div>
          )}
      </Panel>

      {/* Issues & Concerns + Medical Notes — side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
      <Panel title="Issues & Concerns">
          <div className="space-y-1.5 mb-2">
            {issues.length === 0 && (
              <p className="text-sm text-gray-400 italic py-1">None recorded.</p>
            )}
            {issues.map((v, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-gray-200 bg-gray-50 dark:bg-gray-700/40 dark:border-gray-600">
                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{v}</span>
                {canIssues && !isClosed && (
                  <button onClick={() => handleRemoveIssue(i)}
                    className="text-gray-400 hover:text-red-500 text-lg leading-none shrink-0 cursor-pointer"
                    title="Remove">&times;</button>
                )}
              </div>
            ))}
          </div>
          {canIssues && !isClosed && (
            <div className="flex gap-2">
              <TextInput ref={issueRef} sizing="sm" className="flex-1" type="text" value={issueText}
                onChange={e => setIssueText(e.target.value)}
                placeholder="Add issue…" onKeyDown={e => e.key === 'Enter' && handleAddIssue()} />
              <Button size="xs" onClick={handleAddIssue}>+ Add</Button>
            </div>
          )}
      </Panel>

      {/* Medical Notes */}
      <Panel title="Medical Notes">
          <div className="space-y-1.5 mb-2">
            {medNotes.length === 0 && (
              <p className="text-sm text-gray-400 italic py-1">None recorded.</p>
            )}
            {medNotes.map((v, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800">
                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{v}</span>
                {canIssues && !isClosed && (
                  <button onClick={() => handleRemoveMed(i)}
                    className="text-gray-400 hover:text-red-500 text-lg leading-none shrink-0 cursor-pointer"
                    title="Remove">&times;</button>
                )}
              </div>
            ))}
          </div>
          {canIssues && !isClosed && (
            <div className="flex gap-2">
              <TextInput ref={medRef} sizing="sm" className="flex-1" type="text" value={medText}
                onChange={e => setMedText(e.target.value)}
                placeholder="Add medical note…" onKeyDown={e => e.key === 'Enter' && handleAddMed()} />
              <Button size="xs" onClick={handleAddMed}>+ Add</Button>
            </div>
          )}
      </Panel>
      </div>

      {/* Roster */}
      <Panel
        title="Roster"
        flush
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAllRooms(v => !v)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap ${
                showAllRooms
                  ? 'bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'
                  : 'bg-primary-600 text-white border-primary-600 hover:bg-primary-700'
              }`}
            >
              {showAllRooms ? 'All Rooms' : 'Residents Only'}
            </button>
            <TextInput
              type="text" placeholder="Search residents…" value={search}
              onChange={e => setSearch(e.target.value)}
              sizing="sm" className="sm:w-56"
            />
          </div>
        }
      >
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                      <span>Resident</span>
                      <div className="flex gap-1">
                        {['room','name'].map(k => (
                          <button key={k} onClick={() => handleSort(k)}
                            className={`px-1.5 py-px text-[10px] font-semibold rounded border transition-colors ${sortKey === k ? 'bg-primary-600 text-white border-primary-600' : 'bg-transparent text-gray-400 border-gray-300 dark:border-gray-600 hover:text-gray-600'}`}>
                            {k === 'room' ? 'Rm' : 'Name'}{sortKey === k ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  </th>
                  <SortTh k="status"  label="Status"           sortKey={sortKey} dir={sortDir} onSort={handleSort} className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none whitespace-nowrap" />
                  <SortTh k="last_ua" label="Last UA"          sortKey={sortKey} dir={sortDir} onSort={handleSort} className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none whitespace-nowrap" />
                  <SortTh k="last_rs" label="Last Room Search" sortKey={sortKey} dir={sortDir} onSort={handleSort} className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none whitespace-nowrap" />
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Comment</th>
                  {canUA && <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {sortedClients.map(c => (
                  <RosterRow
                    key={c.id} client={c}
                    status={passOverride[c.id] ?? statuses[c.id] ?? 'building'} comment={comments[c.id] || ''}
                    passLocked={passOverride[c.id] === 'pass'}
                    hasInPass={inPass.has(c.id)}
                    lastUA={lastUa[c.id]} lastRS={lastRs[c.id]}
                    isClosed={isClosed} canStatus={canStatus} canUA={canUA}
                    statusOptions={statusOptions} statusLookup={statusLookup}
                    onStatusChange={handleStatusChange}
                    onCommentChange={handleCommentChange}
                    onUARequest={handleUARequest}
                  />
                ))}
                {sortedClients.length === 0 && (
                  <tr>
                    <td colSpan={canUA ? 6 : 5}
                      className="py-6 text-center text-sm text-gray-400">
                      No residents found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
      </Panel>

      {/* Quick action modals */}
      {quickModal === 'wellness' && (
        <WellnessModal
          clients={data?.clients || []}
          statuses={statuses}
          passOverride={passOverride}
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
    ['Infractions',  entries.filter(e => /violation|infraction/i.test(e.text || '')).length],
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
function ReminderCard({ label, status, nextTime, overdueAt, onDismiss }) {
  const overdue = status === 'overdue'
  const icon = overdue ? '🔴' : '🟢'
  const text = overdue
    ? `OVERDUE — ${label} missed at ${fmtSchedTime(overdueAt)}`
    : nextTime
      ? `${label} — next at ${fmtSchedTime(nextTime)}`
      : `${label} — no more checks scheduled today`
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border ${overdue ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800' : 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800'}`}>
      <span>{icon}</span>
      <span className="font-mono text-[0.85rem]">{text}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss until next scheduled check"
          aria-label="Dismiss reminder"
          className="ml-1 opacity-55 hover:opacity-100 cursor-pointer font-bold text-base leading-none rounded px-0.5 bg-transparent border-none text-current"
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
function WellnessModal({ clients = [], statuses = {}, passOverride = {}, onClose, onSubmit }) {
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
    <Modal show size="lg" onClose={onClose}>
      <ModalHeader>✓ Wellness Check</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <Field label="Conducted by">
            <TextInput ref={byRef} value={by} onChange={e => setBy(e.target.value)}
              placeholder="PA name" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          </Field>
          <Field label="Time"><TextInput type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
          {activeClients.length > 0 && (
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                Not Located <span className="font-normal text-gray-400">(check anyone not found)</span>
              </label>
              <div className="overflow-y-auto overflow-x-hidden border border-gray-200 rounded-lg max-h-60 dark:border-gray-700">
                {activeClients.map((c, i) => {
                  const st = passOverride[c.id] ?? statuses[c.id] ?? 'building'
                  const marked = notLocated.has(c.id)
                  return (
                    <div key={c.id} onClick={() => toggleNotLocated(c.id)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none transition-colors ${i < activeClients.length - 1 ? 'border-b border-gray-100 dark:border-gray-700' : ''} ${marked ? 'bg-red-50 dark:bg-red-950/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                      <input type="checkbox" checked={marked} onChange={() => {}}
                        className="pointer-events-none accent-red-600 shrink-0 w-3.5 h-3.5" />
                      <span className={`font-mono text-[0.75rem] font-bold shrink-0 min-w-[32px] text-center px-1.5 py-px rounded ${marked ? 'text-red-600 bg-red-100' : 'text-gray-400 bg-gray-100 dark:bg-gray-700 dark:text-gray-500'}`}>
                        {c.room}
                      </span>
                      <span className={`flex-1 text-sm ${marked ? 'font-bold text-red-800 dark:text-red-300' : 'font-medium text-gray-800 dark:text-gray-200'}`}>{c.name}</span>
                      <span className="text-[0.7rem] text-gray-400 shrink-0">{stLabel[st] || st}</span>
                    </div>
                  )
                })}
              </div>
              {notLocated.size > 0 && (
                <div className="mt-1 text-xs font-semibold text-red-600">
                  {notLocated.size} resident{notLocated.size !== 1 ? 's' : ''} not located
                </div>
              )}
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isProcessing={saving} disabled={saving}>Log Entry</Button>
      </ModalFooter>
    </Modal>
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
    <Modal show size="lg" onClose={onClose}>
      <ModalHeader>⊕ Building Walkthrough</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <Field label="Conducted by"><TextInput value={by} onChange={e => setBy(e.target.value)} placeholder="PA name" autoFocus /></Field>
          <Field label="Time"><TextInput type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Areas Checked</label>
              <div className="flex gap-1.5">
                <Button type="button" size="xs" color="light" onClick={() => setAll(true)}>All ✓</Button>
                <Button type="button" size="xs" color="light" onClick={() => setAll(false)}>None</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 p-2 border border-gray-200 rounded-lg bg-gray-50 dark:bg-gray-700/40 dark:border-gray-700">
              {areas.map(a => (
                <div key={a} onClick={() => toggleArea(a)}
                  className={`flex items-center gap-2 text-[0.83rem] cursor-pointer px-2.5 py-1.5 rounded-md border transition-all select-none min-w-0 ${checked[a] ? 'bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-700' : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-600'}`}>
                  <input type="checkbox" checked={!!checked[a]} onChange={() => {}}
                    className="pointer-events-none accent-green-600 shrink-0 w-3.5 h-3.5" />
                  <span className={`leading-snug truncate ${checked[a] ? 'font-semibold text-green-700 dark:text-green-400' : 'font-normal text-gray-700 dark:text-gray-300'}`}>{a}</span>
                </div>
              ))}
            </div>
          </div>
          <Field label="Issues (optional)">
            <TextInput value={issues} onChange={e => setIssues(e.target.value)} placeholder="All is well, nothing to report." />
          </Field>
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isProcessing={saving} disabled={saving}>Log Entry</Button>
      </ModalFooter>
    </Modal>
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
    <Modal show size="md" onClose={onClose}>
      <ModalHeader>🍕 Lunch Break</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <Field label="Direction">
            <div className="flex gap-2">
              <Button type="button" className="flex-1" color={direction === 'out' ? 'success' : 'light'} onClick={() => setDirection('out')}>🚪 Out — took lunch</Button>
              <Button type="button" className="flex-1" color={direction === 'in' ? 'warning' : 'light'} onClick={() => setDirection('in')}>↩ In — returned</Button>
            </div>
          </Field>
          <Field label="Time"><TextInput type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
          <Field label="PA name">
            <TextInput ref={nameRef} value={name} onChange={e => setName(e.target.value)}
              placeholder="Name" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          </Field>
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isProcessing={saving} disabled={saving}>Log Entry</Button>
      </ModalFooter>
    </Modal>
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
    <Modal show size="md" onClose={onClose}>
      <ModalHeader>🔎 Room Search</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <Field label="Time"><TextInput type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
          <Field label="Resident">
            <Select value={clientId} onChange={e => setClientId(e.target.value)} autoFocus>
              <option value="">— Select resident —</option>
              {clients.map(c => <option key={c.id} value={c.id}>Rm. {c.room} — {c.name}</option>)}
            </Select>
          </Field>
          <Field label="Conducted by"><TextInput value={staff} onChange={e => setStaff(e.target.value)} placeholder="Staff name" /></Field>
          <Field label="Findings">
            <TextInput value={findings} onChange={e => setFindings(e.target.value)} placeholder="Describe findings…" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          </Field>
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isProcessing={saving} disabled={saving || !clientId || !staff.trim() || !findings.trim()}>Log Entry</Button>
      </ModalFooter>
    </Modal>
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
    } catch { /* empty */ }
    setSaving(false)
    onClose()
  }

  return (
    <Modal show size="lg" onClose={onClose}>
      <ModalHeader>✉ Mail</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Recipients</label>
              <div className="flex gap-1.5">
                <Button type="button" size="xs" color="light" onClick={selectAll}>All</Button>
                <Button type="button" size="xs" color="light" onClick={clearAll}>None</Button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto overflow-x-hidden border border-gray-200 dark:border-gray-700 rounded-md flex flex-col gap-0.5 p-1">
              {clients.map(c => {
                const sel = selectedIds.has(c.id)
                return (
                  <Fragment key={c.id}>
                    <label className={`flex items-center gap-2 px-1.5 py-1 text-[0.83rem] cursor-pointer select-none rounded border transition-colors ${sel ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700 rounded-b-none' : 'bg-gray-50 border-transparent dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/60'}`}>
                      <input type="checkbox" checked={sel} onChange={() => toggleClient(c.id)}
                        className="accent-blue-700 shrink-0" />
                      <span className="font-mono font-bold text-gray-500 min-w-[34px] shrink-0">{c.room}</span>
                      <span className="flex-1 font-semibold truncate text-gray-800 dark:text-gray-200">{c.name}</span>
                    </label>
                    {sel && (
                      <div className="flex gap-1.5 items-center pl-8 pr-2 py-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 border-t-0 rounded-b -mt-0.5 mb-0.5">
                        {['letter', 'package'].map(t => {
                          const checked = !!(clientTypes[c.id] || {})[t]
                          return (
                            <label key={t} className="flex items-center gap-1 text-[0.78rem] font-semibold cursor-pointer capitalize select-none whitespace-nowrap">
                              <input type="checkbox" checked={checked}
                                onChange={() => toggleType(c.id, t)}
                                className="accent-blue-700 shrink-0" />
                              {t}
                            </label>
                          )
                        })}
                        <input
                          type="text"
                          value={clientNotes[c.id] || ''}
                          onChange={e => setNote(c.id, e.target.value)}
                          placeholder="Notes (optional)"
                          className="flex-1 min-w-0 text-[0.78rem] px-2 py-1 border border-blue-200 dark:border-blue-700 rounded bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:ring-1 focus:ring-blue-400"
                          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                        />
                      </div>
                    )}
                  </Fragment>
                )
              })}
              {clients.length === 0 && <p className="text-gray-400 text-[0.82rem] p-1.5">No active residents.</p>}
            </div>
            {selectedIds.size > 0 && (
              <p className="text-[0.74rem] text-blue-700 dark:text-blue-400 font-semibold mt-1">
                {selectedIds.size} recipient{selectedIds.size !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>
          <Field label="Time" className="max-w-[180px]"><TextInput type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isProcessing={saving} disabled={saving || selectedIds.size === 0}>
          {`Log Mail${selectedIds.size > 1 ? ` (${selectedIds.size})` : ''}`}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// Violation quick-log
function ViolationModal({ clients, onClose, onLogEntry }) {
  function todayStrLocal() { return new Date().toLocaleDateString('en-CA') }
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
        `Infraction filed — ${form.client_name} (Rm. ${form.room}): ${form.description.trim()}`,
        fmtTime()
      )
      onClose()
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  return (
    <Modal show size="lg" onClose={onClose}>
      <ModalHeader>⚠ Log Infraction</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          {err && <Alert color="failure">{err}</Alert>}
          <Field label="Resident">
            <Select value={form.client_id} onChange={e => handleClientSelect(e.target.value)} autoFocus>
              <option value="">— Select resident —</option>
              {clients.map(c => <option key={c.id} value={c.id}>Rm. {c.room} — {c.name}</option>)}
            </Select>
          </Field>
          <Field label="Date"><TextInput type="date" value={form.violation_date} onChange={e => setForm(f => ({ ...f, violation_date: e.target.value }))} /></Field>
          <Field label="Description">
            <Textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the infraction…" />
          </Field>
          <Field label="Notes (optional)"><TextInput value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional context…" /></Field>
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isProcessing={saving} disabled={saving}>Log Infraction</Button>
      </ModalFooter>
    </Modal>
  )
}

// ── Sub-components ────────────────────────────────────────────────────

function SortTh({ k, label, sortKey, dir, onSort, className }) {
  const active = sortKey === k
  return (
    <th className={className} onClick={() => onSort(k)}>
      {label}
      {active && <span className="ml-0.5 opacity-65 text-[0.7em]">{dir === 1 ? '▲' : '▼'}</span>}
    </th>
  )
}

function RosterRow({ client: c, status, comment, lastUA, lastRS, isClosed, canStatus, canUA, passLocked, hasInPass, statusOptions, statusLookup, onStatusChange, onCommentChange, onUARequest }) {
  const cur = status || (c.name === 'VACANT' ? 'vacant' : 'building')
  const allOpts = statusOptions && statusOptions.length ? statusOptions : STATUS_OPTS
  const opt = stOpt(cur, (statusLookup && statusLookup.length ? statusLookup : allOpts))
  const statusOpts = hasInPass ? allOpts.filter(o => o.v !== 'pass') : allOpts
  // Prefer the configured tone; fall back to the legacy per-key map so any
  // key predating the setting still renders with its original colour.
  const badgeCls = (opt.tone && TONE_BADGE[opt.tone]) || STATUS_BADGE_CLS[cur] || STATUS_BADGE_CLS.out

  const ResidentCell = () => {
    if (c.is_special) return (
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 shrink-0" />
        <div>
          <p className="text-sm font-semibold italic text-gray-400 dark:text-gray-500">{c.name}</p>
          <p className="font-mono text-xs text-gray-400 dark:text-gray-600">Rm {c.room}</p>
        </div>
      </div>
    )
    if (c.name === 'VACANT') return (
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-gray-400 dark:text-gray-500">Vacant</p>
          <p className="font-mono text-xs text-gray-400 dark:text-gray-600">Rm {c.room}</p>
        </div>
      </div>
    )
    return (
      <div className="flex items-center gap-2.5">
        <ColoredAvatar name={c.name} photo={c.photo} />
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{c.name}</p>
          <p className="font-mono text-xs text-gray-500 dark:text-gray-400">Rm {c.room}</p>
        </div>
      </div>
    )
  }

  return (
    <tr className={`${c.is_special ? 'italic text-gray-400 dark:text-gray-500' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
      <td className="px-4 py-2"><ResidentCell /></td>
      <td className="px-4 py-2">
        {c.is_special ? (
          <span className="text-gray-300 dark:text-gray-600">—</span>
        ) : c.name === 'VACANT' ? (
          <span className="inline-flex text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500">Vacant</span>
        ) : isClosed || !canStatus || passLocked ? (
          <span className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap ${badgeCls}`}>{opt.l}</span>
        ) : (
          <div className="relative inline-flex items-center">
            <span className={`inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap pointer-events-none select-none ${badgeCls}`}>
              {opt.l} <span className="ml-1 opacity-60">▾</span>
            </span>
            <select value={cur} onChange={e => onStatusChange(c.id, e.target.value)}
              className="absolute inset-0 w-full opacity-0 cursor-pointer">
              {statusOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-center font-mono text-xs whitespace-nowrap text-gray-500 dark:text-gray-400">{!c.is_special ? (lastUA || '—') : ''}</td>
      <td className="px-4 py-2 text-center font-mono text-xs whitespace-nowrap text-gray-500 dark:text-gray-400">{!c.is_special ? (lastRS || '—') : ''}</td>
      <td className="px-4 py-2">
        {!c.is_special && (
          <input type="text" value={comment} placeholder="—" disabled={isClosed}
            onChange={e => onCommentChange(c.id, e.target.value)}
            className={`w-full text-sm px-2 py-1 rounded border border-transparent focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500 ${isClosed ? 'bg-slate-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400' : 'bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100'}`}
          />
        )}
      </td>
      {canUA && (
        <td className="px-4 py-2 text-center">
          {!c.is_special && c.name !== 'VACANT' && (
            <button onClick={() => onUARequest(c.id, c.name, c.room)}
              className="px-2 py-0.5 text-xs font-medium rounded border cursor-pointer whitespace-nowrap bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800"
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
  const cls     = LOG_TYPE_CLS[type] || LOG_TYPE_CLS.Note
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
    } catch { /* empty */ }
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
    } catch { /* empty */ }
  }

  return (
    <>
      <tr className={isPos ? 'bg-red-50 dark:bg-red-950/20' : 'bg-white dark:bg-gray-800'}>
        <td className={`px-4 py-2 font-mono text-xs whitespace-nowrap text-blue-600 dark:text-blue-400${isPos ? ' border-l-2 border-red-500' : ''}`}>
          {e.time}
        </td>
        <td className="px-4 py-2 whitespace-nowrap">
          <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-md whitespace-nowrap ${cls}`}>
            {type}
          </span>
        </td>
        <td className="px-4 py-2 text-gray-800 dark:text-gray-200">
          {isPos
            ? e.text.split(/(POS:[^|<]+)/).map((part, i) =>
                /^POS:/.test(part)
                  ? <strong key={i} className="text-red-600">{part}</strong>
                  : part
              )
            : e.text
          }
          {isUA && e.id && (
            e.ua_photo
              ? <button onClick={handleViewPhoto} title="View UA photo"
                  className="ml-2 px-1.5 py-px text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800">
                  📷 View
                </button>
              : <button onClick={() => fileRef.current?.click()} title="Attach UA photo"
                  disabled={uploading}
                  className="ml-2 px-1.5 py-px text-xs text-gray-400 border border-gray-200 rounded hover:bg-gray-50 dark:border-gray-600 dark:text-gray-500 disabled:opacity-50">
                  {uploading ? '⏳' : '📷 Photo'}
                </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          {canDelete && e.id && (
            <button onClick={() => onDelete(e.id)} title="Delete"
              className="ml-2 text-gray-400 hover:text-red-500 text-lg leading-none cursor-pointer bg-transparent border-none">&times;</button>
          )}
        </td>
      </tr>
      {showPhoto && photoSrc && (
        <tr><td colSpan={3} className="p-0 border-none">
          <Modal show dismissible size="lg" onClose={() => setShowPhoto(false)}>
            <ModalHeader>UA Photo</ModalHeader>
            <ModalBody>
              <img src={photoSrc} alt="UA photo" className="object-contain mx-auto rounded-lg max-h-[70vh]" />
            </ModalBody>
          </Modal>
        </td></tr>
      )}
    </>
  )
}
