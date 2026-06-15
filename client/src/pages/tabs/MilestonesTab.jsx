import { useState, useMemo } from 'react'
import { Award, Plus, Lock } from 'lucide-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { CARD, Header, Badge, Table, NameCell, MutedCell, MonoCell, BadgeCell, ActionsCell, rowCls } from '../../components/console.jsx'

const MS_TONE  = { in_progress: 'yellow', completed: 'green', waived: 'gray' }
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

function StatusBadge({ status }) {
  return <Badge tone={MS_TONE[status] || 'gray'}>{MS_LABEL[status] || status}</Badge>
}

const BLANK = { client_id: '', client_name: '', phase: '', objective: '', target_date: '', notes: '', goal_ref: '' }

export default function MilestonesTab() {
  const { data, loadData, treatmentPlans } = useData()
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

  const actionBtn = 'px-2.5 py-1 text-xs font-medium rounded-lg'

  return (
    <div>
      <Header
        crumb={['Clinical', 'Milestones']}
        title="Milestones"
        sub="Program milestones and phase objectives"
        actions={canEdit ? [{ Icon: Plus, label: 'Add Milestone', primary: true, onClick: () => openAdd() }] : []}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={view} onChange={e=>setView(e.target.value)} className="px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
          <option value="by_client">By Resident</option>
          <option value="list">All (list)</option>
        </select>
        <select value={filterClient} onChange={e=>setFilterClient(e.target.value)} className="px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
          <option value="">All residents</option>
          {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
          <option value="">All statuses</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="waived">Waived</option>
        </select>
        <span className="ml-auto text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {filtered.length === 0
        ? <div className={`${CARD} p-8 text-sm text-center text-gray-400`}>No milestones.</div>
        : view === 'list' ? (
          <Table headers={[{ label: 'Resident' }, { label: 'Phase' }, { label: 'Objective' }, { label: 'Target' }, { label: 'Completed' }, { label: 'Status' }, { label: 'Signed Off By' }, { label: 'Logged' }, { label: '', right: true }]}>
            {filtered.map((m, i) => (
              <tr key={m.id} className={rowCls(i)}>
                <NameCell name={m.client_name} />
                <MutedCell>{m.phase}</MutedCell>
                <MutedCell>{m.objective}</MutedCell>
                <MonoCell>{fmtDate(m.target_date)}</MonoCell>
                <MonoCell>{m.status === 'completed' ? fmtDate(completedOn(m)) : '—'}</MonoCell>
                <BadgeCell tone={MS_TONE[m.status] || 'gray'} label={MS_LABEL[m.status] || m.status} />
                <MutedCell>{m.counselor_name || '—'}</MutedCell>
                <MonoCell>{fmtLogged(m.created_at)}</MonoCell>
                <ActionsCell>
                  <div className="inline-flex items-center justify-end gap-1">
                    {m.locked_at
                      ? (canUnlock
                          ? <button onClick={()=>{setUnlockReason(''); setUnlockModal(m)}} title="Unlock" className="p-1.5 text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"><Lock className="w-4 h-4" /></button>
                          : <span title="Locked" className="p-1.5 text-gray-300"><Lock className="w-4 h-4" /></span>)
                      : <>
                          {canEdit && <button onClick={()=>openEdit(m)} className={`${actionBtn} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700`}>Edit</button>}
                          {m.status === 'in_progress' && canSignoff && <button onClick={()=>signoff(m)} className={`${actionBtn} text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30`}>✓ Complete</button>}
                          {m.status === 'in_progress' && canEdit && <button onClick={()=>setStatus(m,'waived')} className={`${actionBtn} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700`}>Waive</button>}
                          {canEdit && <button onClick={()=>del(m)} className={`${actionBtn} text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30`}>Delete</button>}
                        </>
                    }
                  </div>
                </ActionsCell>
              </tr>
            ))}
          </Table>
        ) : (
          <div className={CARD} style={{ padding: 0, overflow: 'hidden' }}>
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
                  if (opts.length === 0) {
                    return <input value={form.objective} onChange={e=>setForm({...form, objective:e.target.value})}/>
                  }
                  return (
                    <>
                      <select
                        value={customObj ? '__custom__' : form.objective}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '__custom__') { setCustomObj(true); setForm(f => ({ ...f, objective: '' })) }
                          else { setCustomObj(false); setForm(f => ({ ...f, objective: v })) }
                        }}>
                        <option value="">— select —</option>
                        {opts.map(o => <option key={o} value={o}>{o}</option>)}
                        <option value="__custom__">Custom…</option>
                      </select>
                      {customObj && (
                        <input autoFocus style={{ marginTop:6 }} placeholder="Custom objective"
                          value={form.objective}
                          onChange={e=>setForm(f => ({ ...f, objective: e.target.value }))}/>
                      )}
                    </>
                  )
                })()}
              </div>
              <div className="field">
                <label>Target date</label>
                <input type="date" value={form.target_date} onChange={e=>setForm({...form, target_date:e.target.value})}/>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})}/>
              </div>
              <div className="field">
                <label>Advances treatment-plan goal <span style={{ fontWeight:400, color:'#94a3b8' }}>(optional)</span></label>
                {(() => {
                  if (!form.client_id) return <div style={{ fontSize:'.8rem', color:'#94a3b8' }}>Select a resident first.</div>
                  const plans = (treatmentPlans || []).filter(p => String(p.client_id) === String(form.client_id))
                  const opts = []
                  plans.forEach(p => (Array.isArray(p.goals) ? p.goals : []).forEach(g => { if (g && g.id) opts.push({ v: `${p.id}::${g.id}`, l: g.goal || '(untitled goal)' }) }))
                  if (opts.length === 0) return <div style={{ fontSize:'.8rem', color:'#94a3b8' }}>No treatment-plan goals for this resident yet.</div>
                  return (
                    <select value={form.goal_ref} onChange={e=>setForm({...form, goal_ref:e.target.value})}>
                      <option value="">— none —</option>
                      {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  )
                })()}
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
