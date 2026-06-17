import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import {
  clinicalApi, fmtDate, activeClients, clientLabel, todayStr, labelOf,
  StatusBadge, Chip, Modal, EmptyState, SignedLine, inp, lbl, field,
} from './clinicalShared.jsx'
import { Header, card, btnSm, btnSmGreen, btnSmRed } from './ClinicalNotes.jsx'
import { useConfirm } from '../../components/ui.jsx'

const dapi = clinicalApi('discharge-summaries')

const TYPES = [
  ['planned', 'Planned'], ['unplanned', 'Unplanned'], ['ama', 'AMA'], ['transfer', 'Transfer'], ['deceased', 'Deceased'],
]
const TYPE_CLS = {
  planned:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  unplanned: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  ama:       'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  transfer:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  deceased:  'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
}
const SECTIONS = [
  ['presenting_problem',    'Presenting Problem'],
  ['treatment_summary',     'Treatment Summary'],
  ['progress_toward_goals', 'Progress Toward Goals'],
  ['aftercare_plan',        'Aftercare Plan'],
]

export default function DischargeSummaries() {
  const { dischargeSummaries, data, refresh } = useData()
  const confirm = useConfirm()
  const clients = data?.clients || []
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const list = dischargeSummaries || []
    return filter === 'all' ? list : list.filter(d => d.client_id === parseInt(filter))
  }, [dischargeSummaries, filter])

  async function finalise(id) {
    if (!await confirm({ title: 'Finalise this discharge summary?', body: 'Once signed it can no longer be edited or deleted.', confirmText: 'Finalise' })) return
    try { await dapi.sign(id); await refresh() } catch (e) { alert(e.message) }
  }
  async function remove(id) {
    if (!await confirm({ title: 'Delete this draft discharge summary?', body: 'This cannot be undone.', confirmText: 'Delete', color: 'red' })) return
    try { await dapi.remove(id); await refresh() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <Header title="Discharge Summaries" clients={clients} filter={filter} setFilter={setFilter} onNew={() => setEditing({})} />
      {rows.length === 0
        ? <EmptyState>No discharge summaries{filter !== 'all' ? ' for this resident' : ''} yet.</EmptyState>
        : (
          <div className="grid gap-2.5">
            {rows.map(d => {
              const typeLabel = labelOf(TYPES, d.discharge_type)
              const isFinal = d.status === 'final'
              return (
                <div key={d.id} className={card}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-[.92rem] mb-0.5 text-gray-900 dark:text-white">{clientLabel(clients, d.client_id)}</div>
                      <div className="flex gap-1.5 items-center flex-wrap">
                        <Chip className={TYPE_CLS[d.discharge_type] || TYPE_CLS.planned}>{typeLabel}</Chip>
                        <StatusBadge status={d.status} />
                        <span className="text-xs text-gray-400 dark:text-gray-500">Discharged {fmtDate(d.discharge_date)}</span>
                        {d.discharge_to && <span className="text-xs text-gray-400 dark:text-gray-500">→ {d.discharge_to}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0 items-center">
                      <button className={btnSm} onClick={() => setViewing(d)}>View</button>
                      {isFinal
                        ? <SignedLine row={d} />
                        : <>
                            <button className={btnSm} onClick={() => setEditing(d)}>Edit</button>
                            <button className={btnSmGreen} onClick={() => finalise(d.id)}>Finalise</button>
                            <button className={btnSmRed} onClick={() => remove(d.id)}>Delete</button>
                          </>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

      {editing && (
        <DischargeModal clients={clients} record={editing.id ? editing : null} busy={busy} setBusy={setBusy}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />
      )}
      {viewing && <ViewModal record={viewing} clients={clients} onClose={() => setViewing(null)} />}
    </div>
  )
}

function DischargeModal({ clients, record, onClose, onSaved, busy, setBusy }) {
  const isEdit = !!record
  const [f, setF] = useState({
    client_id: record?.client_id || '',
    discharge_type: record?.discharge_type || 'planned',
    admission_date: record?.admission_date || '',
    discharge_date: record?.discharge_date || todayStr(),
    discharge_to: record?.discharge_to || '',
    follow_up_date: record?.follow_up_date || '',
    presenting_problem: record?.presenting_problem || '',
    treatment_summary: record?.treatment_summary || '',
    progress_toward_goals: record?.progress_toward_goals || '',
    aftercare_plan: record?.aftercare_plan || '',
  })
  const [err, setErr] = useState('')
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  async function save() {
    if (!f.client_id) { setErr('Select a resident.'); return }
    setBusy(true); setErr('')
    try {
      const body = {
        ...f, client_id: parseInt(f.client_id),
        admission_date: f.admission_date || null, follow_up_date: f.follow_up_date || null,
      }
      if (isEdit) await dapi.update(record.id, body); else await dapi.create(body)
      await onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={isEdit ? 'Edit Discharge Summary' : 'New Discharge Summary'} onClose={onClose} maxWidth={700}
      footer={<>
        <button className={btnSm} onClick={onClose}>Cancel</button>
        <button className={btnSmGreen} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</button>
      </>}>
      {err && <div className="mb-3 p-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">{err}</div>}
      <div className="flex gap-3 flex-wrap">
        <div className={`${field} flex-[2] min-w-[200px]`}>
          <label className={lbl}>Resident</label>
          <select className={inp} value={f.client_id} disabled={isEdit} onChange={e => set('client_id', e.target.value)}>
            <option value="">Select resident…</option>
            {activeClients(clients).map(c => <option key={c.id} value={c.id}>{clientLabel(clients, c.id)}</option>)}
          </select>
        </div>
        <div className={`${field} flex-1 min-w-[140px]`}>
          <label className={lbl}>Discharge type</label>
          <select className={inp} value={f.discharge_type} onChange={e => set('discharge_type', e.target.value)}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="flex gap-3 flex-wrap">
        <div className={`${field} flex-1 min-w-[130px]`}><label className={lbl}>Admission date</label><input className={inp} type="date" value={f.admission_date} onChange={e => set('admission_date', e.target.value)} /></div>
        <div className={`${field} flex-1 min-w-[130px]`}><label className={lbl}>Discharge date</label><input className={inp} type="date" value={f.discharge_date} onChange={e => set('discharge_date', e.target.value)} /></div>
        <div className={`${field} flex-1 min-w-[130px]`}><label className={lbl}>Follow-up date</label><input className={inp} type="date" value={f.follow_up_date} onChange={e => set('follow_up_date', e.target.value)} /></div>
      </div>
      <div className={field}><label className={lbl}>Discharged to</label><input className={inp} value={f.discharge_to} onChange={e => set('discharge_to', e.target.value)} placeholder="e.g. Sober living, IOP, family" /></div>
      {SECTIONS.map(([k, label]) => (
        <div key={k} className={field}>
          <label className={lbl}>{label}</label>
          <textarea className={`${inp} min-h-[70px] resize-y`} value={f[k]} onChange={e => set(k, e.target.value)} />
        </div>
      ))}
    </Modal>
  )
}

function ViewModal({ record, clients, onClose }) {
  const typeLabel = labelOf(TYPES, record.discharge_type)
  return (
    <Modal title="Discharge Summary" onClose={onClose} maxWidth={640}
      footer={<button className={btnSm} onClick={onClose}>Close</button>}>
      <div className="mb-2.5 flex gap-2 items-center flex-wrap">
        <strong className="text-gray-900 dark:text-white">{clientLabel(clients, record.client_id)}</strong>
        <Chip className={TYPE_CLS[record.discharge_type] || TYPE_CLS.planned}>{typeLabel}</Chip>
        <StatusBadge status={record.status} />
      </div>
      <div className="text-[.82rem] text-gray-500 dark:text-gray-400 mb-3 flex gap-4 flex-wrap">
        <span><strong>Admitted:</strong> {fmtDate(record.admission_date)}</span>
        <span><strong>Discharged:</strong> {fmtDate(record.discharge_date)}</span>
        {record.discharge_to && <span><strong>To:</strong> {record.discharge_to}</span>}
        {record.follow_up_date && <span><strong>Follow-up:</strong> {fmtDate(record.follow_up_date)}</span>}
      </div>
      {SECTIONS.map(([k, label]) => (
        <div key={k} className="mb-3">
          <div className="text-[.74rem] font-extrabold text-[#0a4655] dark:text-teal-300 border-b-2 border-gray-200 dark:border-gray-600 pb-0.5 mb-1.5">{label}</div>
          <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">{record[k] || <em className="text-gray-300 dark:text-gray-600">—</em>}</div>
        </div>
      ))}
    </Modal>
  )
}
