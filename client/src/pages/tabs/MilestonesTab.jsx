import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

function todayStr() { return new Date().toISOString().slice(0, 10) }
function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function StatusBadge({ status }) {
  const cls = {
    in_progress: 'vbadge vbadge-pending',
    completed:   'vbadge vbadge-completed',
    waived:      'vbadge vbadge-waived',
  }
  const labels = { in_progress: 'In Progress', completed: 'Completed', waived: 'Waived' }
  return <span className={cls[status] || 'vbadge vbadge-pending'}>{labels[status] || status}</span>
}

const BLANK = { client_id: '', client_name: '', phase: '', objective: '', target_date: '', notes: '' }

export default function MilestonesTab() {
  const { data, loadData } = useData()
  const { hasPerm } = usePermission()
  const canEdit    = hasPerm('milestones.edit')
  const canSignoff = hasPerm('milestones.signoff')
  const canUnlock  = hasPerm('records.unlock')

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

  const [unlockModal, setUnlockModal] = useState(null)
  const [unlockReason, setUnlockReason] = useState('')

  function openAdd(client) {
    setForm({
      ...BLANK,
      client_id:   client ? String(client.id) : '',
      client_name: client?.name || '',
      phase: phases[0]?.label || '',
    })
    setErr(''); setModal('add')
  }
  function openEdit(m) {
    setForm({
      client_id: String(m.client_id), client_name: m.client_name,
      phase: m.phase, objective: m.objective,
      target_date: m.target_date || '', notes: m.notes || '',
    })
    setErr(''); setModal({ record: m })
  }
  function handleClient(cid) {
    const c = clients.find(x => String(x.id) === String(cid))
    setForm(f => ({ ...f, client_id: cid, client_name: c?.name || '' }))
  }
  function pickPhase(label) {
    const p = phases.find(p => p.label === label)
    const objList = p?.objectives || []
    setForm(f => ({ ...f, phase: label, objective: f.objective || objList[0] || '' }))
  }

  async function save() {
    if (!form.client_id) { setErr('Resident required'); return }
    if (!form.objective.trim()) { setErr('Objective required'); return }
    setSaving(true); setErr('')
    try {
      const isEdit = modal && modal.record
      const url = isEdit ? `/api/milestones/${modal.record.id}` : '/api/milestones'
      const method = isEdit ? 'PUT' : 'POST'
      const r = await fetch(url, {
        method, credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          client_id: parseInt(form.client_id),
          client_name: form.client_name,
          phase: form.phase, objective: form.objective.trim(),
          target_date: form.target_date || null,
          notes: form.notes,
        }),
      })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(j.error || 'Save failed'); return }
      setModal(null); setForm(BLANK); loadData()
    } catch { setErr('Network error') } finally { setSaving(false) }
  }

  async function signoff(m) {
    if (!window.confirm(`Mark "${m.objective}" as completed for ${m.client_name}?`)) return
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
    if (!window.confirm('Delete milestone? This is audit-logged.')) return
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

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Program Milestones</span></div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <select value={view} onChange={e=>setView(e.target.value)}>
              <option value="by_client">By Resident</option>
              <option value="list">All (list)</option>
            </select>
            <select value={filterClient} onChange={e=>setFilterClient(e.target.value)}>
              <option value="">All residents</option>
              {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
            </select>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="waived">Waived</option>
            </select>
            {canEdit && <button className="btn btn-primary" onClick={()=>openAdd()}>+ Add Milestone</button>}
          </div>
        </div>
        <div className="section-body">
          {filtered.length === 0
            ? <div style={{ color:'#94a3b8', padding:'16px 0' }}>No milestones.</div>
            : view === 'list' ? (
              <table className="table">
                <thead><tr>
                  <th>Resident</th><th>Phase</th><th>Objective</th><th>Target</th><th>Status</th><th>Signed off by</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id}>
                      <td>{m.client_name}</td>
                      <td>{m.phase}</td>
                      <td>{m.objective}</td>
                      <td>{fmtDate(m.target_date)}</td>
                      <td><StatusBadge status={m.status}/></td>
                      <td style={{ fontSize:'.85em' }}>{m.counselor_name || '—'}</td>
                      <td style={{ textAlign:'right', whiteSpace:'nowrap' }}>
                        {m.locked_at
                          ? (canUnlock ? <button className="btn btn-sm" onClick={()=>{setUnlockReason(''); setUnlockModal(m)}}>🔒</button> : <span>🔒</span>)
                          : <>
                              {canEdit && <button className="btn btn-sm" onClick={()=>openEdit(m)}>Edit</button>}
                              {m.status === 'in_progress' && canSignoff && (
                                <button className="btn btn-sm btn-primary" style={{ marginLeft:6 }} onClick={()=>signoff(m)}>✓ Complete</button>
                              )}
                              {m.status === 'in_progress' && canEdit && (
                                <button className="btn btn-sm" style={{ marginLeft:6 }} onClick={()=>setStatus(m,'waived')}>Waive</button>
                              )}
                              {canEdit && <button className="btn btn-sm btn-danger" style={{ marginLeft:6 }} onClick={()=>del(m)}>Delete</button>}
                            </>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              grouped.map(g => (
                <div key={g.id} style={{ borderBottom:'1px solid var(--line)', padding:'10px 0' }}>
                  <div style={{ fontWeight:700, marginBottom:4 }}>{g.name}</div>
                  <ul style={{ margin:0, paddingLeft:18 }}>
                    {g.items.map(m => (
                      <li key={m.id} style={{ fontSize:'.9em', marginBottom:4 }}>
                        <strong>{m.phase}</strong> — {m.objective}{' '}
                        <StatusBadge status={m.status}/>{' '}
                        {m.target_date && <span style={{ color:'#64748b' }}>target {fmtDate(m.target_date)}</span>}{' '}
                        {!m.locked_at && m.status === 'in_progress' && canSignoff &&
                          <button className="btn btn-sm btn-primary" onClick={()=>signoff(m)}>✓ Complete</button>}
                        {!m.locked_at && canEdit &&
                          <button className="btn btn-sm" style={{ marginLeft:4 }} onClick={()=>openEdit(m)}>Edit</button>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )
          }
        </div>
      </div>

      {modal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth:520 }}>
            <div className="modal-head">
              <h2>{modal.record ? 'Edit Milestone' : 'New Milestone'}</h2>
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
              <div className="field">
                <label>Phase</label>
                <select value={form.phase} onChange={e=>pickPhase(e.target.value)}>
                  <option value="">— select —</option>
                  {phases.map(p => <option key={p.key} value={p.label}>{p.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Objective</label>
                {(() => {
                  const p = phases.find(p => p.label === form.phase)
                  const opts = p?.objectives || []
                  return opts.length > 0 ? (
                    <select value={form.objective} onChange={e=>setForm({...form, objective:e.target.value})}>
                      <option value="">— select —</option>
                      {opts.map(o => <option key={o} value={o}>{o}</option>)}
                      <option value="__custom__">Custom…</option>
                    </select>
                  ) : (
                    <input value={form.objective} onChange={e=>setForm({...form, objective:e.target.value})}/>
                  )
                })()}
                {form.objective === '__custom__' && (
                  <input style={{ marginTop:6 }} placeholder="Custom objective"
                    onChange={e=>setForm({...form, objective:e.target.value})}/>
                )}
              </div>
              <div className="field">
                <label>Target date</label>
                <input type="date" value={form.target_date} onChange={e=>setForm({...form, target_date:e.target.value})}/>
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
            <div className="modal-head"><h2>Unlock Milestone</h2></div>
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
