import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

function nowDT() { return new Date().toISOString().slice(0, 16) }

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

  const filtered = useMemo(() => {
    return records.filter(r => !filterClient || String(r.client_id) === filterClient)
  }, [records, filterClient])

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
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Witnessed Self-Administration Log</span></div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <select value={filterClient} onChange={e=>setFilterClient(e.target.value)}>
              <option value="">All residents</option>
              {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
            </select>
            {canWitness && <button className="btn btn-primary" onClick={openAdd}>+ Log Dose</button>}
          </div>
        </div>
        <div className="section-body">
          <div style={{ fontSize:'.78em', color:'#64748b', marginBottom:8 }}>
            Residents self-administer; staff witness and document. Entries lock after 24 hours.
          </div>
          {filtered.length === 0
            ? <div style={{ color:'#94a3b8', padding:'16px 0' }}>No dose entries.</div>
            : (
              <table className="table">
                <thead><tr>
                  <th>Time</th><th>Resident</th><th>Medication</th><th>Dose</th><th>Witness</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id}>
                      <td>{fmtDT(r.administered_at)}</td>
                      <td>Rm {r.room} · {r.client_name}</td>
                      <td>{r.medication}</td>
                      <td>{r.dose || '—'}</td>
                      <td style={{ fontSize:'.85em', color:'#475569' }}>{r.witnessed_by_name}</td>
                      <td style={{ textAlign:'right', whiteSpace:'nowrap' }}>
                        {r.locked_at
                          ? (canUnlock
                              ? <button className="btn btn-sm" onClick={()=>{ setUnlockReason(''); setUnlockModal(r) }}>🔒</button>
                              : <span title="Locked">🔒</span>)
                          : <button className="btn btn-sm" onClick={()=>openEdit(r)}>Edit</button>
                        }
                        {canDelete && !r.locked_at && (
                          <button className="btn btn-sm btn-danger" onClick={()=>del(r)} style={{ marginLeft:6 }}>Delete</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>

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
