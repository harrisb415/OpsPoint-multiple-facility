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
import { Field, ColoredAvatar, StatusBadge, useConfirm } from '../../components/ui.jsx'

const CARD = 'p-8 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 dark:bg-gray-800'
const SEV_BADGE = { low: 'info', medium: 'warning', high: 'pink', critical: 'failure' }
const STATUS_BADGE = { open: 'warning', reviewed: 'info', closed: 'success' }

function todayStr() { return new Date().toISOString().slice(0, 10) }
function nowTime()  { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

const SEVERITY_LABEL = { low:'Low', medium:'Medium', high:'High', critical:'Critical' }

const BLANK = {
  client_id: '', client_name: '', room: '',
  incident_date: todayStr(), incident_time: nowTime(),
  severity: 'low',
  narrative: '', corrective_action: '',
  notifications_required: [],
}

export default function IncidentsTab() {
  const { data, loadData } = useData()
  const { hasPerm } = usePermission()
  const canLog    = hasPerm('incidents.log')
  const canReview = hasPerm('incidents.review')
  const canDelete = hasPerm('incidents.delete')
  const canUnlock = hasPerm('records.unlock')
  const confirm = useConfirm()

  const incidents = data?.incidents || []
  const clients = useMemo(() =>
    (data?.clients || [])
      .filter(c => !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room)||0) - (parseInt(b.room)||0)),
    [data?.clients]
  )
  const policy = data?.incident_notifications || {}

  const [filterClient, setFilterClient] = useState('')
  const [filterSev, setFilterSev] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const [modal, setModal] = useState(null) // null | 'add' | { record }
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [reviewModal, setReviewModal] = useState(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewStatus, setReviewStatus] = useState('reviewed')

  const [unlockModal, setUnlockModal] = useState(null)
  const [unlockReason, setUnlockReason] = useState('')

  function openAdd() {
    setForm({ ...BLANK, notifications_required: policy['low'] || [] })
    setErr(''); setModal('add')
  }
  function openEdit(i) {
    setForm({
      client_id: String(i.client_id), client_name: i.client_name, room: i.room,
      incident_date: i.incident_date, incident_time: i.incident_time,
      severity: i.severity, narrative: i.narrative,
      corrective_action: i.corrective_action,
      notifications_required: i.notifications_required || [],
    })
    setErr(''); setModal({ record: i })
  }
  function handleClient(cid) {
    const c = clients.find(x => String(x.id) === String(cid))
    setForm(f => ({ ...f, client_id: cid, client_name: c?.name || '', room: c?.room || '' }))
  }
  function pickSeverity(sev) {
    const minReq = policy[sev] || []
    const merged = Array.from(new Set([...minReq, ...(form.notifications_required||[])]))
    setForm({ ...form, severity: sev, notifications_required: merged })
  }
  function toggleNotif(key) {
    const minReq = policy[form.severity] || []
    if (minReq.includes(key)) return // can't unset minimum required
    const has = (form.notifications_required||[]).includes(key)
    setForm({ ...form,
      notifications_required: has
        ? form.notifications_required.filter(x => x !== key)
        : [...(form.notifications_required||[]), key],
    })
  }

  async function save() {
    if (!form.client_id) { setErr('Resident required'); return }
    if (!form.narrative.trim()) { setErr('Narrative required'); return }
    setSaving(true); setErr('')
    try {
      const isEdit = modal && modal.record
      const url = isEdit ? `/api/incidents/${modal.record.id}` : '/api/incidents'
      const method = isEdit ? 'PUT' : 'POST'
      const r = await fetch(url, {
        method, credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          client_id: parseInt(form.client_id),
          client_name: form.client_name, room: form.room,
          incident_date: form.incident_date,
          incident_time: form.incident_time,
          severity: form.severity,
          narrative: form.narrative.trim(),
          corrective_action: form.corrective_action,
          notifications_required: form.notifications_required,
        }),
      })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(j.error || 'Save failed'); return }
      setModal(null); setForm(BLANK); loadData()
    } catch { setErr('Network error') } finally { setSaving(false) }
  }

  async function submitReview() {
    const r = await fetch(`/api/incidents/${reviewModal.id}/review`, {
      method:'PUT', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ review_notes: reviewNotes, status: reviewStatus }),
    })
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error||'Review failed'); return }
    setReviewModal(null); setReviewNotes(''); loadData()
  }

  async function del(i) {
    if (!await confirm({ title: 'Delete incident report?', body: 'This is audit-logged.', confirmText: 'Delete', color: 'red' })) return
    const res = await fetch(`/api/incidents/${i.id}`, { method:'DELETE', credentials:'include' })
    if (!res.ok) { const j = await res.json().catch(()=>({})); alert(j.error||'Delete failed'); return }
    loadData()
  }

  async function submitUnlock() {
    if (!unlockReason.trim()) { alert('Reason required'); return }
    const r = await fetch(`/api/incidents/${unlockModal.id}/unlock`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ reason: unlockReason }),
    })
    const j = await r.json().catch(()=>({}))
    if (!r.ok) { alert(j.error || 'Unlock failed'); return }
    setUnlockModal(null); setUnlockReason(''); loadData()
  }

  const filtered = useMemo(() => {
    return incidents.filter(i => {
      if (filterClient && String(i.client_id) !== filterClient) return false
      if (filterSev && i.severity !== filterSev) return false
      if (filterStatus && i.status !== filterStatus) return false
      return true
    })
  }, [incidents, filterClient, filterSev, filterStatus])

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Clinical</BreadcrumbItem>
            <BreadcrumbItem>Incident Reports</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Incident Reports</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Behavioral incidents are formal regulatory documents — distinct from program-rule infractions; severity drives mandatory notifications</p>
        </div>
        {canLog && <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> New Report</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select sizing="sm" value={filterClient} onChange={e=>setFilterClient(e.target.value)}>
          <option value="">All residents</option>
          {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
        </Select>
        <Select sizing="sm" value={filterSev} onChange={e=>setFilterSev(e.target.value)}>
          <option value="">All severities</option>
          {Object.entries(SEVERITY_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select sizing="sm" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="reviewed">Reviewed</option>
          <option value="closed">Closed</option>
        </Select>
        <span className="ml-auto text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {filtered.length === 0
        ? <div className={`${CARD} text-sm text-center text-gray-400`}>No incident reports.</div>
        : (
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell>Resident</TableHeadCell>
                <TableHeadCell>Severity</TableHeadCell>
                <TableHeadCell>Narrative</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>Reviewer</TableHeadCell>
                <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y">
              {filtered.map(i => (
                <TableRow key={i.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                  <TableCell className="font-mono whitespace-nowrap">{fmtDate(i.incident_date)} {i.incident_time}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ColoredAvatar name={i.client_name} />
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{i.client_name}</p>
                        <p className="font-mono text-xs text-gray-400">Rm {i.room}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge color={SEV_BADGE[i.severity] || 'gray'}>{SEVERITY_LABEL[i.severity] || i.severity}</StatusBadge></TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400" style={{ maxWidth: 340 }}>
                    <div className="overflow-hidden whitespace-nowrap text-ellipsis">{i.narrative}</div>
                    {i.notifications_required?.length > 0 && (
                      <div className="mt-1 text-xs text-gray-400">Notify: {i.notifications_required.join(', ')}</div>
                    )}
                  </TableCell>
                  <TableCell><StatusBadge color={STATUS_BADGE[i.status] || 'gray'}>{i.status.charAt(0).toUpperCase() + i.status.slice(1)}</StatusBadge></TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400">{i.supervisor_name || '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center justify-end gap-1">
                      {i.locked_at
                        ? (canUnlock
                            ? <Button size="xs" color="light" onClick={()=>{setUnlockReason(''); setUnlockModal(i)}} title="Unlock"><Lock className="w-4 h-4" /></Button>
                            : <span title="Locked" className="p-1.5 text-gray-300"><Lock className="w-4 h-4" /></span>)
                        : <>
                            {canLog && <Button size="xs" color="light" onClick={()=>openEdit(i)}>Edit</Button>}
                            {canReview && i.status !== 'closed' && (
                              <Button size="xs" color="light" className="text-primary-700 dark:text-primary-300" onClick={()=>{ setReviewNotes(i.review_notes||''); setReviewStatus(i.status==='open'?'reviewed':'closed'); setReviewModal(i) }}>
                                {i.status === 'open' ? 'Review' : 'Close'}
                              </Button>
                            )}
                            {canDelete && <Button size="xs" color="light" className="text-red-600" onClick={()=>del(i)}>Delete</Button>}
                          </>
                      }
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }

      {modal && (
        <Modal show size="2xl" onClose={() => setModal(null)}>
          <ModalHeader>{modal.record ? 'Edit Incident Report' : 'New Incident Report'}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {err && <Alert color="failure">{err}</Alert>}
              <Field label="Resident">
                <Select value={form.client_id} onChange={e=>handleClient(e.target.value)} disabled={!!modal.record}>
                  <option value="">— select —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Date"><TextInput type="date" value={form.incident_date} onChange={e=>setForm({...form, incident_date:e.target.value})}/></Field>
                <Field label="Time"><TextInput type="time" value={form.incident_time} onChange={e=>setForm({...form, incident_time:e.target.value})}/></Field>
                <Field label="Severity">
                  <Select value={form.severity} onChange={e=>pickSeverity(e.target.value)}>
                    {Object.entries(SEVERITY_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Narrative — observed behavior and immediate response"><Textarea rows={4} value={form.narrative} onChange={e=>setForm({...form, narrative:e.target.value})}/></Field>
              <Field label="Corrective action"><Textarea rows={2} value={form.corrective_action} onChange={e=>setForm({...form, corrective_action:e.target.value})}/></Field>
              <Field label="Required notifications" hint="Asterisk = required at the selected severity (cannot be unset).">
                <div className="flex flex-wrap gap-1.5">
                  {['supervisor','case_manager','licensing','guardian','doh','insurance','law_enforcement'].map(key => {
                    const minReq = (policy[form.severity]||[]).includes(key)
                    const on = (form.notifications_required||[]).includes(key) || minReq
                    return (
                      <Button key={key} size="xs" type="button" color={on ? 'default' : 'light'}
                        onClick={()=>toggleNotif(key)} disabled={minReq} title={minReq ? 'Required at this severity' : ''}
                        className="capitalize">
                        {key.replace(/_/g,' ')}{minReq && ' *'}
                      </Button>
                    )
                  })}
                </div>
              </Field>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={()=>setModal(null)}>Cancel</Button>
            <Button disabled={saving} isProcessing={saving} onClick={save}>Save</Button>
          </ModalFooter>
        </Modal>
      )}

      {reviewModal && (
        <Modal show size="lg" onClose={() => setReviewModal(null)}>
          <ModalHeader>Supervisor Review</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                <strong className="text-gray-900 dark:text-white">{reviewModal.client_name}</strong> — {fmtDate(reviewModal.incident_date)}
              </div>
              <Field label="Review notes"><Textarea rows={4} value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)}/></Field>
              <Field label="New status">
                <Select value={reviewStatus} onChange={e=>setReviewStatus(e.target.value)}>
                  <option value="reviewed">Reviewed (open follow-up)</option>
                  <option value="closed">Closed</option>
                </Select>
              </Field>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={()=>setReviewModal(null)}>Cancel</Button>
            <Button onClick={submitReview}>Submit Review</Button>
          </ModalFooter>
        </Modal>
      )}

      {unlockModal && (
        <Modal show size="md" onClose={() => setUnlockModal(null)}>
          <ModalHeader>Unlock Incident Report</ModalHeader>
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
