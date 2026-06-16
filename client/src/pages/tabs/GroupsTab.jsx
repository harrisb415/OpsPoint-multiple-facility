import { useState, useMemo } from 'react'
import { Users, CalendarCheck, ListChecks, Plus, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Breadcrumb, BreadcrumbItem, Button, TextInput } from 'flowbite-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

const CARD = 'p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 sm:p-5 dark:bg-gray-800'

function todayStr() { return new Date().toISOString().slice(0, 10) }

function fmtDateHeading(d) {
  const dt = new Date(d + 'T12:00:00')
  const isToday = d === todayStr()
  const label = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  return isToday ? `Today — ${label}` : label
}
function offsetDate(d, delta) {
  const dt = new Date(d + 'T12:00:00')
  dt.setDate(dt.getDate() + delta)
  return dt.toISOString().slice(0, 10)
}

// Attendance entry feeds the SAME record the clinician finishes in the Clinical
// section. PAs log who attended (this tab); a clinician with clinical.groups
// adds the session note and signs it under Clinical → Group Notes.
export default function GroupsTab() {
  const { groupNotes, data, loadData } = useData()
  const { hasPerm } = usePermission()
  const canView = hasPerm('groups.view') || hasPerm('groups.log') || hasPerm('clinical.groups')
  const canLog  = hasPerm('groups.log') || hasPerm('clinical.groups')

  const masterGroups = useMemo(() => data?.master_groups || [], [data?.master_groups])
  const clients = useMemo(() =>
    (data?.clients || [])
      .filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [data?.clients]
  )

  const [viewDate, setViewDate] = useState(todayStr)
  const sessions = useMemo(
    () => (groupNotes || []).filter(g => g.session_date === viewDate),
    [groupNotes, viewDate]
  )

  // ── Master group list management ─────────────────────────────────────
  const [newGroup, setNewGroup] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)
  async function saveMaster(next) {
    await fetch('/api/master-groups', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ groups: next }),
    })
    loadData()
  }
  async function addMasterGroup() {
    const t = newGroup.trim(); if (!t) return
    setSavingGroup(true); await saveMaster([...masterGroups, t]); setNewGroup(''); setSavingGroup(false)
  }

  // ── Attendance modal ─────────────────────────────────────────────────
  const [modal, setModal]   = useState(null)   // null | {} (new) | record (edit)
  const [saving, setSaving] = useState(false)

  const isToday = viewDate === todayStr()

  async function deleteSession(id) {
    if (!confirm('Delete this group record?')) return
    const r = await fetch(`/api/clinical/group-notes/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || 'Delete failed'); return }
    loadData()
  }

  if (!canView) {
    return <div className={`${CARD} p-8 text-sm text-center text-gray-400`}>You don't have permission to view group attendance.</div>
  }

  const att = sessions.reduce((acc, s) => {
    const list = s.attendees || []
    return { present: acc.present + list.filter(a => a.participation === 'present').length, total: acc.total + list.length }
  }, { present: 0, total: 0 })
  const avgPct = att.total > 0 ? Math.round(att.present / att.total * 100) : 0
  const avgTint = avgPct >= 80
    ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300'
    : avgPct >= 50
      ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-300'
      : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300'

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Daily Ops</BreadcrumbItem>
            <BreadcrumbItem>Groups</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Groups</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Group attendance — clinicians add and sign session notes under Clinical</p>
        </div>
        {canLog && <Button onClick={() => setModal({})}><Plus className="w-4 h-4 mr-2" /> Log Attendance</Button>}
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { label: 'Sessions', value: sessions.length, sub: 'on selected date', Icon: CalendarCheck, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
          { label: 'Avg Attendance', value: `${avgPct}%`, sub: `${att.present}/${att.total} present`, Icon: Users, tint: avgTint },
          { label: 'Defined Groups', value: masterGroups.length, sub: 'in master list', Icon: ListChecks, tint: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300' },
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

      {/* Master Group List */}
      <div className={`${CARD} mb-4`}>
        <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Master Group List</h3>
        <div className="flex flex-wrap gap-2">
          {masterGroups.map((g, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-full dark:bg-gray-700 dark:text-gray-200">
              {g}
              {canLog && <button onClick={() => saveMaster(masterGroups.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>}
            </span>
          ))}
          {masterGroups.length === 0 && <span className="text-sm text-gray-400">No groups defined yet.</span>}
        </div>
        {canLog && (
          <div className="flex gap-2 mt-3">
            <TextInput className="flex-1" value={newGroup} onChange={e => setNewGroup(e.target.value)}
              placeholder="Add group…" onKeyDown={e => e.key === 'Enter' && addMasterGroup()} />
            <Button onClick={addMasterGroup} isProcessing={savingGroup} disabled={savingGroup}>Add</Button>
          </div>
        )}
      </div>

      {/* Session Log */}
      <div className={CARD} style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex flex-col gap-3 p-4 border-b border-gray-200 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Group Attendance</h3>
          <div className="flex items-center gap-2">
            <Button size="xs" color="light" onClick={() => setViewDate(d => offsetDate(d, -1))}><ChevronLeft className="w-4 h-4 mr-1" /> Prev</Button>
            <Button size="xs" color={isToday ? 'default' : 'light'} onClick={() => setViewDate(todayStr())}>Today</Button>
            <Button size="xs" color="light" onClick={() => setViewDate(d => offsetDate(d, 1))}>Next <ChevronRight className="w-4 h-4 ml-1" /></Button>
          </div>
        </div>

        <div className="px-4 py-2 text-xs font-semibold text-gray-500 border-b border-gray-200 bg-gray-50 dark:bg-gray-700/40 dark:border-gray-700 dark:text-gray-400">
          {fmtDateHeading(viewDate)}
        </div>

        <div>
          {sessions.length === 0
            ? <div className="p-8 text-sm text-center text-gray-400">No group attendance logged for this date.</div>
            : sessions.map(s => (
              <SessionCard key={s.id} session={s} canLog={canLog}
                onEdit={() => setModal(s)} onDelete={() => deleteSession(s.id)} />
            ))}
        </div>
      </div>

      {modal && (
        <AttendanceModal
          record={modal.id ? modal : null}
          clients={clients} masterGroups={masterGroups} viewDate={viewDate}
          saving={saving} setSaving={setSaving}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); loadData() }}
        />
      )}
    </div>
  )
}

function AttendanceModal({ record, clients, masterGroups, viewDate, onClose, onSaved, saving, setSaving }) {
  const isEdit = !!record
  const [groupName, setGroupName] = useState(record?.group_name || (masterGroups[0] || ''))
  const [date, setDate]   = useState(record?.session_date || viewDate)
  const [topic, setTopic] = useState(record?.topic || '')
  const [err, setErr]     = useState('')

  // present map: clientId → bool. New = all present; edit = from existing attendees.
  const [present, setPresent] = useState(() => {
    const m = {}
    if (isEdit) {
      const att = record.attendees || []
      clients.forEach(c => { const a = att.find(x => x.client_id === c.id); m[c.id] = a ? a.participation === 'present' : false })
    } else {
      clients.forEach(c => { m[c.id] = true })
    }
    return m
  })
  const toggle = id => setPresent(p => ({ ...p, [id]: !p[id] }))
  const setAll = val => setPresent(Object.fromEntries(clients.map(c => [c.id, val])))
  const presentCount = clients.filter(c => present[c.id]).length

  async function save() {
    if (!groupName) { setErr('Group name required'); return }
    if (!date) { setErr('Date required'); return }
    setSaving(true); setErr('')
    try {
      const attendees = clients.map(c => ({ client_id: c.id, participation: present[c.id] ? 'present' : 'absent' }))
      const body = { group_name: groupName, session_date: date, topic, attendees }
      const url = isEdit ? `/api/clinical/group-notes/${record.id}` : '/api/clinical/group-notes'
      const r = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Save failed'); return }
      onSaved()
    } catch { setErr('Network error') } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <div className="modal-head">
          <h2>{isEdit ? 'Edit Group Attendance' : 'Log Group Attendance'}</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {err && <div className="auth-error">{err}</div>}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', fontSize: '.76rem', borderRadius: 6, padding: '7px 11px', marginBottom: 12 }}>
            Record who attended. A clinician adds the session note and signs it under <strong>Clinical → Group Notes</strong>.
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 2 }}>
              <label>Group <span style={{ color: '#DC2626' }}>*</span></label>
              {masterGroups.length > 0
                ? <select value={groupName} onChange={e => setGroupName(e.target.value)}
                    style={{ fontFamily: 'var(--sans)', fontSize: '.9rem', padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none', width: '100%' }}>
                    <option value="">— Select group —</option>
                    {masterGroups.map((g, i) => <option key={i} value={g}>{g}</option>)}
                  </select>
                : <input type="text" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" />}
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Topic <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
            <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Relapse prevention" />
          </div>

          <div className="field">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ marginBottom: 0 }}>Attendance</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn-sm" style={pillBtn} onClick={() => setAll(true)}>All Present</button>
                <button type="button" className="btn btn-sm" style={pillBtn} onClick={() => setAll(false)}>All Absent</button>
              </div>
            </div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
              {clients.length === 0
                ? <div style={{ padding: '12px 14px', color: '#94a3b8', fontSize: '.84rem' }}>No active residents.</div>
                : clients.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: present[c.id] ? '#f0fdf4' : '#fff' }}>
                    <input type="checkbox" checked={!!present[c.id]} onChange={() => toggle(c.id)} style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#64748b', width: 30 }}>{c.room}</span>
                    <span style={{ fontSize: '.88rem', fontWeight: 600, color: present[c.id] ? '#15803d' : '#94a3b8' }}>{c.name}</span>
                    {present[c.id] && <span style={{ marginLeft: 'auto', fontSize: '.68rem', fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: 10 }}>Present</span>}
                  </label>
                ))}
            </div>
            {clients.length > 0 && <div style={{ fontSize: '.75rem', color: '#64748b', marginTop: 6 }}>{presentCount} of {clients.length} marked present</div>}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : (isEdit ? 'Save Attendance' : 'Log Attendance')}</button>
        </div>
      </div>
    </div>
  )
}

function SessionCard({ session: s, canLog, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const att = s.attendees || []
  const present = att.filter(a => a.participation === 'present').length
  const total = att.length
  const pct = total > 0 ? Math.round(present / total * 100) : 0
  const isFinal = s.status === 'final'

  return (
    <div style={{ borderBottom: '1px solid var(--line)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--text-primary)' }}>{s.group_name || '(untitled group)'}</span>
            {s.topic && <span style={{ fontSize: '.7rem', fontWeight: 700, background: '#dbeafe', color: '#1e40af', padding: '2px 7px', borderRadius: 10 }}>{s.topic}</span>}
            {total > 0 && (
              <span style={{ fontSize: '.7rem', fontWeight: 800, padding: '2px 7px', borderRadius: 10,
                background: pct === 100 ? '#dcfce7' : pct >= 70 ? '#fef9c3' : '#fee2e2',
                color: pct === 100 ? '#15803d' : pct >= 70 ? '#854d0e' : '#991b1b' }}>{present}/{total} present</span>
            )}
            {isFinal
              ? <span style={{ fontSize: '.68rem', fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '2px 7px', borderRadius: 10 }}>🔒 Note signed</span>
              : s.content
                ? <span style={{ fontSize: '.68rem', fontWeight: 700, background: '#e0f2fe', color: '#0369a1', padding: '2px 7px', borderRadius: 10 }}>Note drafted</span>
                : <span style={{ fontSize: '.68rem', fontWeight: 700, background: '#fef9c3', color: '#854d0e', padding: '2px 7px', borderRadius: 10 }}>Clinical note pending</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {total > 0 && <button className="btn btn-sm" onClick={() => setExpanded(e => !e)} style={pillBtn}>{expanded ? '▲ Hide' : '▼ Roster'}</button>}
          {canLog && !isFinal && <button className="btn btn-sm" onClick={onEdit} style={pillBtn}>Edit</button>}
          {canLog && !isFinal && <button className="btn btn-sm" onClick={onDelete} style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626', fontSize: '.72rem' }}>Delete</button>}
        </div>
      </div>

      {expanded && att.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {att.map(a => {
            const isPresent = a.participation === 'present'
            const isExcused = a.participation === 'excused'
            return (
              <span key={a.client_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: '.78rem', fontWeight: 600,
                background: isPresent ? '#dcfce7' : isExcused ? '#fef3c7' : '#f1f5f9',
                color: isPresent ? '#15803d' : isExcused ? '#92400e' : '#94a3b8',
                border: `1px solid ${isPresent ? '#86efac' : isExcused ? '#fde68a' : '#e2e8f0'}` }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', opacity: .7 }}>{a.room}</span>
                {a.client_name}
                {!isPresent && <span style={{ fontSize: '.65rem', opacity: .7 }}>{a.participation}</span>}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

const pillBtn = { background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)', fontSize: '.72rem' }
