import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Pill, Clock, Lock, Plus } from 'lucide-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { CARD, Header, Kpi, KpiRow, Table, NameCell, MonoCell, MutedCell, TextCell, ActionsCell, rowCls } from '../../components/console.jsx'

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
      <Header
        crumb={['Health & Compliance', 'Med Log']}
        title="Med Log"
        sub="Witnessed self-administration — residents self-administer, staff witness; entries lock after 24 hours"
        actions={canWitness ? [
          { Icon: Plus, label: 'Log Dose', primary: true, onClick: openAdd },
        ] : []}
      />

      <KpiRow>
        <Kpi label="Total Doses" value={records.length} sub="logged" Icon={Pill} accent="primary" />
        <Kpi label="Today" value={todayCount} sub="administered today" Icon={Clock} accent="sky" />
        <Kpi label="Locked" value={lockedCount} sub="past 24h window" Icon={Lock} accent="gray" />
      </KpiRow>

      {/* Resident filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Resident:</span>
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
          className="px-2.5 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
          <option value="">All residents</option>
          {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {filtered.length === 0
        ? <div className={`${CARD} p-8 text-sm text-center text-gray-400`}>No dose entries.</div>
        : (
          <Table headers={[{ label: 'Time' }, { label: 'Resident' }, { label: 'Medication' }, { label: 'Dose' }, { label: 'Witness' }, { label: '', right: true }]}>
            {filtered.map((r, i) => (
              <tr key={r.id} className={rowCls(i)}>
                <MonoCell>{fmtDT(r.administered_at)}</MonoCell>
                <NameCell name={r.client_name} sub={`Rm ${r.room}`} />
                <TextCell>{r.medication}</TextCell>
                <MutedCell>{r.dose || '—'}</MutedCell>
                <MutedCell>{r.witnessed_by_name}</MutedCell>
                <ActionsCell>
                  <div className="inline-flex items-center justify-end gap-1">
                    {r.locked_at
                      ? (canUnlock
                          ? <button onClick={() => { setUnlockReason(''); setUnlockModal(r) }} title="Unlock" className="p-1.5 text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"><Lock className="w-4 h-4" /></button>
                          : <span title="Locked" className="p-1.5 text-gray-300"><Lock className="w-4 h-4" /></span>)
                      : <button onClick={() => openEdit(r)} className="px-3 py-1.5 text-xs font-medium text-gray-600 rounded-lg hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">Edit</button>
                    }
                    {canDelete && !r.locked_at && (
                      <button onClick={() => del(r)} className="px-3 py-1.5 text-xs font-medium text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30">Delete</button>
                    )}
                  </div>
                </ActionsCell>
              </tr>
            ))}
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
