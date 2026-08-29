import { useState, useMemo } from 'react'
import { Users, CalendarCheck, ListChecks, Plus, ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, TextInput, Select, Checkbox, Label,
  Modal, ModalHeader, ModalBody, ModalFooter, Alert,
} from 'flowbite-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { Field, useConfirm } from '../../components/ui.jsx'

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
  const confirmDialog = useConfirm()

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
    if (!await confirmDialog({ title: 'Delete this group record?', confirmText: 'Delete', color: 'red' })) return
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
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-gray-900 dark:text-white">Groups</h1>
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
      <div className={`${CARD} !p-0 overflow-hidden`}>
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
    <Modal show size="lg" onClose={onClose}>
      <ModalHeader>{isEdit ? 'Edit Group Attendance' : 'Log Group Attendance'}</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          {err && <Alert color="failure">{err}</Alert>}
          <Alert color="info">Record who attended. A clinician adds the session note and signs it under <strong>Clinical → Group Notes</strong>.</Alert>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Group *" className="col-span-2">
              {masterGroups.length > 0
                ? <Select value={groupName} onChange={e => setGroupName(e.target.value)}>
                    <option value="">— Select group —</option>
                    {masterGroups.map((g, i) => <option key={i} value={g}>{g}</option>)}
                  </Select>
                : <TextInput value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" />}
            </Field>
            <Field label="Date"><TextInput type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          </div>

          <Field label="Topic (optional)"><TextInput value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Relapse prevention" /></Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Attendance</label>
              <div className="flex gap-1.5">
                <Button type="button" size="xs" color="light" onClick={() => setAll(true)}>All Present</Button>
                <Button type="button" size="xs" color="light" onClick={() => setAll(false)}>All Absent</Button>
              </div>
            </div>
            <div className="overflow-hidden overflow-y-auto border border-gray-200 rounded-lg max-h-64 dark:border-gray-700">
              {clients.length === 0
                ? <div className="px-3.5 py-3 text-sm text-gray-400">No active residents.</div>
                : clients.map(c => (
                  <label key={c.id} className={`flex items-center gap-2.5 px-3.5 py-2 cursor-pointer border-b border-gray-100 dark:border-gray-700 ${present[c.id] ? 'bg-green-50 dark:bg-green-900/20' : 'bg-white dark:bg-gray-800'}`}>
                    <Checkbox checked={!!present[c.id]} onChange={() => toggle(c.id)} />
                    <span className="font-mono text-xs text-gray-500 w-7">{c.room}</span>
                    <span className={`text-sm font-semibold ${present[c.id] ? 'text-green-700 dark:text-green-400' : 'text-gray-400'}`}>{c.name}</span>
                    {present[c.id] && <span className="px-1.5 py-px ml-auto text-[10px] font-bold text-green-700 bg-green-100 rounded-full dark:bg-green-900/40 dark:text-green-300">Present</span>}
                  </label>
                ))}
            </div>
            {clients.length > 0 && <div className="mt-1.5 text-xs text-gray-500">{presentCount} of {clients.length} marked present</div>}
          </div>
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={save} isProcessing={saving} disabled={saving}>{isEdit ? 'Save Attendance' : 'Log Attendance'}</Button>
      </ModalFooter>
    </Modal>
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
    <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-[.95rem] text-gray-900 dark:text-white">{s.group_name || '(untitled group)'}</span>
            {s.topic && <span className="text-[.7rem] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 px-2 py-0.5 rounded-full">{s.topic}</span>}
            {total > 0 && (
              <span className={`text-[.7rem] font-extrabold px-2 py-0.5 rounded-full ${pct === 100 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : pct >= 70 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
                {present}/{total} present
              </span>
            )}
            {isFinal
              ? <span className="text-[.68rem] font-bold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-2 py-0.5 rounded-full">Note signed</span>
              : s.content
                ? <span className="text-[.68rem] font-bold bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">Note drafted</span>
                : <span className="text-[.68rem] font-bold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 px-2 py-0.5 rounded-full">Clinical note pending</span>}
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {total > 0 && <Button size="xs" color="light" onClick={() => setExpanded(e => !e)}>{expanded ? '▲ Hide' : '▼ Roster'}</Button>}
          {canLog && !isFinal && <Button size="xs" color="light" onClick={onEdit}>Edit</Button>}
          {canLog && !isFinal && <Button size="xs" color="failure" onClick={onDelete}>Delete</Button>}
        </div>
      </div>

      {expanded && att.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {att.map(a => {
            const isPresent = a.participation === 'present'
            const isExcused = a.participation === 'excused'
            return (
              <span key={a.client_id} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[.78rem] font-semibold border ${isPresent ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800' : isExcused ? 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800' : 'bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'}`}>
                <span className="font-mono text-[.68rem] opacity-70">{a.room}</span>
                {a.client_name}
                {!isPresent && <span className="text-[.65rem] opacity-70">{a.participation}</span>}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
