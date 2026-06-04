import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import {
  clinicalApi, fmtDate, activeClients, clientLabel, todayStr,
  StatusBadge, Chip, Modal, EmptyState, inp, lbl, field,
} from './clinicalShared.jsx'
import { Header, card, btnSm, btnSmGreen, btnSmRed } from './ClinicalNotes.jsx'

const api = clinicalApi('treatment-plans')
const STATUSES = ['active', 'completed', 'discontinued']

function emptyGoal() { return { goal: '', objectives: [''], interventions: [''] } }

export default function TreatmentPlans() {
  const { treatmentPlans, data, refresh } = useData()
  const clients = data?.clients || []
  const milestones = data?.milestones || []
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const list = treatmentPlans || []
    return filter === 'all' ? list : list.filter(p => p.client_id === parseInt(filter))
  }, [treatmentPlans, filter])

  async function finalise(id) {
    if (!window.confirm('Sign this treatment plan?')) return
    try { await api.sign(id); await refresh() } catch (e) { alert(e.message) }
  }
  async function remove(id) {
    if (!window.confirm('Delete this treatment plan? This cannot be undone.')) return
    try { await api.remove(id); await refresh() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <Header title="Treatment Plans" clients={clients} filter={filter} setFilter={setFilter} onNew={() => setEditing({})} />
      {rows.length === 0
        ? <EmptyState>No treatment plans{filter !== 'all' ? ' for this resident' : ''} yet.</EmptyState>
        : (
          <div style={{ display: 'grid', gap: 10 }}>
            {rows.map(p => {
              const goals = Array.isArray(p.goals) ? p.goals : []
              return (
                <div key={p.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.92rem', marginBottom: 3 }}>{clientLabel(clients, p.client_id)}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <StatusBadge status={p.status} />
                        <Chip bg="#e0f2fe" fg="#0369a1">{goals.length} goal{goals.length !== 1 ? 's' : ''}</Chip>
                        <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>Plan {fmtDate(p.plan_date)}</span>
                        {p.review_date && <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>· Review {fmtDate(p.review_date)}</span>}
                        {p.signed_at && <Chip bg="#dcfce7" fg="#15803d">🔒 Signed</Chip>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button style={btnSm} onClick={() => setEditing(p)}>Edit</button>
                      {!p.signed_at && <button style={btnSmGreen} onClick={() => finalise(p.id)}>Sign</button>}
                      <button style={btnSmRed} onClick={() => remove(p.id)}>Delete</button>
                    </div>
                  </div>
                  {p.presenting_problem && (
                    <div style={{ marginTop: 8, fontSize: '.82rem', color: '#334155', lineHeight: 1.5 }}>
                      <strong style={{ color: '#64748b' }}>Presenting problem: </strong>{p.presenting_problem}
                    </div>
                  )}
                  {goals.length > 0 && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '.82rem', color: '#334155' }}>
                      {goals.map((g, i) => {
                        const linked = milestones.filter(m => m.treatment_plan_id === p.id && g.id && m.goal_id === g.id)
                        const done = linked.filter(m => m.status === 'completed').length
                        return (
                          <li key={g.id || i} style={{ marginBottom: 3 }}>
                            {g.goal || <em style={{ color: '#cbd5e1' }}>(untitled goal)</em>}
                            {linked.length > 0 && (
                              <span style={{ marginLeft: 6 }}>
                                <Chip bg={done === linked.length ? '#dcfce7' : '#fef9c3'} fg={done === linked.length ? '#15803d' : '#854d0e'}>
                                  🏆 {done}/{linked.length} milestone{linked.length !== 1 ? 's' : ''}
                                </Chip>
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      {editing && (
        <PlanModal clients={clients} record={editing.id ? editing : null} busy={busy} setBusy={setBusy}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />
      )}
    </div>
  )
}

function PlanModal({ clients, record, onClose, onSaved, busy, setBusy }) {
  const isEdit = !!record
  const [clientId, setClientId] = useState(record?.client_id || '')
  const [planDate, setPlanDate] = useState(record?.plan_date || todayStr())
  const [targetDate, setTargetDate] = useState(record?.target_date || '')
  const [reviewDate, setReviewDate] = useState(record?.review_date || '')
  const [status, setStatus] = useState(record?.status || 'active')
  const [presenting, setPresenting] = useState(record?.presenting_problem || '')
  const [strengths, setStrengths] = useState(record?.strengths || '')
  const [barriers, setBarriers] = useState(record?.barriers || '')
  const [goals, setGoals] = useState(
    Array.isArray(record?.goals) && record.goals.length ? record.goals.map(g => ({
      id: g.id,   // preserve stable id so milestone links survive edits
      goal: g.goal || '', objectives: g.objectives?.length ? [...g.objectives] : [''], interventions: g.interventions?.length ? [...g.interventions] : [''],
    })) : [emptyGoal()]
  )
  const [err, setErr] = useState('')

  // goal mutators
  const setGoal = (gi, patch) => setGoals(gs => gs.map((g, i) => i === gi ? { ...g, ...patch } : g))
  const setListItem = (gi, key, li, val) => setGoal(gi, { [key]: goals[gi][key].map((v, i) => i === li ? val : v) })
  const addListItem = (gi, key) => setGoal(gi, { [key]: [...goals[gi][key], ''] })
  const removeListItem = (gi, key, li) => setGoal(gi, { [key]: goals[gi][key].filter((_, i) => i !== li) })

  function cleanGoals() {
    return goals
      .map(g => ({
        ...(g.id ? { id: g.id } : {}),   // keep existing id; server stamps new goals
        goal: g.goal.trim(),
        objectives: g.objectives.map(s => s.trim()).filter(Boolean),
        interventions: g.interventions.map(s => s.trim()).filter(Boolean),
      }))
      .filter(g => g.goal || g.objectives.length || g.interventions.length)
  }

  async function save() {
    if (!clientId) { setErr('Select a resident.'); return }
    setBusy(true); setErr('')
    try {
      const body = {
        client_id: parseInt(clientId), plan_date: planDate, target_date: targetDate || null,
        review_date: reviewDate || null, status, presenting_problem: presenting,
        strengths, barriers, goals: cleanGoals(),
      }
      if (isEdit) await api.update(record.id, body); else await api.create(body)
      await onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={isEdit ? 'Edit Treatment Plan' : 'New Treatment Plan'} onClose={onClose} maxWidth={680}
      footer={<>
        <button className="btn-cancel" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Plan'}</button>
      </>}>
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={field}>
        <label style={lbl}>Resident</label>
        <select style={inp} value={clientId} disabled={isEdit} onChange={e => setClientId(e.target.value)}>
          <option value="">Select resident…</option>
          {activeClients(clients).map(c => <option key={c.id} value={c.id}>{clientLabel(clients, c.id)}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...field, flex: 1, minWidth: 120 }}><label style={lbl}>Plan date</label><input style={inp} type="date" value={planDate} onChange={e => setPlanDate(e.target.value)} /></div>
        <div style={{ ...field, flex: 1, minWidth: 120 }}><label style={lbl}>Target date</label><input style={inp} type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} /></div>
        <div style={{ ...field, flex: 1, minWidth: 120 }}><label style={lbl}>Review date</label><input style={inp} type="date" value={reviewDate} onChange={e => setReviewDate(e.target.value)} /></div>
        <div style={{ ...field, flex: 1, minWidth: 120 }}><label style={lbl}>Status</label>
          <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div style={field}><label style={lbl}>Presenting problem</label><textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={presenting} onChange={e => setPresenting(e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...field, flex: 1 }}><label style={lbl}>Strengths</label><textarea style={{ ...inp, minHeight: 56, resize: 'vertical' }} value={strengths} onChange={e => setStrengths(e.target.value)} /></div>
        <div style={{ ...field, flex: 1 }}><label style={lbl}>Barriers</label><textarea style={{ ...inp, minHeight: 56, resize: 'vertical' }} value={barriers} onChange={e => setBarriers(e.target.value)} /></div>
      </div>

      <label style={lbl}>Goals</label>
      {goals.map((g, gi) => (
        <div key={gi} style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, padding: 12, marginBottom: 10, background: '#f8fafc' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input style={{ ...inp, fontWeight: 600 }} placeholder={`Goal ${gi + 1}`} value={g.goal} onChange={e => setGoal(gi, { goal: e.target.value })} />
            {goals.length > 1 && <button style={btnSmRed} onClick={() => setGoals(gs => gs.filter((_, i) => i !== gi))}>✕</button>}
          </div>
          <SubList label="Objectives" items={g.objectives} onChange={(li, v) => setListItem(gi, 'objectives', li, v)} onAdd={() => addListItem(gi, 'objectives')} onRemove={li => removeListItem(gi, 'objectives', li)} />
          <SubList label="Interventions" items={g.interventions} onChange={(li, v) => setListItem(gi, 'interventions', li, v)} onAdd={() => addListItem(gi, 'interventions')} onRemove={li => removeListItem(gi, 'interventions', li)} />
        </div>
      ))}
      <button style={{ ...btnSm, marginTop: 2 }} onClick={() => setGoals(gs => [...gs, emptyGoal()])}>+ Add Goal</button>
    </Modal>
  )
}

function SubList({ label, items, onChange, onAdd, onRemove }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      {items.map((v, li) => (
        <div key={li} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input style={{ ...inp, padding: '5px 8px', fontSize: '.8rem' }} value={v} onChange={e => onChange(li, e.target.value)} placeholder={`${label.slice(0, -1)} ${li + 1}`} />
          {items.length > 1 && <button style={{ ...btnSm, padding: '2px 8px' }} onClick={() => onRemove(li)}>✕</button>}
        </div>
      ))}
      <button style={{ ...btnSm, padding: '2px 10px', fontSize: '.72rem' }} onClick={onAdd}>+ {label.slice(0, -1)}</button>
    </div>
  )
}
