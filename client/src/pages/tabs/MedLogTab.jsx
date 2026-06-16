import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Pill, Clock, Lock, Plus } from 'lucide-react'
import {
  Avatar, Breadcrumb, BreadcrumbItem, Button, Select,
  Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
} from 'flowbite-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { initials } from '../../utils/ui.js'

const CARD = 'p-8 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 dark:bg-gray-800'

function nowDT() {
  const d = new Date(), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s.length === 10 ? s + 'T12:00:00' : s)
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}

const BLANK = {
  client_id: '', client_name: '', room: '',
  medication: '', dose: '',
  administered_at: nowDT(),
  notes: '',
}

export default function MedLogTab() {
  const { data, loadData } = useData()
  const { hasPerm } = usePermission()
  const canWitness = hasPerm('med.witness')
  const canDelete  = hasPerm('med.delete')
  const canUnlock  = hasPerm('records.unlock')

  const records = data?.med_log || []
  const clients = useMemo(() =>
    (data?.clients || [])
      .filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room)||0) - (parseInt(b.room)||0)),
    [data?.clients]
  )

  const [filterClient, setFilterClient] = useState('')
  const [modal, setModal] = useState(null) // null | 'add' | { record }
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [unlockModal, setUnlockModal] = useState(null)
  const [unlockReason, setUnlockReason] = useState('')

  const { globalSearch = '' } = useOutletContext() || {}

  const filtered = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    return records.filter(r => {
      if (filterClient && String(r.client_id) !== filterClient) return false
      if (q && !`${r.client_name} ${r.room} ${r.medication} ${r.dose} ${r.witnessed_by_name}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [records, filterClient, globalSearch])

  const today = new Date().toISOString().slice(0, 10)
  const todayCount  = records.filter(r => (r.administered_at || '').slice(0, 10) === today).length
  const lockedCount = records.filter(r => r.locked_at).length

  function openAdd() {
    setForm({ ...BLANK, administered_at: nowDT() })
    setErr(''); setModal('add')
  }
  function openEdit(r) {
    setForm({
      client_id: String(r.client_id), client_name: r.client_name, room: r.room,
      medication: r.medication || '', dose: r.dose || '',
      administered_at: (r.administered_at || '').slice(0, 16),
      notes: r.notes || '',
    })
    setErr(''); setModal({ record: r })
  }
  function handleClient(cid) {
    const c = clients.find(x => String(x.id) === String(cid))
    setForm(f => ({ ...f, client_id: cid, client_name: c?.name || '', room: c?.room || '' }))
  }

  async function save() {
    if (!form.client_id) { setErr('Resident required'); return }
    if (!form.medication.trim()) { setErr('Medication required'); return }
    if (!form.administered_at) { setErr('Administered time required'); return }
    setSaving(true); setErr('')
    try {
      const isEdit = modal && modal.record
      const url = isEdit ? `/api/med-log/${modal.record.id}` : '/api/med-log'
      const method = isEdit ? 'PATCH' : 'POST'
      const r = await fetch(url, {
        method, credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          client_id: parseInt(form.client_id),
          client_name: form.client_name, room: form.room,
          medication: form.medication.trim(), dose: form.dose.trim(),
          administered_at: form.administered_at,
          notes: form.notes,
        }),
      })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(j.error || 'Save failed'); return }
      setModal(null); setForm(BLANK); loadData()
    } catch { setErr('Network error') } finally { setSaving(false) }
  }

  async function del(r) {
    if (!window.confirm(`Delete med admin entry (${r.medication}) for ${r.client_name}?`)) return
    const res = await fetch(`/api/med-log/${r.id}`, { method:'DELETE', credentials:'include' })
    if (!res.ok) { const j = await res.json().catch(()=>({})); alert(j.error||'Delete failed'); return }
    loadData()
  }

  async function submitUnlock() {
    if (!unlockReason.trim()) { alert('Reason required'); return }
    const r = await fetch(`/api/med_administration_log/${unlockModal.id}/unlock`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ reason: unlockReason }),
    })
    const j = await r.json().catch(()=>({}))
    if (!r.ok) { alert(j.error || 'Unlock failed'); return }
    setUnlockModal(null); setUnlockReason(''); loadData()
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Health &amp; Compliance</BreadcrumbItem>
            <BreadcrumbItem>Med Log</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Med Log</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Witnessed self-administration — residents self-administer, staff witness; entries lock after 24 hours</p>
        </div>
        {canWitness && <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Log Dose</Button>}
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { label: 'Total Doses', value: records.length, sub: 'logged', Icon: Pill, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
          { label: 'Today', value: todayCount, sub: 'administered today', Icon: Clock, tint: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300' },
          { label: 'Locked', value: lockedCount, sub: 'past 24h window', Icon: Lock, tint: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
        ].map(k => (
          <div key={k.label} className="p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 sm:p-5 dark:bg-gray-800">
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

      {/* Resident filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Resident:</span>
        <Select sizing="sm" value={filterClient} onChange={e => setFilterClient(e.target.value)}>
          <option value="">All residents</option>
          {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
        </Select>
        <span className="ml-auto text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {filtered.length === 0
        ? <div className={`${CARD} text-sm text-center text-gray-400`}>No dose entries.</div>
        : (
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Time</TableHeadCell>
                <TableHeadCell>Resident</TableHeadCell>
                <TableHeadCell>Medication</TableHeadCell>
                <TableHeadCell>Dose</TableHeadCell>
                <TableHeadCell>Witness</TableHeadCell>
                <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y">
              {filtered.map(r => (
                <TableRow key={r.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                  <TableCell className="font-mono">{fmtDT(r.administered_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar placeholderInitials={initials(r.client_name)} rounded size="sm" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.client_name}</p>
                        <p className="font-mono text-xs text-gray-400">Rm {r.room}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{r.medication}</TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400">{r.dose || '—'}</TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400">{r.witnessed_by_name}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center justify-end gap-1">
                      {r.locked_at
                        ? (canUnlock
                            ? <Button size="xs" color="light" onClick={() => { setUnlockReason(''); setUnlockModal(r) }} title="Unlock"><Lock className="w-4 h-4" /></Button>
                            : <span title="Locked" className="p-1.5 text-gray-300"><Lock className="w-4 h-4" /></span>)
                        : <Button size="xs" color="light" onClick={() => openEdit(r)}>Edit</Button>
                      }
                      {canDelete && !r.locked_at && (
                        <Button size="xs" color="light" className="text-red-600" onClick={() => del(r)}>Delete</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

      {modal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth:520 }}>
            <div className="modal-head">
              <h2>{modal.record ? 'Edit Dose Entry' : 'Log Witnessed Dose'}</h2>
              <button className="xbtn" onClick={()=>setModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              {err && <div className="auth-error">{err}</div>}
              <div className="field">
                <label>Resident</label>
                <select value={form.client_id} onChange={e=>handleClient(e.target.value)} disabled={!!modal.record}>
                  <option value="">— select —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', gap:12 }}>
                <div className="field" style={{ flex:2 }}>
                  <label>Medication (name only — no clinical advice)</label>
                  <input value={form.medication} onChange={e=>setForm({...form, medication:e.target.value})}/>
                </div>
                <div className="field" style={{ flex:1 }}>
                  <label>Dose (as labeled)</label>
                  <input value={form.dose} onChange={e=>setForm({...form, dose:e.target.value})}/>
                </div>
              </div>
              <div className="field">
                <label>Administered at</label>
                <input type="datetime-local" value={form.administered_at}
                  onChange={e=>setForm({...form, administered_at:e.target.value})}/>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})}/>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {unlockModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setUnlockModal(null)}>
          <div className="modal" style={{ maxWidth:440 }}>
            <div className="modal-head"><h2>Unlock Dose Entry</h2></div>
            <div className="modal-body">
              <p style={{ fontSize:'.88em', color:'#475569' }}>
                Provide a reason — override is audit-logged.
              </p>
              <div className="field">
                <label>Reason</label>
                <textarea rows={3} value={unlockReason} onChange={e=>setUnlockReason(e.target.value)}/>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={()=>setUnlockModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitUnlock}>Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
