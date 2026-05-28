import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

function todayStr() { return new Date().toISOString().slice(0, 10) }
function nowTime()  { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

const SEVERITY_LABEL = { low:'Low', medium:'Medium', high:'High', critical:'Critical' }
const SEVERITY_COLOR = {
  low:      { bg:'#dbeafe', fg:'#1d4ed8' },
  medium:   { bg:'#fef3c7', fg:'#92400e' },
  high:     { bg:'#ffedd5', fg:'#9a3412' },
  critical: { bg:'#fee2e2', fg:'#991b1b' },
}
function SeverityBadge({ severity }) {
  const c = SEVERITY_COLOR[severity] || SEVERITY_COLOR.low
  return <span style={{
    background:c.bg, color:c.fg, padding:'2px 8px', borderRadius:6,
    fontSize:'.72em', fontWeight:700, textTransform:'uppercase', letterSpacing:'.04em',
  }}>{SEVERITY_LABEL[severity] || severity}</span>
}
function StatusBadge({ status }) {
  const cls = { open:'vbadge vbadge-pending', reviewed:'vbadge vbadge-assigned', closed:'vbadge vbadge-completed' }
  return <span className={cls[status] || 'vbadge'}>{status}</span>
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

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Behavioral Incident Reports</span></div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <select value={filterClient} onChange={e=>setFilterClient(e.target.value)}>
              <option value="">All residents</option>
              {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
            </select>
            <select value={filterSev} onChange={e=>setFilterSev(e.target.value)}>
              <option value="">All severities</option>
              {Object.entries(SEVERITY_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="reviewed">Reviewed</option>
              <option value="closed">Closed</option>
            </select>
            {canLog && <button className="btn btn-primary" onClick={openAdd}>+ New Report</button>}
          </div>
        </div>
        <div className="section-body">
          <div style={{ fontSize:'.78em', color:'#64748b', marginBottom:8 }}>
            Behavioral incidents are formal regulatory documents — distinct from program-rule violations.
            Severity drives mandatory notifications.
          </div>
          {filtered.length === 0
            ? <div style={{ color:'#94a3b8', padding:'16px 0' }}>No incident reports.</div>
            : (
              <table className="table">
                <thead><tr>
                  <th>Date</th><th>Resident</th><th>Severity</th><th>Narrative</th><th>Status</th><th>Reviewer</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.map(i => (
                    <tr key={i.id}>
                      <td>{fmtDate(i.incident_date)} {i.incident_time}</td>
                      <td>Rm {i.room} · {i.client_name}</td>
                      <td><SeverityBadge severity={i.severity}/></td>
                      <td style={{ maxWidth:340 }}>
                        <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {i.narrative}
                        </div>
                        {i.notifications_required?.length > 0 && (
                          <div style={{ fontSize:'.72em', color:'#64748b', marginTop:2 }}>
                            Notify: {i.notifications_required.join(', ')}
                          </div>
                        )}
                      </td>
                      <td><StatusBadge status={i.status}/></td>
                      <td style={{ fontSize:'.85em' }}>{i.supervisor_name || '—'}</td>
                      <td style={{ textAlign:'right', whiteSpace:'nowrap' }}>
                        {i.locked_at
                          ? (canUnlock ? <button className="btn btn-sm" onClick={()=>{setUnlockReason(''); setUnlockModal(i)}}>🔒</button> : <span>🔒</span>)
                          : (
                            <>
                              {canLog && <button className="btn btn-sm" onClick={()=>openEdit(i)}>Edit</button>}
                              {canReview && i.status !== 'closed' && (
                                <button className="btn btn-sm btn-primary" style={{ marginLeft:6 }}
                                  onClick={()=>{ setReviewNotes(i.review_notes||''); setReviewStatus(i.status==='open'?'reviewed':'closed'); setReviewModal(i) }}>
                                  {i.status === 'open' ? 'Review' : 'Close'}
                                </button>
                              )}
                              {canDelete && <button className="btn btn-sm btn-danger" style={{ marginLeft:6 }} onClick={()=>del(i)}>Delete</button>}
                            </>
                          )
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      </div>

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
