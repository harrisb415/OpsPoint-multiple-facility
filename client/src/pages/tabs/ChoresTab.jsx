import { useState, useMemo, useEffect, useCallback } from 'react'
import { ListChecks, CheckCircle, Users, Printer, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Breadcrumb, BreadcrumbItem, Button, Select, TextInput } from 'flowbite-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

const CARD = 'p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 sm:p-5 dark:bg-gray-800'

function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

function printChoreAssignments(clients, weekStart) {
  // Build 7-day array from weekStart (or current week if not given)
  const base = weekStart ? new Date(weekStart + 'T12:00:00') : (() => {
    const d = new Date(), day = d.getDay(), diff = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diff); return d
  })()
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base); d.setDate(base.getDate() + i); return d
  })
  const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const assigned = clients.filter(c => c.chore)

  const thCells = weekDays.map((d, i) =>
    `<th class="day-th">${_esc(DAY_NAMES[i])}<br><span style="font-weight:400;font-size:.68em;">${d.toLocaleDateString('en-US',{month:'numeric',day:'numeric'})}</span></th>`
  ).join('')

  const bodyRows = assigned.map((c, ri) => {
    let days, shifts
    try { days = c.chore_days ? JSON.parse(c.chore_days) : [] } catch { days = [] }
    try { shifts = c.chore_day_shifts ? JSON.parse(c.chore_day_shifts) : {} } catch { shifts = {} }
    const dayCells = weekDays.map((_, idx) => {
      const sched = days.length === 0 || days.includes(idx)
      if (!sched) return `<td style="background:#f5f5f5;border-color:#e0e0e0;"></td>`
      const sh = shifts[idx] || 'AM'
      return `<td class="sig-cell"><div class="shift-lbl">${_esc(sh)}</div><div class="sig-line"></div></td>`
    }).join('')
    return `<tr${ri%2===1?' class="alt"':''}>
      <td>${_esc(c.room)}</td><td>${_esc(c.name)}</td><td>${_esc(c.chore)}</td>${dayCells}</tr>`
  }).join('')

  const weekRange = `${weekDays[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${weekDays[6].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Chore Assignments</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#111;padding:14px}
  h2{font-size:1.05rem;margin-bottom:2px}
  .sub{font-size:.75rem;color:#555;margin-bottom:10px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #bbb;padding:4px 6px;vertical-align:top}
  th{background:#0f4c5c;color:#fff;font-size:.68rem;font-weight:700;text-align:center;white-space:nowrap}
  th:first-child,th:nth-child(2),th:nth-child(3){text-align:left}
  td{font-size:.8rem}
  .day-th{width:64px}
  .sig-cell{text-align:center;padding:3px 4px}
  .shift-lbl{font-size:.62rem;font-weight:700;color:#475569;margin-bottom:1px}
  .sig-line{border-bottom:1px solid #333;height:18px}
  .alt td{background:#f9f9f9}
  .alt td.sig-cell,.alt td[style]{background:inherit}
  @media print{@page{size:letter landscape;margin:.35in}body{padding:0}}
</style></head><body>
<h2>Chore Assignments</h2>
<div class="sub">Week of ${_esc(weekRange)}</div>
<table>
  <thead><tr>
    <th style="width:38px">Rm</th><th style="width:130px">Name</th><th style="width:100px">Chore</th>
    ${thCells}
  </tr></thead>
  <tbody>${bodyRows || `<tr><td colspan="10" style="text-align:center;color:#999;padding:16px">No chores assigned</td></tr>`}</tbody>
</table>
<script>window.onload=()=>window.print()</script>
</body></html>`

  const w = window.open('','_blank','width=1100,height=700')
  if (w) { w.document.write(html); w.document.close() }
}

// ── Week helpers ──────────────────────────────────────────────────────
function todayStr() { return new Date().toLocaleDateString('en-CA') }

function getWeekStart(dateStr) {
  // Returns the Monday of the week containing dateStr
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function getWeekDays(weekStartStr) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartStr + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}

function offsetWeek(weekStartStr, delta) {
  const d = new Date(weekStartStr + 'T12:00:00')
  d.setDate(d.getDate() + delta * 7)
  return d.toISOString().slice(0, 10)
}

function fmtDayHeader(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return {
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
    date: d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
  }
}

function fmtWeekRange(days) {
  const first = new Date(days[0] + 'T12:00:00')
  const last  = new Date(days[6] + 'T12:00:00')
  const opts  = { month: 'short', day: 'numeric' }
  return `${first.toLocaleDateString('en-US', opts)} – ${last.toLocaleDateString('en-US', opts)}`
}

// ── Component ─────────────────────────────────────────────────────────
export default function ChoresTab() {
  const { data, loadData } = useData()
  const { hasPerm } = usePermission()
  const canAssign = hasPerm('chores.assign')
  const canLog    = hasPerm('chores.log')

  const today = todayStr()
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today))
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart])

  // Weekly chore log fetched separately (DataContext only has today)
  const [weekLog, setWeekLog] = useState([])
  const [loadingWeek, setLoadingWeek] = useState(false)

  const fetchWeekLog = useCallback(async (from, to) => {
    setLoadingWeek(true)
    try {
      const r = await fetch(`/api/chore-log?from=${from}&to=${to}`, { credentials: 'include' })
      if (r.ok) setWeekLog(await r.json())
    } finally { setLoadingWeek(false) }
  }, [])

  useEffect(() => {
    fetchWeekLog(weekDays[0], weekDays[6])
  }, [weekDays, fetchWeekLog])

  const clients = useMemo(() =>
    (data?.clients || [])
      .filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [data?.clients]
  )

  const masterChores = useMemo(() => data?.master_chores || [], [data?.master_chores])

  // Build lookup: client_id + log_date → initials string
  const logMap = useMemo(() => {
    const m = {}
    weekLog.forEach(e => { m[`${e.client_id}_${e.log_date}`] = e.initials || '' })
    return m
  }, [weekLog])

  // Master chore management
  const [newChore, setNewChore] = useState('')
  const [savingChores, setSavingChores] = useState(false)

  async function addMasterChore() {
    const t = newChore.trim()
    if (!t) return
    const next = [...masterChores, t]
    setSavingChores(true)
    await fetch('/api/master-chores', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ chores: next }),
    })
    setNewChore('')
    setSavingChores(false)
    loadData()
  }

  async function removeMasterChore(i) {
    const next = masterChores.filter((_, idx) => idx !== i)
    await fetch('/api/master-chores', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ chores: next }),
    })
    loadData()
  }

  async function saveInitials(clientId, logDate, initials) {
    await fetch('/api/chore-log', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ client_id: clientId, log_date: logDate, initials }),
    })
    setWeekLog(prev => {
      const existing = prev.find(e => e.client_id === clientId && e.log_date === logDate)
      if (existing) return prev.map(e => e.client_id === clientId && e.log_date === logDate ? { ...e, initials } : e)
      return [...prev, { client_id: clientId, log_date: logDate, initials }]
    })
  }

  async function saveChoreAssign(clientId, assignment) {
    await fetch(`/api/clients/${clientId}/chore`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(assignment),
    })
    loadData()
  }

  // Completion stats for the week
  const weekStats = useMemo(() => {
    const total = clients.length * 7
    const done  = weekLog.filter(e => (e.initials || '').trim()).length
    return { total, done, pct: total > 0 ? Math.round(done / total * 100) : 0 }
  }, [clients, weekLog])

  const isThisWeek = weekStart === getWeekStart(today)

  const completionTint = weekStats.pct >= 80
    ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300'
    : weekStats.pct >= 50
      ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-300'
      : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300'

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Daily Ops</BreadcrumbItem>
            <BreadcrumbItem>Chores</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-gray-900 dark:text-white">Chores</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Weekly chore assignments and completion log</p>
        </div>
        <Button color="light" onClick={() => printChoreAssignments(clients, weekStart)}><Printer className="w-4 h-4 mr-2" /> Print List</Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { label: 'Week Completion', value: `${weekStats.pct}%`, sub: `${weekStats.done}/${weekStats.total} logged`, Icon: CheckCircle, tint: completionTint },
          { label: 'Active Residents', value: clients.length, sub: 'on the roster', Icon: Users, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
          { label: 'Defined Chores', value: masterChores.length, sub: 'in master list', Icon: ListChecks, tint: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300' },
        ].map(k => (
          <div key={k.label} className={CARD}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">{k.label}</h3>
                <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{k.value}</p>
                <p className="mt-2 text-xs text-gray-400">{k.sub}</p>
              </div>
              <div className={`flex items-center justify-center rounded-lg w-11 h-11 ${k.tint}`}><k.Icon className="w-5 h-5" /></div>
            </div>
          </div>
        ))}
      </div>

      {/* Master Chore List */}
      <div className={`${CARD} mb-4`}>
        <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Master Chore List</h3>
        <div className="flex flex-wrap gap-2">
          {masterChores.map((chore, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-full dark:bg-gray-700 dark:text-gray-200">
              {chore}
              {canAssign && (
                <button onClick={() => removeMasterChore(i)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
              )}
            </span>
          ))}
          {masterChores.length === 0 && <span className="text-sm text-gray-400">No chores defined yet.</span>}
        </div>
        {canAssign && (
          <div className="flex gap-2 mt-3">
            <TextInput className="flex-1" value={newChore} onChange={e => setNewChore(e.target.value)}
              placeholder="Add chore…" onKeyDown={e => e.key === 'Enter' && addMasterChore()} />
            <Button onClick={addMasterChore} isProcessing={savingChores} disabled={savingChores}>Add</Button>
          </div>
        )}
      </div>

      {/* Weekly Chore Log */}
      <div className={`${CARD} !p-0 overflow-hidden`}>
        <div className="flex flex-col gap-3 p-4 border-b border-gray-200 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Weekly Chore Log</h3>
            {loadingWeek && <span className="text-xs text-gray-400">Loading…</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button size="xs" color="light" onClick={() => setWeekStart(w => offsetWeek(w, -1))}><ChevronLeft className="w-4 h-4 mr-1" /> Prev</Button>
            <Button size="xs" color={isThisWeek ? 'default' : 'light'} onClick={() => setWeekStart(getWeekStart(today))}>This Week</Button>
            <Button size="xs" color="light" onClick={() => setWeekStart(w => offsetWeek(w, 1))}>Next <ChevronRight className="w-4 h-4 ml-1" /></Button>
          </div>
        </div>

        {/* Week range label */}
        <div className="px-4 py-2 text-xs font-semibold text-gray-500 border-b border-gray-200 bg-gray-50 dark:bg-gray-700/40 dark:border-gray-700 dark:text-gray-400">
          {fmtWeekRange(weekDays)}
        </div>

        <div>
          {clients.length === 0 ? (
            <div className="p-8 text-sm text-center text-gray-400">No active residents.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[700px]">
                <thead>
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium tracking-wide text-gray-500 uppercase border-b border-gray-200 bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 whitespace-nowrap w-10">Rm</th>
                    <th className="px-3 py-3 text-left text-xs font-medium tracking-wide text-gray-500 uppercase border-b border-gray-200 bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 whitespace-nowrap">Name</th>
                    <th className="px-3 py-3 text-left text-xs font-medium tracking-wide text-gray-500 uppercase border-b border-gray-200 bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 whitespace-nowrap min-w-[130px]">Assigned Chore</th>
                    {weekDays.map(d => {
                      const { day, date } = fmtDayHeader(d)
                      const isToday = d === today
                      return (
                        <th key={d} className={`px-2 py-3 text-center text-xs font-medium uppercase border-b border-gray-200 dark:border-gray-600 whitespace-nowrap min-w-[64px] ${isToday ? 'font-bold bg-[var(--chore-today-bg)] text-[var(--chore-today-text)]' : 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700'}`}>
                          <div>{day}</div>
                          <div className="font-normal text-[.7rem] opacity-80">{date}</div>
                        </th>
                      )
                    })}
                    <th className="px-2 py-3 text-center text-xs font-medium tracking-wide text-gray-500 uppercase border-b border-gray-200 bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 w-[52px]">Done</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => {
                    const daysInitialed = weekDays.filter(d => (logMap[c.id + '_' + d] || '').trim()).length
                    return (
                      <ChoreRow
                        key={c.id}
                        client={c}
                        masterChores={masterChores}
                        weekDays={weekDays}
                        logMap={logMap}
                        today={today}
                        canAssign={canAssign}
                        canLog={canLog}
                        daysInitialed={daysInitialed}
                        onChoreChange={assignment => saveChoreAssign(c.id, assignment)}
                        onInitialsChange={(date, initials) => saveInitials(c.id, date, initials)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Day labels — index 0=Mon … 6=Sun (matches weekDays array order)
const DAY_CHIPS = ['M','T','W','T','F','S','S']
const DAY_SHORT = ['Mo','Tu','We','Th','Fr','Sa','Su']

// ── ChoreRow ──────────────────────────────────────────────────────────
function ChoreRow({ client: c, masterChores, weekDays, logMap, today, canAssign, canLog, daysInitialed, onChoreChange, onInitialsChange }) {
  const [localChore,     setLocalChore]     = useState(c.chore || '')
  const [localDays,      setLocalDays]      = useState(() => { try { return c.chore_days ? JSON.parse(c.chore_days) : [] } catch { return [] } })
  const [localDayShifts, setLocalDayShifts] = useState(() => { try { return c.chore_day_shifts ? JSON.parse(c.chore_day_shifts) : {} } catch { return {} } })

  useEffect(() => { setLocalChore(c.chore || '') }, [c.chore])
  useEffect(() => { try { setLocalDays(c.chore_days ? JSON.parse(c.chore_days) : []) } catch { setLocalDays([]) } }, [c.chore_days])
  useEffect(() => { try { setLocalDayShifts(c.chore_day_shifts ? JSON.parse(c.chore_day_shifts) : {}) } catch { setLocalDayShifts({}) } }, [c.chore_day_shifts])

  function handleChoreChange(newChore) {
    setLocalChore(newChore)
    const days   = newChore ? localDays      : []
    const shifts = newChore ? localDayShifts : {}
    if (!newChore) { setLocalDays([]); setLocalDayShifts({}) }
    onChoreChange({ chore: newChore, chore_days: days, chore_day_shifts: shifts })
  }

  function toggleDay(idx) {
    const active    = localDays.includes(idx)
    const nextDays  = active
      ? localDays.filter(d => d !== idx)
      : [...localDays, idx].sort((a, b) => a - b)
    const nextShifts = { ...localDayShifts }
    if (!active) { if (!nextShifts[idx]) nextShifts[idx] = 'AM' }
    else delete nextShifts[idx]
    setLocalDays(nextDays)
    setLocalDayShifts(nextShifts)
    onChoreChange({ chore: localChore, chore_days: nextDays, chore_day_shifts: nextShifts })
  }

  function setDayShift(idx, t) {
    const nextShifts = { ...localDayShifts, [idx]: t }
    setLocalDayShifts(nextShifts)
    onChoreChange({ chore: localChore, chore_days: localDays, chore_day_shifts: nextShifts })
  }

  const assignedCount = localDays.length > 0 ? localDays.length : 7
  const initialed = weekDays.filter((d, i) => {
    const scheduled = localDays.length === 0 || localDays.includes(i)
    return scheduled && (logMap[`${c.id}_${d}`] || '').trim()
  }).length

  return (
    <tr className="even:bg-gray-50 dark:even:bg-gray-700/20 hover:bg-[var(--teal-50)] dark:hover:bg-gray-700/40 transition-colors">
      <td className="px-3 py-2 font-mono text-xs text-center text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">{c.room}</td>
      <td className="px-3 py-2 font-semibold text-sm text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700">{c.name}</td>
      <td className="px-3 py-2 align-top border-b border-gray-100 dark:border-gray-700">
        {canAssign ? (
          <div className="flex flex-col gap-1.5">
            <Select sizing="sm" value={localChore} onChange={e => handleChoreChange(e.target.value)} className="max-w-[170px]">
              <option value="">— Unassigned —</option>
              {masterChores.map((ch, i) => <option key={i} value={ch}>{ch}</option>)}
            </Select>
            {localChore && (
              <div className="flex gap-1 flex-wrap">
                {DAY_CHIPS.map((label, idx) => {
                  const active = localDays.includes(idx)
                  const shift  = localDayShifts[idx] || 'AM'
                  return (
                    <div key={idx} className="flex flex-col items-center gap-0.5">
                      <button type="button" onClick={() => toggleDay(idx)} title={DAY_SHORT[idx]}
                        className={`w-[22px] h-[22px] rounded-full p-0 text-[.6rem] font-extrabold leading-none cursor-pointer border-[1.5px] ${active ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-[var(--chore-chip-bg)] text-[var(--text-muted)] border-[var(--line)]'}`}>
                        {label}
                      </button>
                      {active && (
                        <div className="flex flex-col gap-px">
                          {['AM','PM'].map(t => (
                            <button key={t} type="button"
                              onClick={e => { e.stopPropagation(); setDayShift(idx, t) }}
                              className={`px-0.5 rounded text-[.55rem] font-bold leading-3 cursor-pointer border ${shift === t ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-[var(--chore-chip-bg)] text-[var(--text-muted)] border-[var(--line)]'}`}>
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm">
            <span className={localChore ? 'font-semibold text-gray-900 dark:text-white' : 'font-normal text-gray-400 dark:text-gray-500'}>
              {localChore || '—'}
            </span>
            {localChore && (
              <div className="text-[.7rem] text-gray-400 dark:text-gray-500 mt-0.5">
                {localDays.length > 0
                  ? localDays.map(idx => `${DAY_SHORT[idx]}:${localDayShifts[idx]||'AM'}`).join(' ')
                  : 'All days · AM'}
              </div>
            )}
          </div>
        )}
      </td>
      {weekDays.map((d, dayIdx) => {
        const initials  = logMap[`${c.id}_${d}`] || ''
        const isToday   = d === today
        const scheduled = localDays.length === 0 || localDays.includes(dayIdx)
        const shift     = localDayShifts[dayIdx] || 'AM'
        return (
          <DayCell
            key={d}
            initials={initials}
            shift={shift}
            isToday={isToday}
            canEdit={canLog && scheduled}
            scheduled={scheduled}
            onBlur={val => onInitialsChange(d, val)}
          />
        )
      })}
      <td className="px-2 py-2 text-center border-b border-gray-100 dark:border-gray-700">
        <span className={`text-[.82rem] font-bold ${initialed === assignedCount ? 'text-[var(--chore-done-text)]' : initialed > 0 ? 'text-[var(--chore-warn-text)]' : 'text-[var(--text-muted)]'}`}>
          {initialed}/{assignedCount}
        </span>
      </td>
    </tr>
  )
}

// ── DayCell ───────────────────────────────────────────────────────────
function DayCell({ initials: savedInitials, shift, isToday, canEdit, scheduled, onBlur }) {
  const [val, setVal] = useState(savedInitials || '')

  useEffect(() => { setVal(savedInitials || '') }, [savedInitials])

  const done = val.trim().length > 0

  if (!scheduled) {
    return (
      <td className="text-center bg-[var(--chore-skip-bg)] px-[2px] py-[3px] border-b border-gray-100 dark:border-gray-700">
        <span className="text-[var(--text-muted)] font-mono text-[.72rem]">—</span>
      </td>
    )
  }

  return (
    <td className={`text-center px-[2px] py-[3px] border-b border-gray-100 dark:border-gray-700 ${isToday ? 'bg-[var(--chore-today-bg)]' : ''}`}>
      <div className="flex flex-col items-center gap-px">
        <span className={`text-[.52rem] font-bold ${done ? 'text-[var(--chore-done-text)]' : 'text-[var(--text-muted)]'}`}>
          {shift}
        </span>
        {canEdit ? (
          <input
            type="text"
            value={val}
            maxLength={4}
            onChange={e => setVal(e.target.value)}
            onBlur={e => { if (e.target.value !== savedInitials) onBlur(e.target.value) }}
            placeholder="—"
            className={`w-[34px] text-center font-mono text-[.72rem] font-bold px-[2px] py-[2px] rounded border-[1.5px] outline-none tracking-[.06em] ${done ? 'border-[var(--chore-done-border)] bg-[var(--chore-done-bg)] text-[var(--chore-done-text)]' : 'border-[var(--line)] bg-[var(--inp-bg)] text-[var(--text-primary)]'}`}
          />
        ) : (
          <span className={`inline-block w-[34px] text-center px-[2px] py-[2px] font-mono text-[.72rem] font-bold rounded ${done ? 'bg-[var(--chore-done-bg)] text-[var(--chore-done-text)]' : 'bg-transparent text-[var(--text-muted)]'}`}>
            {val || '—'}
          </span>
        )}
      </div>
    </td>
  )
}
