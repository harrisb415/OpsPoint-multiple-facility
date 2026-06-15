import { useState, useMemo } from 'react'
import { Plus, Lock } from 'lucide-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { CARD, Header, Badge, Table, NameCell, MonoCell, MutedCell, BadgeCell, ActionsCell, rowCls } from '../../components/console.jsx'

const SEV_TONE = { low: 'blue', medium: 'yellow', high: 'orange', critical: 'red' }
const STATUS_TONE = { open: 'yellow', reviewed: 'blue', closed: 'green' }

function todayStr() { return new Date().toISOString().slice(0, 10) }
function nowTime()  { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

const SEVERITY_LABEL = { low:'Low', medium:'Medium', high:'High', critical:'Critical' }
function SeverityBadge({ severity }) {
  return <Badge tone={SEV_TONE[severity] || 'gray'}>{SEVERITY_LABEL[severity] || severity}</Badge>
}
function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONE[status] || 'gray'}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>
}

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
    if (!window.confirm('Delete incident report? This is audit-logged.')) return
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

  const actionBtn = 'px-2.5 py-1 text-xs font-medium rounded-lg'

  return (
    <div>
      <Header
        crumb={['Clinical', 'Incident Reports']}
        title="Incident Reports"
        sub="Behavioral incidents are formal regulatory documents — distinct from program-rule infractions; severity drives mandatory notifications"
        actions={canLog ? [{ Icon: Plus, label: 'New Report', primary: true, onClick: openAdd }] : []}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filterClient} onChange={e=>setFilterClient(e.target.value)} className="px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
          <option value="">All residents</option>
          {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
        </select>
        <select value={filterSev} onChange={e=>setFilterSev(e.target.value)} className="px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
          <option value="">All severities</option>
          {Object.entries(SEVERITY_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="reviewed">Reviewed</option>
          <option value="closed">Closed</option>
        </select>
        <span className="ml-auto text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {filtered.length === 0
        ? <div className={`${CARD} p-8 text-sm text-center text-gray-400`}>No incident reports.</div>
        : (
          <Table headers={[{ label: 'Date' }, { label: 'Resident' }, { label: 'Severity' }, { label: 'Narrative' }, { label: 'Status' }, { label: 'Reviewer' }, { label: '', right: true }]}>
            {filtered.map((i, idx) => (
              <tr key={i.id} className={rowCls(idx)}>
                <MonoCell>{fmtDate(i.incident_date)} {i.incident_time}</MonoCell>
                <NameCell name={i.client_name} sub={`Rm ${i.room}`} />
                <BadgeCell tone={SEV_TONE[i.severity] || 'gray'} label={SEVERITY_LABEL[i.severity] || i.severity} />
                <td className="p-3 text-sm text-gray-500 dark:text-gray-400" style={{ maxWidth: 340 }}>
                  <div className="overflow-hidden whitespace-nowrap text-ellipsis">{i.narrative}</div>
                  {i.notifications_required?.length > 0 && (
                    <div className="mt-1 text-xs text-gray-400">Notify: {i.notifications_required.join(', ')}</div>
                  )}
                </td>
                <BadgeCell tone={STATUS_TONE[i.status] || 'gray'} label={i.status.charAt(0).toUpperCase() + i.status.slice(1)} />
                <MutedCell>{i.supervisor_name || '—'}</MutedCell>
                <ActionsCell>
                  <div className="inline-flex items-center justify-end gap-1">
                    {i.locked_at
                      ? (canUnlock
                          ? <button onClick={()=>{setUnlockReason(''); setUnlockModal(i)}} title="Unlock" className="p-1.5 text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"><Lock className="w-4 h-4" /></button>
                          : <span title="Locked" className="p-1.5 text-gray-300"><Lock className="w-4 h-4" /></span>)
                      : <>
                          {canLog && <button onClick={()=>openEdit(i)} className={`${actionBtn} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700`}>Edit</button>}
                          {canReview && i.status !== 'closed' && (
                            <button onClick={()=>{ setReviewNotes(i.review_notes||''); setReviewStatus(i.status==='open'?'reviewed':'closed'); setReviewModal(i) }} className={`${actionBtn} text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/30`}>
                              {i.status === 'open' ? 'Review' : 'Close'}
                            </button>
                          )}
                          {canDelete && <button onClick={()=>del(i)} className={`${actionBtn} text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30`}>Delete</button>}
                        </>
                    }
                  </div>
                </ActionsCell>
              </tr>
            ))}
          </Table>
        )
      }

      {modal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth:620 }}>
            <div className="modal-head">
              <h2>{modal.record ? 'Edit Incident Report' : 'New Incident Report'}</h2>
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
                <div className="field" style={{ flex:1 }}>
                  <label>Date</label>
                  <input type="date" value={form.incident_date} onChange={e=>setForm({...form, incident_date:e.target.value})}/>
                </div>
                <div className="field" style={{ flex:1 }}>
                  <label>Time</label>
                  <input type="time" value={form.incident_time} onChange={e=>setForm({...form, incident_time:e.target.value})}/>
                </div>
                <div className="field" style={{ flex:1 }}>
                  <label>Severity</label>
                  <select value={form.severity} onChange={e=>pickSeverity(e.target.value)}>
                    {Object.entries(SEVERITY_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Narrative — observed behavior and immediate response</label>
                <textarea rows={4} value={form.narrative} onChange={e=>setForm({...form, narrative:e.target.value})}/>
              </div>
              <div className="field">
                <label>Corrective action</label>
                <textarea rows={2} value={form.corrective_action} onChange={e=>setForm({...form, corrective_action:e.target.value})}/>
              </div>
              <div className="field">
                <label>Required notifications</label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {['supervisor','case_manager','licensing','guardian','doh','insurance','law_enforcement'].map(key => {
                    const minReq = (policy[form.severity]||[]).includes(key)
                    const on = (form.notifications_required||[]).includes(key) || minReq
                    return (
                      <button key={key} type="button"
                        onClick={()=>toggleNotif(key)}
                        disabled={minReq}
                        title={minReq ? 'Required at this severity' : ''}
                        style={{
                          padding:'4px 10px', borderRadius:6, border:'1px solid var(--line)',
                          background: on ? 'var(--crimson)' : 'transparent',
                          color: on ? '#fff' : 'var(--steel)',
                          fontSize:'.78em', fontWeight:700, cursor: minReq ? 'not-allowed' : 'pointer',
                          opacity: minReq ? 0.85 : 1,
                        }}>
                        {key.replace(/_/g,' ')}{minReq && ' *'}
                      </button>
                    )
                  })}
                </div>
                <div style={{ fontSize:'.7em', color:'#64748b', marginTop:4 }}>
                  Asterisk = required at the selected severity (cannot be unset).
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {reviewModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setReviewModal(null)}>
          <div className="modal" style={{ maxWidth:480 }}>
            <div className="modal-head"><h2>Supervisor Review</h2></div>
            <div className="modal-body">
              <div style={{ fontSize:'.85em', marginBottom:8 }}>
                <strong>{reviewModal.client_name}</strong> — {fmtDate(reviewModal.incident_date)}
              </div>
              <div className="field">
                <label>Review notes</label>
                <textarea rows={4} value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)}/>
              </div>
              <div className="field">
                <label>New status</label>
                <select value={reviewStatus} onChange={e=>setReviewStatus(e.target.value)}>
                  <option value="reviewed">Reviewed (open follow-up)</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={()=>setReviewModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitReview}>Submit Review</button>
            </div>
          </div>
        </div>
      )}

      {unlockModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setUnlockModal(null)}>
          <div className="modal" style={{ maxWidth:440 }}>
            <div className="modal-head"><h2>Unlock Incident Report</h2></div>
            <div className="modal-body">
              <div className="field">
                <label>Reason (audit-logged)</label>
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
