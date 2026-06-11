import { useState, useMemo, useEffect, useCallback } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

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

  // Build lookup: client_id + log_date → initials
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
    // Update local weekLog optimistically
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
    const done  = weekLog.filter(e => e.initials && e.initials.trim()).length
    return { total, done, pct: total > 0 ? Math.round(done / total * 100) : 0 }
  }, [clients, weekLog])

  const isThisWeek = weekStart === getWeekStart(today)

  return (
    <div>
      {/* Master Chore List */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Master Chore List</span></div>
        </div>
        <div className="section-body">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: masterChores.length > 0 ? 10 : 0 }}>
            {masterChores.map((chore, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: '#f1f5f9', border: '1px solid var(--line)',
                borderRadius: 20, padding: '3px 10px', fontSize: '.8rem', fontWeight: 600,
              }}>
                {chore}
                {canAssign && (
                  <button onClick={() => removeMasterChore(i)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#94a3b8', fontSize: '.8rem', padding: 0, lineHeight: 1,
                  }}>×</button>
                )}
              </span>
            ))}
            {masterChores.length === 0 && (
              <span style={{ color: '#94a3b8', fontSize: '.84rem' }}>No chores defined yet.</span>
            )}
          </div>
          {canAssign && (
            <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
              <input type="text" value={newChore} onChange={e => setNewChore(e.target.value)}
                placeholder="Add chore…" onKeyDown={e => e.key === 'Enter' && addMasterChore()}
                style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: '.88rem', padding: '7px 10px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none' }} />
              <button className="btn-add btn-add-b" onClick={addMasterChore} disabled={savingChores}>+ Add</button>
            </div>
          )}
        </div>
      </div>

      {/* Weekly Chore Log */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left">
            <span className="sh-dot" />
            <span>Weekly Chore Log</span>
            {loadingWeek && <span style={{ fontSize: '.72rem', color: '#94a3b8', marginLeft: 8 }}>Loading…</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '.75rem', color: '#94a3b8', fontFamily: 'var(--mono)' }}>
              {weekStats.done}/{weekStats.total} ({weekStats.pct}%)
            </span>
            {/* Week navigation */}
            <button onClick={() => setWeekStart(w => offsetWeek(w, -1))}
              style={{ padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 5, background: '#f8fafc', cursor: 'pointer', fontSize: '.78rem' }}>
              ← Prev
            </button>
            <button onClick={() => setWeekStart(getWeekStart(today))}
              style={{
                padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 5, cursor: 'pointer', fontSize: '.78rem',
                background: isThisWeek ? 'var(--accent)' : '#f8fafc',
                color: isThisWeek ? '#fff' : 'inherit',
                fontWeight: isThisWeek ? 700 : 400,
              }}>
              This Week
            </button>
            <button onClick={() => setWeekStart(w => offsetWeek(w, 1))}
              style={{ padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 5, background: '#f8fafc', cursor: 'pointer', fontSize: '.78rem' }}>
              Next →
            </button>
          </div>
        </div>

        {/* Week range label */}
        <div style={{ padding: '6px 16px', background: '#f8fafc', borderBottom: '1px solid var(--line)', fontSize: '.78rem', color: '#64748b', fontWeight: 600 }}>
          {fmtWeekRange(weekDays)}
        </div>

        <div className="section-body" style={{ padding: 0 }}>
          {clients.length === 0 ? (
            <div className="empty-state">No active residents.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Rm</th>
                    <th>Name</th>
                    <th style={{ minWidth: 130 }}>Assigned Chore</th>
                    {weekDays.map(d => {
                      const { day, date } = fmtDayHeader(d)
                      const isToday = d === today
                      return (
                        <th key={d} className="tc" style={{
                          minWidth: 64, background: isToday ? '#EFF6FF' : undefined,
                          color: isToday ? '#1D4ED8' : undefined,
                          fontWeight: isToday ? 700 : 600,
                        }}>
                          <div>{day}</div>
                          <div style={{ fontWeight: 400, fontSize: '.7rem', opacity: .8 }}>{date}</div>
                        </th>
                      )
                    })}
                    <th className="tc" style={{ width: 52 }}>Done</th>
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
const DAY_CHIPS  = ['M','T','W','T','F','S','S']
const DAY_SHORT  = ['Mo','Tu','We','Th','Fr','Sa','Su']

// ── ChoreRow ──────────────────────────────────────────────────────────
function ChoreRow({ client: c, masterChores, weekDays, logMap, today, canAssign, canLog, daysInitialed, onChoreChange, onInitialsChange }) {
  const [localChore, setLocalChore] = useState(c.chore || '')
  const [localDays,  setLocalDays]  = useState(() => { try { return c.chore_days ? JSON.parse(c.chore_days) : [] } catch { return [] } })
  const [localTime,  setLocalTime]  = useState(c.chore_time || '')

  // Keep in sync if parent data changes
  useEffect(() => { setLocalChore(c.chore || '') }, [c.chore])
  useEffect(() => { try { setLocalDays(c.chore_days ? JSON.parse(c.chore_days) : []) } catch { setLocalDays([]) } }, [c.chore_days])
  useEffect(() => { setLocalTime(c.chore_time || '') }, [c.chore_time])

  function handleChoreChange(newChore) {
    setLocalChore(newChore)
    const days = newChore ? localDays : []
    const time = newChore ? localTime : ''
    if (!newChore) { setLocalDays([]); setLocalTime('') }
    onChoreChange({ chore: newChore, chore_days: days, chore_time: time })
  }

  function toggleDay(idx) {
    const next = localDays.includes(idx)
      ? localDays.filter(d => d !== idx)
      : [...localDays, idx].sort((a, b) => a - b)
    setLocalDays(next)
    onChoreChange({ chore: localChore, chore_days: next, chore_time: localTime })
  }

  function handleTimeChange(t) {
    const next = localTime === t ? '' : t
    setLocalTime(next)
    onChoreChange({ chore: localChore, chore_days: localDays, chore_time: next })
  }

  // How many assigned days this week (scheduled + initialed)
  const assignedCount = localDays.length > 0 ? localDays.length : 7
  const initialed = weekDays.filter((d, i) => {
    const scheduled = localDays.length === 0 || localDays.includes(i)
    return scheduled && (logMap[`${c.id}_${d}`] || '').trim()
  }).length

  return (
    <tr>
      <td className="rm">{c.room}</td>
      <td className="name-cell">{c.name}</td>
      <td style={{ verticalAlign: 'top', paddingTop: 7 }}>
        {canAssign ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {/* Chore dropdown */}
            <select value={localChore} onChange={e => handleChoreChange(e.target.value)}
              style={{ fontFamily: 'var(--sans)', fontSize: '.84rem', padding: '4px 8px',
                border: '1.5px solid var(--line)', borderRadius: 5, outline: 'none',
                background: '#fff', maxWidth: 170 }}>
              <option value="">— Unassigned —</option>
              {masterChores.map((ch, i) => <option key={i} value={ch}>{ch}</option>)}
            </select>
            {/* Day + time row — only shown when a chore is selected */}
            {localChore && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {/* Day chips */}
                <div style={{ display: 'flex', gap: 2 }}>
                  {DAY_CHIPS.map((label, idx) => {
                    const active = localDays.includes(idx)
                    return (
                      <button key={idx} type="button" onClick={() => toggleDay(idx)}
                        title={DAY_SHORT[idx]}
                        style={{
                          width: 22, height: 22, borderRadius: '50%', padding: 0,
                          background: active ? 'var(--accent)' : '#e2e8f0',
                          color: active ? '#fff' : '#64748b',
                          border: active ? '1.5px solid var(--accent)' : '1.5px solid #d1d5db',
                          cursor: 'pointer', fontSize: '.6rem', fontWeight: 800,
                          lineHeight: '22px', textAlign: 'center',
                        }}>{label}</button>
                    )
                  })}
                </div>
                {/* AM / PM toggle */}
                <div style={{ display: 'flex', gap: 2 }}>
                  {['AM','PM'].map(t => (
                    <button key={t} type="button" onClick={() => handleTimeChange(t)}
                      style={{
                        padding: '1px 6px', borderRadius: 4, fontSize: '.65rem', fontWeight: 800,
                        background: localTime === t ? '#0a4655' : '#f1f5f9',
                        color: localTime === t ? '#fff' : '#64748b',
                        border: `1.5px solid ${localTime === t ? '#0a4655' : '#d1d5db'}`,
                        cursor: 'pointer',
                      }}>{t}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Read-only display */
          <div style={{ fontSize: '.84rem' }}>
            <span style={{ color: localChore ? 'var(--text-primary)' : '#94a3b8', fontWeight: localChore ? 600 : 400 }}>
              {localChore || '—'}
            </span>
            {localChore && (localDays.length > 0 || localTime) && (
              <div style={{ fontSize: '.7rem', color: '#64748b', marginTop: 2 }}>
                {localDays.length > 0
                  ? DAY_SHORT.filter((_, i) => localDays.includes(i)).join(' ')
                  : 'All days'}
                {localTime && ` · ${localTime}`}
              </div>
            )}
          </div>
        )}
      </td>
      {weekDays.map((d, dayIdx) => {
        const key        = `${c.id}_${d}`
        const initials   = logMap[key] || ''
        const isToday    = d === today
        const scheduled  = localDays.length === 0 || localDays.includes(dayIdx)
        return (
          <DayCell
            key={d}
            initials={initials}
            isToday={isToday}
            canEdit={canLog && scheduled}
            scheduled={scheduled}
            onBlur={val => onInitialsChange(d, val)}
          />
        )
      })}
      <td className="tc">
        <span style={{ fontSize: '.82rem', fontWeight: 700,
          color: initialed === assignedCount ? '#15803D' : initialed > 0 ? '#92400E' : '#94a3b8' }}>
          {initialed}/{assignedCount}
        </span>
      </td>
    </tr>
  )
}

// ── DayCell ───────────────────────────────────────────────────────────
function DayCell({ initials: savedInitials, isToday, canEdit, scheduled, onBlur }) {
  const [val, setVal] = useState(savedInitials)
  const done = val.trim().length > 0

  // Sync if parent data updates
  useEffect(() => { setVal(savedInitials) }, [savedInitials])

  if (!scheduled) {
    // Day not in this resident's chore schedule — show muted non-editable cell
    return (
      <td style={{ textAlign: 'center', background: '#f8fafc', padding: '4px 4px' }}>
        <span style={{
          display: 'inline-block', width: 52, padding: '3px 4px',
          fontFamily: 'var(--mono)', fontSize: '.85rem', fontWeight: 700,
          color: done ? '#94a3b8' : '#d1d5db', borderRadius: 5,
          background: done ? '#f1f5f9' : 'transparent',
        }}>
          {val || '—'}
        </span>
      </td>
    )
  }

  return (
    <td style={{ textAlign: 'center', background: isToday ? '#EFF6FF' : undefined, padding: '4px 4px' }}>
      {canEdit ? (
        <input
          type="text"
          value={val}
          maxLength={6}
          onChange={e => setVal(e.target.value)}
          onBlur={e => { if (e.target.value !== savedInitials) onBlur(e.target.value) }}
          placeholder="—"
          style={{
            width: 52, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.85rem', fontWeight: 700,
            padding: '3px 4px', border: `1.5px solid ${done ? '#86EFAC' : 'var(--line)'}`,
            borderRadius: 5, background: done ? '#DCFCE7' : '#fff',
            outline: 'none', letterSpacing: '.08em', color: done ? '#15803D' : 'inherit',
          }}
        />
      ) : (
        <span style={{
          display: 'inline-block', minWidth: 52, padding: '3px 4px',
          fontFamily: 'var(--mono)', fontSize: '.85rem', fontWeight: 700,
          background: done ? '#DCFCE7' : 'transparent',
          color: done ? '#15803D' : '#94a3b8',
          borderRadius: 5,
        }}>
          {val || '—'}
        </span>
      )}
    </td>
  )
}
