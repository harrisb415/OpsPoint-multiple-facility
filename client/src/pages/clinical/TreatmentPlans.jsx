import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import {
  clinicalApi, fmtDate, activeClients, clientLabel, todayStr,
  StatusBadge, Chip, Modal, EmptyState, inp, lbl, field,
} from './clinicalShared.jsx'
import { Header, card, btnSm, btnSmGreen, btnSmRed } from './ClinicalNotes.jsx'
import { useConfirm } from '../../components/ui.jsx'

const api = clinicalApi('treatment-plans')
const STATUSES = ['active', 'completed', 'discontinued']

function emptyGoal() { return { goal: '', objectives: [''], interventions: [''] } }

export default function TreatmentPlans() {
  const { treatmentPlans, data, refresh } = useData()
  const confirm = useConfirm()
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
    if (!await confirm({ title: 'Sign this treatment plan?', confirmText: 'Sign' })) return
    try { await api.sign(id); await refresh() } catch (e) { alert(e.message) }
  }
  async function remove(id) {
    if (!await confirm({ title: 'Delete this treatment plan?', body: 'This cannot be undone.', confirmText: 'Delete', color: 'red' })) return
    try { await api.remove(id); await refresh() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <Header title="Treatment Plans" clients={clients} filter={filter} setFilter={setFilter} onNew={() => setEditing({})} />
      {rows.length === 0
        ? <EmptyState>No treatment plans{filter !== 'all' ? ' for this resident' : ''} yet.</EmptyState>
        : (
          <div className="grid gap-2.5">
            {rows.map(p => {
              const goals = Array.isArray(p.goals) ? p.goals : []
              return (
                <div key={p.id} className={card}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-[.92rem] mb-0.5 text-gray-900 dark:text-white">{clientLabel(clients, p.client_id)}</div>
                      <div className="flex gap-1.5 items-center flex-wrap">
                        <StatusBadge status={p.status} />
                        <Chip className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{goals.length} goal{goals.length !== 1 ? 's' : ''}</Chip>
                        <span className="text-xs text-gray-400 dark:text-gray-500">Plan {fmtDate(p.plan_date)}</span>
                        {p.review_date && <span className="text-xs text-gray-400 dark:text-gray-500">· Review {fmtDate(p.review_date)}</span>}
                        {p.signed_at && <Chip className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Signed</Chip>}
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button className={btnSm} onClick={() => setEditing(p)}>Edit</button>
                      {!p.signed_at && <button className={btnSmGreen} onClick={() => finalise(p.id)}>Sign</button>}
                      <button className={btnSmRed} onClick={() => remove(p.id)}>Delete</button>
                    </div>
                  </div>
                  {p.presenting_problem && (
                    <div className="mt-2 text-[.82rem] text-gray-800 dark:text-gray-200 leading-relaxed">
                      <strong className="text-gray-500 dark:text-gray-400">Presenting problem: </strong>{p.presenting_problem}
                    </div>
                  )}
                  {goals.length > 0 && (
                    <ul className="mt-2 pl-4 text-[.82rem] text-gray-800 dark:text-gray-200 space-y-0.5">
                      {goals.map((g, i) => {
                        const linked = milestones.filter(m => m.treatment_plan_id === p.id && g.id && m.goal_id === g.id)
                        const done = linked.filter(m => m.status === 'completed').length
                        return (
                          <li key={g.id || i}>
                            {g.goal || <em className="text-gray-400">(untitled goal)</em>}
                            {linked.length > 0 && (
                              <span className="ml-1.5">
                                <Chip className={done === linked.length ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'}>
                                  {done}/{linked.length} milestone{linked.length !== 1 ? 's' : ''}
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
      id: g.id,
      goal: g.goal || '', objectives: g.objectives?.length ? [...g.objectives] : [''], interventions: g.interventions?.length ? [...g.interventions] : [''],
    })) : [emptyGoal()]
  )
  const [err, setErr] = useState('')

  const setGoal = (gi, patch) => setGoals(gs => gs.map((g, i) => i === gi ? { ...g, ...patch } : g))
  const setListItem = (gi, key, li, val) => setGoal(gi, { [key]: goals[gi][key].map((v, i) => i === li ? val : v) })
  const addListItem = (gi, key) => setGoal(gi, { [key]: [...goals[gi][key], ''] })
  const removeListItem = (gi, key, li) => setGoal(gi, { [key]: goals[gi][key].filter((_, i) => i !== li) })

  function cleanGoals() {
    return goals
      .map(g => ({
        ...(g.id ? { id: g.id } : {}),
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
        <button className={btnSm} onClick={onClose}>Cancel</button>
        <button className={btnSmGreen} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Plan'}</button>
      </>}>
      {err && <div className="mb-3 p-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">{err}</div>}
      <div className={field}>
        <label className={lbl}>Resident</label>
        <select className={inp} value={clientId} disabled={isEdit} onChange={e => setClientId(e.target.value)}>
          <option value="">Select resident…</option>
          {activeClients(clients).map(c => <option key={c.id} value={c.id}>{clientLabel(clients, c.id)}</option>)}
        </select>
      </div>
      <div className="flex gap-3 flex-wrap">
        <div className={`${field} flex-1 min-w-[120px]`}><label className={lbl}>Plan date</label><input className={inp} type="date" value={planDate} onChange={e => setPlanDate(e.target.value)} /></div>
        <div className={`${field} flex-1 min-w-[120px]`}><label className={lbl}>Target date</label><input className={inp} type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} /></div>
        <div className={`${field} flex-1 min-w-[120px]`}><label className={lbl}>Review date</label><input className={inp} type="date" value={reviewDate} onChange={e => setReviewDate(e.target.value)} /></div>
        <div className={`${field} flex-1 min-w-[120px]`}><label className={lbl}>Status</label>
          <select className={inp} value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className={field}><label className={lbl}>Presenting problem</label><textarea className={`${inp} min-h-[60px] resize-y`} value={presenting} onChange={e => setPresenting(e.target.value)} /></div>
      <div className="flex gap-3">
        <div className={`${field} flex-1`}><label className={lbl}>Strengths</label><textarea className={`${inp} min-h-[56px] resize-y`} value={strengths} onChange={e => setStrengths(e.target.value)} /></div>
        <div className={`${field} flex-1`}><label className={lbl}>Barriers</label><textarea className={`${inp} min-h-[56px] resize-y`} value={barriers} onChange={e => setBarriers(e.target.value)} /></div>
      </div>

      <label className={lbl}>Goals</label>
      {goals.map((g, gi) => (
        <div key={gi} className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 mb-2.5 bg-gray-50 dark:bg-gray-700/40">
          <div className="flex gap-2 items-center mb-2">
            <input className={`${inp} font-semibold`} placeholder={`Goal ${gi + 1}`} value={g.goal} onChange={e => setGoal(gi, { goal: e.target.value })} />
            {goals.length > 1 && <button className={btnSmRed} onClick={() => setGoals(gs => gs.filter((_, i) => i !== gi))}>✕</button>}
          </div>
          <SubList label="Objectives" items={g.objectives} onChange={(li, v) => setListItem(gi, 'objectives', li, v)} onAdd={() => addListItem(gi, 'objectives')} onRemove={li => removeListItem(gi, 'objectives', li)} btnSm={btnSm} btnSmRed={btnSmRed} />
          <SubList label="Interventions" items={g.interventions} onChange={(li, v) => setListItem(gi, 'interventions', li, v)} onAdd={() => addListItem(gi, 'interventions')} onRemove={li => removeListItem(gi, 'interventions', li)} btnSm={btnSm} btnSmRed={btnSmRed} />
        </div>
      ))}
      <button className={`${btnSm} mt-0.5`} onClick={() => setGoals(gs => [...gs, emptyGoal()])}>+ Add Goal</button>
    </Modal>
  )
}

function SubList({ label, items, onChange, onAdd, onRemove, btnSm, btnSmRed }) {
  return (
    <div className="mb-2">
      <div className="text-[.68rem] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">{label}</div>
      {items.map((v, li) => (
        <div key={li} className="flex gap-1.5 mb-1">
          <input className={`${inp} py-[5px] px-2 text-[.8rem]`} value={v} onChange={e => onChange(li, e.target.value)} placeholder={`${label.slice(0, -1)} ${li + 1}`} />
          {items.length > 1 && <button className={`${btnSmRed} px-2 py-0.5`} onClick={() => onRemove(li)}>✕</button>}
        </div>
      ))}
      <button className={`${btnSm} px-2.5 py-0.5 text-[.72rem]`} onClick={onAdd}>+ {label.slice(0, -1)}</button>
    </div>
  )
}
