import { useState, useMemo } from 'react'
import { Plus, Lock } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, Select,
  TextInput, Textarea, Modal, ModalHeader, ModalBody, ModalFooter, Alert,
} from 'flowbite-react'
import { Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from '../../components/table'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { initials } from '../../utils/ui.js'
import { Field, ColoredAvatar, useConfirm } from '../../components/ui.jsx'

const CARD = 'p-8 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 dark:bg-gray-800'
const MS_BADGE = { in_progress: 'warning', completed: 'success', waived: 'gray' }
const MS_LABEL = { in_progress: 'In Progress', completed: 'Completed', waived: 'Waived' }

function todayStr() { return new Date().toISOString().slice(0, 10) }
function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}
// created_at is stored as a UTC timestamp ('YYYY-MM-DD HH:MM:SS'); date-only
// fields parse at local noon. Handles both.
function fmtLogged(ts) {
  if (!ts) return '—'
  try {
    const d = String(ts).includes(' ') ? new Date(ts.replace(' ', 'T') + 'Z') : new Date(ts + 'T12:00:00')
    return isNaN(d.getTime()) ? ts : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return ts }
}
function completedOn(m) {
  return m.completion_date || (m.signed_off_at ? String(m.signed_off_at).slice(0, 10) : null)
}

const _MS_CLS = { warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300', success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' }
function StatusBadge({ status }) {
  return <span className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap ${_MS_CLS[MS_BADGE[status]] || _MS_CLS.gray}`}>{MS_LABEL[status] || status}</span>
}

const BLANK = { client_id: '', client_name: '', phase: '', objective: '', target_date: '', notes: '', goal_ref: '' }

export default function MilestonesTab() {
  const { data, loadData, treatmentPlans } = useData()
  const { hasPerm } = usePermission()
  const canEdit    = hasPerm('milestones.edit')
  const canSignoff = hasPerm('milestones.signoff')
  const canUnlock  = hasPerm('records.unlock')
  const confirm = useConfirm()

  const milestones = data?.milestones || []
  const clients = useMemo(() =>
    (data?.clients || [])
      .filter(c => !c.is_special && c.name !== 'VACANT' && c.is_active)
      .slice().sort((a, b) => (parseInt(a.room)||0) - (parseInt(b.room)||0)),
    [data?.clients]
  )
  const phases = data?.program_phases || []

  const [filterClient, setFilterClient] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [view, setView] = useState('by_client') // by_client | list

  const [modal, setModal] = useState(null) // null | 'add' | { record }
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [customObj, setCustomObj] = useState(false)  // "Custom…" objective mode

  // True when an objective isn't one of the phase's predefined options.
  function isCustomObjective(objective, phaseLabel) {
    if (!objective) return false
    const p = phases.find(p => p.label === phaseLabel)
    const opts = p?.objectives || []
    return opts.length > 0 && !opts.includes(objective)
  }

  const [unlockModal, setUnlockModal] = useState(null)
  const [unlockReason, setUnlockReason] = useState('')

  function openAdd(client) {
    setForm({
      ...BLANK,
      client_id:   client ? String(client.id) : '',
      client_name: client?.name || '',
      phase: phases[0]?.label || '',
    })
    setCustomObj(false)
    setErr(''); setModal('add')
  }
  function openEdit(m) {
    setForm({
      client_id: String(m.client_id), client_name: m.client_name,
      phase: m.phase, objective: m.objective,
      target_date: m.target_date || '', notes: m.notes || '',
      goal_ref: (m.treatment_plan_id && m.goal_id) ? `${m.treatment_plan_id}::${m.goal_id}` : '',
    })
    setCustomObj(isCustomObjective(m.objective, m.phase))
    setErr(''); setModal({ record: m })
  }
  function handleClient(cid) {
    const c = clients.find(x => String(x.id) === String(cid))
    setForm(f => ({ ...f, client_id: cid, client_name: c?.name || '', goal_ref: '' }))
  }
  function pickPhase(label) {
    const p = phases.find(p => p.label === label)
    const objList = p?.objectives || []
    setForm(f => ({ ...f, phase: label, objective: objList[0] || '' }))
    setCustomObj(false)
  }

  async function save() {
    if (!form.client_id) { setErr('Resident required'); return }
    if (!form.objective.trim()) { setErr('Objective required'); return }
    setSaving(true); setErr('')
    try {
      const isEdit = modal && modal.record
      const url = isEdit ? `/api/milestones/${modal.record.id}` : '/api/milestones'
      const method = isEdit ? 'PUT' : 'POST'
      let treatment_plan_id = null, goal_id = null
      if (form.goal_ref) { const [pid, gid] = form.goal_ref.split('::'); treatment_plan_id = parseInt(pid) || null; goal_id = gid || null }
      const r = await fetch(url, {
        method, credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          client_id: parseInt(form.client_id),
          client_name: form.client_name,
          phase: form.phase, objective: form.objective.trim(),
          target_date: form.target_date || null,
          notes: form.notes,
          treatment_plan_id, goal_id,
        }),
      })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(j.error || 'Save failed'); return }
      setModal(null); setForm(BLANK); loadData()
    } catch { setErr('Network error') } finally { setSaving(false) }
  }

  async function signoff(m) {
    if (!await confirm({ title: `Mark milestone completed for ${m.client_name}?`, body: m.objective, confirmText: 'Mark Complete' })) return
    const r = await fetch(`/api/milestones/${m.id}/signoff`, {
      method:'PUT', credentials:'include',
    })
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error||'Signoff failed'); return }
    loadData()
  }
  async function setStatus(m, status) {
    const r = await fetch(`/api/milestones/${m.id}`, {
      method:'PUT', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ status, completion_date: status === 'completed' ? todayStr() : null }),
    })
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error||'Update failed'); return }
    loadData()
  }
  async function del(m) {
    if (!await confirm({ title: 'Delete milestone?', body: 'This is audit-logged.', confirmText: 'Delete', color: 'red' })) return
    const res = await fetch(`/api/milestones/${m.id}`, { method:'DELETE', credentials:'include' })
    if (!res.ok) { const j = await res.json().catch(()=>({})); alert(j.error||'Delete failed'); return }
    loadData()
  }
  async function submitUnlock() {
    if (!unlockReason.trim()) { alert('Reason required'); return }
    const r = await fetch(`/api/milestones/${unlockModal.id}/unlock`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ reason: unlockReason }),
    })
    const j = await r.json().catch(()=>({}))
    if (!r.ok) { alert(j.error || 'Unlock failed'); return }
    setUnlockModal(null); setUnlockReason(''); loadData()
  }

  const filtered = useMemo(() => {
    return milestones.filter(m => {
      if (filterClient && String(m.client_id) !== filterClient) return false
      if (filterStatus && m.status !== filterStatus) return false
      return true
    })
  }, [milestones, filterClient, filterStatus])

  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach(m => {
      if (!map[m.client_id]) map[m.client_id] = { id: m.client_id, name: m.client_name, items: [] }
      map[m.client_id].items.push(m)
    })
    return Object.values(map)
  }, [filtered])

  const actionBtn = 'px-2.5 py-1 text-xs font-medium rounded-lg'

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Clinical</BreadcrumbItem>
            <BreadcrumbItem>Milestones</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Milestones</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Program milestones and phase objectives</p>
        </div>
        {canEdit && <Button onClick={() => openAdd()}><Plus className="w-4 h-4 mr-2" /> Add Milestone</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select sizing="sm" value={view} onChange={e=>setView(e.target.value)}>
          <option value="by_client">By Resident</option>
          <option value="list">All (list)</option>
        </Select>
        <Select sizing="sm" value={filterClient} onChange={e=>setFilterClient(e.target.value)}>
          <option value="">All residents</option>
          {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
        </Select>
        <Select sizing="sm" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="waived">Waived</option>
        </Select>
        <span className="ml-auto text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {filtered.length === 0
        ? <div className={`${CARD} text-sm text-center text-gray-400`}>No milestones.</div>
        : view === 'list' ? (
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Resident</TableHeadCell>
                <TableHeadCell>Phase</TableHeadCell>
                <TableHeadCell>Objective</TableHeadCell>
                <TableHeadCell>Target</TableHeadCell>
                <TableHeadCell>Completed</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>Signed Off By</TableHeadCell>
                <TableHeadCell>Logged</TableHeadCell>
                <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y">
              {filtered.map(m => (
                <TableRow key={m.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ColoredAvatar name={m.client_name} photo={(data.clients || []).find(cl => cl.id === m.client_id)?.photo} />
                      <span className="text-sm font-semibold text-gray-900 whitespace-nowrap dark:text-white">{m.client_name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400">{m.phase}</TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400">{m.objective}</TableCell>
                  <TableCell className="font-mono">{fmtDate(m.target_date)}</TableCell>
                  <TableCell className="font-mono">{m.status === 'completed' ? fmtDate(completedOn(m)) : '—'}</TableCell>
                  <TableCell><StatusBadge status={m.status} /></TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400">{m.counselor_name || '—'}</TableCell>
                  <TableCell className="font-mono">{fmtLogged(m.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center justify-end gap-1">
                      {m.locked_at
                        ? (canUnlock
                            ? <Button size="xs" color="light" onClick={()=>{setUnlockReason(''); setUnlockModal(m)}} title="Unlock"><Lock className="w-4 h-4" /></Button>
                            : <span title="Locked" className="p-1.5 text-gray-300"><Lock className="w-4 h-4" /></span>)
                        : <>
                            {canEdit && <Button size="xs" color="light" onClick={()=>openEdit(m)}>Edit</Button>}
                            {m.status === 'in_progress' && canSignoff && <Button size="xs" color="light" className="text-green-700 dark:text-green-400" onClick={()=>signoff(m)}>✓ Complete</Button>}
                            {m.status === 'in_progress' && canEdit && <Button size="xs" color="light" onClick={()=>setStatus(m,'waived')}>Waive</Button>}
                            {canEdit && <Button size="xs" color="light" className="text-red-600" onClick={()=>del(m)}>Delete</Button>}
                          </>
                      }
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className={`${CARD} !p-0 overflow-hidden`}>
            {grouped.map(g => (
              <div key={g.id} className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{g.name}</div>
                <ul className="space-y-2">
                  {g.items.map(m => (
                    <li key={m.id} className="text-sm text-gray-600 dark:text-gray-300">
                      <strong className="text-gray-900 dark:text-white">{m.phase}</strong> — {m.objective}{' '}
                      <StatusBadge status={m.status}/>{' '}
                      {m.target_date && <span className="text-gray-400">target {fmtDate(m.target_date)}</span>}{' '}
                      {m.status === 'completed' && completedOn(m) && <span className="font-medium text-green-600 dark:text-green-400">· completed {fmtDate(completedOn(m))}</span>}{' '}
                      {!m.locked_at && m.status === 'in_progress' && canSignoff && <button onClick={()=>signoff(m)} className={`${actionBtn} text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30`}>✓ Complete</button>}
                      {!m.locked_at && canEdit && <button onClick={()=>openEdit(m)} className={`${actionBtn} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700`}>Edit</button>}
                      <div className="mt-1 text-xs text-gray-400">
                        Logged {fmtLogged(m.created_at)}{m.counselor_name ? ` · signed off by ${m.counselor_name}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      }

      {modal && (
        <Modal show size="lg" onClose={() => setModal(null)}>
          <ModalHeader>{modal.record ? 'Edit Milestone' : 'New Milestone'}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {err && <Alert color="failure">{err}</Alert>}
              <Field label="Resident">
                <Select value={form.client_id} onChange={e=>handleClient(e.target.value)} disabled={!!modal.record}>
                  <option value="">— select —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                </Select>
              </Field>
              <Field label="Phase">
                <Select value={form.phase} onChange={e=>pickPhase(e.target.value)}>
                  <option value="">— select —</option>
                  {phases.map(p => <option key={p.key} value={p.label}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Objective">
                {(() => {
                  const p = phases.find(p => p.label === form.phase)
                  const opts = p?.objectives || []
                  if (opts.length === 0) {
                    return <TextInput value={form.objective} onChange={e=>setForm({...form, objective:e.target.value})}/>
                  }
                  return (
                    <div className="space-y-1.5">
                      <Select
                        value={customObj ? '__custom__' : form.objective}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '__custom__') { setCustomObj(true); setForm(f => ({ ...f, objective: '' })) }
                          else { setCustomObj(false); setForm(f => ({ ...f, objective: v })) }
                        }}>
                        <option value="">— select —</option>
                        {opts.map(o => <option key={o} value={o}>{o}</option>)}
                        <option value="__custom__">Custom…</option>
                      </Select>
                      {customObj && (
                        <TextInput autoFocus placeholder="Custom objective"
                          value={form.objective}
                          onChange={e=>setForm(f => ({ ...f, objective: e.target.value }))}/>
                      )}
                    </div>
                  )
                })()}
              </Field>
              <Field label="Target date"><TextInput type="date" value={form.target_date} onChange={e=>setForm({...form, target_date:e.target.value})}/></Field>
              <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})}/></Field>
              <Field label="Advances treatment-plan goal (optional)">
                {(() => {
                  if (!form.client_id) return <div className="text-xs text-gray-400">Select a resident first.</div>
                  const plans = (treatmentPlans || []).filter(p => String(p.client_id) === String(form.client_id))
                  const opts = []
                  plans.forEach(p => (Array.isArray(p.goals) ? p.goals : []).forEach(g => { if (g && g.id) opts.push({ v: `${p.id}::${g.id}`, l: g.goal || '(untitled goal)' }) }))
                  if (opts.length === 0) return <div className="text-xs text-gray-400">No treatment-plan goals for this resident yet.</div>
                  return (
                    <Select value={form.goal_ref} onChange={e=>setForm({...form, goal_ref:e.target.value})}>
                      <option value="">— none —</option>
                      {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </Select>
                  )
                })()}
              </Field>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={()=>setModal(null)}>Cancel</Button>
            <Button disabled={saving} isProcessing={saving} onClick={save}>Save</Button>
          </ModalFooter>
        </Modal>
      )}

      {unlockModal && (
        <Modal show size="md" onClose={() => setUnlockModal(null)}>
          <ModalHeader>Unlock Milestone</ModalHeader>
          <ModalBody>
            <Field label="Reason (audit-logged)"><Textarea rows={3} value={unlockReason} onChange={e=>setUnlockReason(e.target.value)}/></Field>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={()=>setUnlockModal(null)}>Cancel</Button>
            <Button onClick={submitUnlock}>Unlock</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
