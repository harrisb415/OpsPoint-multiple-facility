import { useState, useMemo, useEffect } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { ShieldCheck, FileCheck, Share2, Plus } from 'lucide-react'
import { CARD, Header, Kpi, KpiRow, Table, NameCell, MonoCell, MutedCell, TextCell, BadgeCell, ActionsCell, rowCls } from '../../components/console.jsx'

function todayStr() { return new Date().toISOString().slice(0, 10) }
function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function consentStatus(row) {
  if (row.revoked) return { key: 'revoked', tone: 'gray', label: 'Revoked' }
  if (row.expiration_date) {
    const exp = new Date(row.expiration_date + 'T23:59:59')
    if (exp < new Date()) return { key: 'expired', tone: 'gray', label: 'Expired' }
  }
  return { key: 'active', tone: 'green', label: 'Active' }
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
const INFO_LABEL = Object.fromEntries(INFO_TYPES.map(t => [t.value, t.label]))

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

  const activeCount = consents.filter(c => consentStatus(c).key === 'active').length
  const inactiveCount = consents.length - activeCount

  return (
    <div>
      <Header
        crumb={['Records', 'Consents']}
        title="Consents"
        sub="42 CFR Part 2 — consent &amp; disclosure tracking"
        actions={canManage && selectedClient ? [
          { Icon: Plus, label: 'New Consent', primary: true, onClick: () => { setForm(BLANK); setModalErr(''); setModal(true) } },
        ] : []}
      />

      {/* Resident selector */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Resident:</span>
        <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)}
          className="px-2.5 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
          <option value="">— select resident —</option>
          {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
        </select>
      </div>

      {!selectedClient ? (
        <div className={`${CARD} p-8 text-sm text-center text-gray-400`}>
          Select a resident to view their consent records and disclosure history.
        </div>
      ) : loading ? (
        <div className={`${CARD} p-8 text-sm text-center text-gray-400`}>Loading…</div>
      ) : err ? (
        <div className={`${CARD} p-8 text-sm text-center text-red-600`}>{err}</div>
      ) : (
        <>
          <KpiRow>
            <Kpi label="Active Consents" value={activeCount} sub="currently in force" Icon={ShieldCheck} accent="green" />
            <Kpi label="Revoked / Expired" value={inactiveCount} sub="no longer valid" Icon={FileCheck} accent="primary" />
            {canViewDisc && <Kpi label="Disclosures" value={disclosures.length} sub="external releases logged" Icon={Share2} accent="sky" />}
          </KpiRow>

          <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">Active &amp; historical consents</h3>
          {consents.length === 0
            ? <div className={`${CARD} p-8 text-sm text-center text-gray-400`}>No consent records on file.</div>
            : (
              <Table headers={[{ label: 'Recipient' }, { label: 'Purpose' }, { label: 'Scope' }, { label: 'Effective' }, { label: 'Expires' }, { label: 'Status' }, { label: '', right: true }]}>
                {consents.map((c, i) => {
                  const st = consentStatus(c)
                  return (
                    <tr key={c.id} className={rowCls(i)}>
                      <NameCell name={c.recipient_name} sub={c.recipient_org || ''} square />
                      <MutedCell>{c.purpose}</MutedCell>
                      <MutedCell>{INFO_LABEL[c.information_type] || c.information_type}</MutedCell>
                      <MonoCell>{fmtDate(c.effective_date)}</MonoCell>
                      <MonoCell>{c.expiration_date ? fmtDate(c.expiration_date) : '—'}</MonoCell>
                      <BadgeCell tone={st.tone} label={st.label} />
                      <ActionsCell>
                        {!c.revoked && canManage
                          ? <button onClick={() => revoke(c)} className="px-3 py-1.5 text-xs font-medium text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30">Revoke</button>
                          : <span className="text-xs text-gray-300">—</span>}
                      </ActionsCell>
                    </tr>
                  )
                })}
              </Table>
            )
          }

          {canViewDisc && (
            <>
              <h3 className="mt-6 mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">Disclosure history</h3>
              {disclosures.length === 0
                ? <div className={`${CARD} p-8 text-sm text-center text-gray-400`}>No external disclosures logged.</div>
                : (
                  <Table headers={[{ label: 'When' }, { label: 'Recipient' }, { label: 'Scope' }, { label: 'Method' }, { label: 'By' }, { label: 'Consent' }]}>
                    {disclosures.map((d, i) => (
                      <tr key={d.id} className={rowCls(i)}>
                        <MonoCell>{fmtDate((d.disclosed_at||'').slice(0,10))} {(d.disclosed_at||'').slice(11,16)}</MonoCell>
                        <TextCell>{d.recipient}</TextCell>
                        <MutedCell>{INFO_LABEL[d.information_type] || d.information_type}</MutedCell>
                        <MutedCell>{d.method || '—'}</MutedCell>
                        <MutedCell>{d.disclosed_by_name}</MutedCell>
                        <MonoCell>{d.consent_id ? '✓ #' + d.consent_id : '—'}</MonoCell>
                      </tr>
                    ))}
                  </Table>
                )
              }
            </>
          )}
        </>
      )}

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
