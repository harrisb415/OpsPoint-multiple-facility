import { useState, useMemo, useEffect } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

function todayStr() { return new Date().toISOString().slice(0, 10) }
function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function StatusBadge({ row }) {
  if (row.revoked) return <span className="vbadge vbadge-waived">Revoked</span>
  if (row.expiration_date) {
    const exp = new Date(row.expiration_date + 'T23:59:59')
    if (exp < new Date()) return <span className="vbadge vbadge-waived">Expired</span>
  }
  return <span className="vbadge vbadge-completed">Active</span>
}

const BLANK = {
  recipient_name: '', recipient_org: '',
  purpose: '', information_type: 'all',
  effective_date: todayStr(),
  expiration_date: '',
  signature_on_file: true,
}

const INFO_TYPES = [
  { value:'all',                 label:'All records' },
  { value:'ua_records',          label:'UA records only' },
  { value:'incidents',           label:'Behavioral incidents only' },
  { value:'milestones',          label:'Milestones only' },
  { value:'med_administration_log', label:'Med admin log only' },
  { value:'discharge_records',   label:'Discharge record only' },
]

export default function ConsentTab() {
  const { data } = useData()
  const { hasPerm } = usePermission()
  const canManage   = hasPerm('consent.manage')
  const canViewDisc = hasPerm('disclosures.view')

  const clients = useMemo(() =>
    (data?.clients || [])
      .filter(c => !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room)||0) - (parseInt(b.room)||0)),
    [data?.clients]
  )

  const [selectedClient, setSelectedClient] = useState('')
  const [consents, setConsents] = useState([])
  const [disclosures, setDisclosures] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [modalErr, setModalErr] = useState('')

  async function loadConsents(cid) {
    if (!cid) { setConsents([]); setDisclosures([]); return }
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/consent-records/${cid}`, { credentials:'include' })
      if (!r.ok) throw new Error()
      setConsents(await r.json())
      if (canViewDisc) {
        const d = await fetch(`/api/disclosures/${cid}`, { credentials:'include' })
        if (d.ok) setDisclosures(await d.json())
        else setDisclosures([])
      }
    } catch { setErr('Failed to load consents') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (selectedClient) loadConsents(selectedClient) }, [selectedClient])

  async function save() {
    if (!selectedClient) { setModalErr('Select a resident first'); return }
    if (!form.recipient_name.trim()) { setModalErr('Recipient name required'); return }
    if (!form.purpose.trim()) { setModalErr('Purpose required'); return }
    setSaving(true); setModalErr('')
    try {
      const r = await fetch('/api/consent-records', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          client_id: parseInt(selectedClient),
          recipient_name: form.recipient_name.trim(),
          recipient_org:  form.recipient_org.trim(),
          purpose:        form.purpose.trim(),
          information_type: form.information_type,
          effective_date: form.effective_date,
          expiration_date: form.expiration_date || null,
          signature_on_file: form.signature_on_file ? 1 : 0,
        }),
      })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setModalErr(j.error || 'Save failed'); return }
      setModal(false); setForm(BLANK)
      loadConsents(selectedClient)
    } catch { setModalErr('Network error') } finally { setSaving(false) }
  }

  async function revoke(c) {
    if (!window.confirm(`Revoke consent to ${c.recipient_name}? This cannot be undone.`)) return
    const r = await fetch(`/api/consent-records/${c.id}/revoke`, { method:'PUT', credentials:'include' })
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error||'Revoke failed'); return }
    loadConsents(selectedClient)
  }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>42 CFR Part 2 — Consent &amp; Disclosures</span></div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <select value={selectedClient} onChange={e=>setSelectedClient(e.target.value)}>
              <option value="">— select resident —</option>
              {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
            </select>
            {canManage && selectedClient && (
              <button className="btn btn-primary" onClick={()=>{ setForm(BLANK); setModalErr(''); setModal(true) }}>
                + New Consent
              </button>
            )}
          </div>
        </div>
        <div className="section-body">
          {!selectedClient ? (
            <div style={{ color:'#94a3b8', padding:'16px 0' }}>
              Select a resident to view their consent records and disclosure history.
            </div>
          ) : loading ? (
            <div>Loading…</div>
          ) : err ? (
            <div className="auth-error">{err}</div>
          ) : (
            <>
              <h3 style={{ fontSize:'.92em', margin:'4px 0 8px' }}>Active &amp; historical consents</h3>
              {consents.length === 0
                ? <div style={{ color:'#94a3b8' }}>No consent records on file.</div>
                : (
                  <table className="table">
                    <thead><tr>
                      <th>Recipient</th><th>Purpose</th><th>Scope</th><th>Effective</th><th>Expires</th><th>Status</th><th></th>
                    </tr></thead>
                    <tbody>
                      {consents.map(c => (
                        <tr key={c.id}>
                          <td>
                            <strong>{c.recipient_name}</strong>
                            {c.recipient_org && <div style={{ fontSize:'.75em', color:'#64748b' }}>{c.recipient_org}</div>}
                          </td>
                          <td style={{ fontSize:'.85em' }}>{c.purpose}</td>
                          <td style={{ fontSize:'.85em' }}>{c.information_type}</td>
                          <td>{fmtDate(c.effective_date)}</td>
                          <td>{c.expiration_date ? fmtDate(c.expiration_date) : '—'}</td>
                          <td><StatusBadge row={c}/></td>
                          <td style={{ textAlign:'right' }}>
                            {!c.revoked && canManage && (
                              <button className="btn btn-sm btn-danger" onClick={()=>revoke(c)}>Revoke</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }

              {canViewDisc && (
                <>
                  <h3 style={{ fontSize:'.92em', margin:'20px 0 8px' }}>Disclosure history</h3>
                  {disclosures.length === 0
                    ? <div style={{ color:'#94a3b8' }}>No external disclosures logged.</div>
                    : (
                      <table className="table">
                        <thead><tr>
                          <th>When</th><th>Recipient</th><th>Scope</th><th>Method</th><th>By</th><th>Consent</th>
                        </tr></thead>
                        <tbody>
                          {disclosures.map(d => (
                            <tr key={d.id}>
                              <td>{fmtDate((d.disclosed_at||'').slice(0,10))} {(d.disclosed_at||'').slice(11,16)}</td>
                              <td>{d.recipient}</td>
                              <td style={{ fontSize:'.85em' }}>{d.information_type}</td>
                              <td>{d.method || '—'}</td>
                              <td style={{ fontSize:'.85em' }}>{d.disclosed_by_name}</td>
                              <td>{d.consent_id ? '✓ #' + d.consent_id : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  }
                </>
              )}
            </>
          )}
        </div>
      </div>

      {modal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal" style={{ maxWidth:560 }}>
            <div className="modal-head">
              <h2>New Consent — {clients.find(c=>String(c.id)===selectedClient)?.name || ''}</h2>
              <button className="xbtn" onClick={()=>setModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {modalErr && <div className="auth-error">{modalErr}</div>}
              <p style={{ fontSize:'.8em', color:'#64748b', marginBottom:10 }}>
                Per 42 CFR Part 2 §2.31, consent must specify the recipient, purpose,
                information scope, effective date, expiration, and the patient's right to revoke.
              </p>
              <div style={{ display:'flex', gap:12 }}>
                <div className="field" style={{ flex:1 }}>
                  <label>Recipient name</label>
                  <input value={form.recipient_name} onChange={e=>setForm({...form, recipient_name:e.target.value})}/>
                </div>
                <div className="field" style={{ flex:1 }}>
                  <label>Recipient organization</label>
                  <input value={form.recipient_org} onChange={e=>setForm({...form, recipient_org:e.target.value})}/>
                </div>
              </div>
              <div className="field">
                <label>Purpose of disclosure</label>
                <textarea rows={2} value={form.purpose} onChange={e=>setForm({...form, purpose:e.target.value})}/>
              </div>
              <div className="field">
                <label>Information scope</label>
                <select value={form.information_type} onChange={e=>setForm({...form, information_type:e.target.value})}>
                  {INFO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', gap:12 }}>
                <div className="field" style={{ flex:1 }}>
                  <label>Effective date</label>
                  <input type="date" value={form.effective_date} onChange={e=>setForm({...form, effective_date:e.target.value})}/>
                </div>
                <div className="field" style={{ flex:1 }}>
                  <label>Expiration date (blank = none)</label>
                  <input type="date" value={form.expiration_date} onChange={e=>setForm({...form, expiration_date:e.target.value})}/>
                </div>
              </div>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:'.85em', marginTop:6 }}>
                <input type="checkbox" checked={!!form.signature_on_file}
                  onChange={e=>setForm({...form, signature_on_file:e.target.checked})}/>
                Patient signature is on file (paper form scanned to records)
              </label>
              <p style={{ fontSize:'.75em', color:'#64748b', marginTop:10 }}>
                The patient retains the right to revoke this consent at any time. Once revoked,
                this record will be marked revoked and the consent gate will block further disclosures.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={()=>setModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save Consent'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
