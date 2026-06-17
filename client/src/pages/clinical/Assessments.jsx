import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import {
  clinicalApi, fmtDate, activeClients, clientLabel, todayStr, labelOf,
  StatusBadge, Chip, Modal, EmptyState, SignedLine, inp, lbl, field,
} from './clinicalShared.jsx'
import { Header, card, btnSm, btnSmGreen, btnSmRed } from './ClinicalNotes.jsx'
import { useConfirm } from '../../components/ui.jsx'

const api = clinicalApi('assessments')

const ASSESS_TYPES = [
  ['biopsychosocial', 'Biopsychosocial'],
  ['substance_use',   'Substance Use'],
  ['mental_status',   'Mental Status'],
  ['trauma',          'Trauma'],
  ['risk',            'Risk'],
  ['other',           'Other'],
]

const TEMPLATES = {
  biopsychosocial: {
    'Presenting Concerns': { 'Chief complaint': '', 'History of present concern': '' },
    'Biological': { 'Medical history': '', 'Sleep & appetite': '', 'Physical health': '' },
    'Psychological': { 'Mental health history': '', 'Current symptoms': '', 'Coping skills': '' },
    'Social': { 'Family & relationships': '', 'Employment & education': '', 'Living situation': '' },
  },
  substance_use: {
    'Substance History': { 'Primary substance': '', 'Age of first use': '', 'Frequency & amount': '', 'Last use': '' },
    'Treatment History': { 'Prior treatment episodes': '', 'Longest period of sobriety': '' },
    'Impact': { 'Legal': '', 'Financial': '', 'Relational': '' },
  },
  mental_status: {
    'Appearance & Behavior': { 'Appearance': '', 'Motor activity': '', 'Attitude': '' },
    'Cognition': { 'Orientation': '', 'Memory': '', 'Concentration': '' },
    'Mood & Affect': { 'Mood': '', 'Affect': '' },
    'Thought': { 'Thought process': '', 'Thought content': '', 'Perception': '' },
  },
  trauma: {
    'Trauma History': { 'Type(s) of trauma': '', 'Age(s) of occurrence': '' },
    'Current Symptoms': { 'Intrusion': '', 'Avoidance': '', 'Arousal': '' },
    'Safety': { 'Current safety concerns': '', 'Support system': '' },
  },
  risk: {
    'Suicide Risk': { 'Ideation': '', 'Plan': '', 'Intent': '', 'Means': '' },
    'Harm to Others': { 'Ideation': '', 'History of violence': '' },
    'Protective Factors': { 'Reasons for living': '', 'Support': '' },
  },
  other: {
    'Assessment': { 'Summary': '', 'Findings': '', 'Recommendations': '' },
  },
}

function buildContent(type, existing) {
  const tmpl = TEMPLATES[type] || {}
  const out = {}
  for (const [section, fields] of Object.entries(tmpl)) {
    out[section] = {}
    for (const f of Object.keys(fields)) {
      out[section][f] = (existing && existing[section] && existing[section][f] != null) ? existing[section][f] : ''
    }
  }
  return out
}

export default function Assessments() {
  const { assessments, data, refresh } = useData()
  const confirm = useConfirm()
  const clients = data?.clients || []
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const list = assessments || []
    return filter === 'all' ? list : list.filter(a => a.client_id === parseInt(filter))
  }, [assessments, filter])

  async function finalise(id) {
    if (!await confirm({ title: 'Finalise this assessment?', confirmText: 'Finalise' })) return
    try { await api.sign(id); await refresh() } catch (e) { alert(e.message) }
  }
  async function remove(id) {
    if (!await confirm({ title: 'Delete this assessment?', body: 'This cannot be undone.', confirmText: 'Delete', color: 'red' })) return
    try { await api.remove(id); await refresh() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <Header title="Assessments" clients={clients} filter={filter} setFilter={setFilter} onNew={() => setEditing({})} />
      {rows.length === 0
        ? <EmptyState>No assessments{filter !== 'all' ? ' for this resident' : ''} yet.</EmptyState>
        : (
          <div className="grid gap-2.5">
            {rows.map(a => {
              const typeLabel = labelOf(ASSESS_TYPES, a.assessment_type)
              const isFinal = a.status === 'final'
              return (
                <div key={a.id} className={card}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-[.92rem] mb-0.5 text-gray-900 dark:text-white">{clientLabel(clients, a.client_id)}</div>
                      <div className="flex gap-1.5 items-center flex-wrap">
                        <Chip className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{typeLabel}</Chip>
                        <StatusBadge status={a.status} />
                        <span className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(a.assessment_date)}</span>
                        {a.score != null && a.score !== '' && <Chip className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">Score {a.score}{a.score_label ? ` · ${a.score_label}` : ''}</Chip>}
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0 items-center">
                      <button className={btnSm} onClick={() => setViewing(a)}>View</button>
                      {isFinal
                        ? <SignedLine row={a} />
                        : <>
                            <button className={btnSm} onClick={() => setEditing(a)}>Edit</button>
                            <button className={btnSmGreen} onClick={() => finalise(a.id)}>Finalise</button>
                            <button className={btnSmRed} onClick={() => remove(a.id)}>Delete</button>
                          </>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

      {editing && (
        <AssessModal clients={clients} record={editing.id ? editing : null} busy={busy} setBusy={setBusy}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />
      )}
      {viewing && <ViewModal record={viewing} clients={clients} onClose={() => setViewing(null)} typeLabel={labelOf(ASSESS_TYPES, viewing.assessment_type)} />}
    </div>
  )
}

function AssessModal({ clients, record, onClose, onSaved, busy, setBusy }) {
  const isEdit = !!record
  const [clientId, setClientId] = useState(record?.client_id || '')
  const [type, setType] = useState(record?.assessment_type || 'biopsychosocial')
  const [date, setDate] = useState(record?.assessment_date || todayStr())
  const [score, setScore] = useState(record?.score ?? '')
  const [scoreLabel, setScoreLabel] = useState(record?.score_label || '')
  const [content, setContent] = useState(() => buildContent(record?.assessment_type || 'biopsychosocial', record?.content || {}))
  const [err, setErr] = useState('')

  function changeType(t) { setType(t); setContent(prev => buildContent(t, prev)) }
  function setVal(section, fld, v) {
    setContent(c => ({ ...c, [section]: { ...c[section], [fld]: v } }))
  }

  async function save() {
    if (!clientId) { setErr('Select a resident.'); return }
    setBusy(true); setErr('')
    try {
      const body = {
        client_id: parseInt(clientId), assessment_type: type, assessment_date: date,
        content, score: score === '' ? null : parseFloat(score), score_label: scoreLabel,
      }
      if (isEdit) await api.update(record.id, body); else await api.create(body)
      await onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={isEdit ? 'Edit Assessment' : 'New Assessment'} onClose={onClose} maxWidth={680}
      footer={<>
        <button className={btnSm} onClick={onClose}>Cancel</button>
        <button className={btnSmGreen} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</button>
      </>}>
      {err && <div className="mb-3 p-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">{err}</div>}
      <div className="flex gap-3 flex-wrap">
        <div className={`${field} flex-[2] min-w-[200px]`}>
          <label className={lbl}>Resident</label>
          <select className={inp} value={clientId} disabled={isEdit} onChange={e => setClientId(e.target.value)}>
            <option value="">Select resident…</option>
            {activeClients(clients).map(c => <option key={c.id} value={c.id}>{clientLabel(clients, c.id)}</option>)}
          </select>
        </div>
        <div className={`${field} flex-1 min-w-[140px]`}>
          <label className={lbl}>Date</label>
          <input className={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div className={field}>
        <label className={lbl}>Assessment type</label>
        <select className={inp} value={type} onChange={e => changeType(e.target.value)}>
          {ASSESS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {Object.entries(content).map(([section, fields]) => (
        <fieldset key={section} className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 pb-3 pt-1 mb-3">
          <legend className="text-[.74rem] font-extrabold text-[#0a4655] dark:text-teal-300 px-1.5">{section}</legend>
          {Object.entries(fields).map(([f, v]) => (
            <div key={f} className="mb-2">
              <label className={`${lbl} normal-case text-[.74rem]`}>{f}</label>
              <textarea className={`${inp} min-h-[44px] resize-y`} value={v} onChange={e => setVal(section, f, e.target.value)} />
            </div>
          ))}
        </fieldset>
      ))}

      <div className="flex gap-3">
        <div className={`${field} flex-1`}><label className={lbl}>Score (optional)</label><input className={inp} type="number" step="any" value={score} onChange={e => setScore(e.target.value)} /></div>
        <div className={`${field} flex-[2]`}><label className={lbl}>Score label (optional)</label><input className={inp} value={scoreLabel} onChange={e => setScoreLabel(e.target.value)} placeholder="e.g. Low risk" /></div>
      </div>
    </Modal>
  )
}

function ViewModal({ record, clients, onClose, typeLabel }) {
  const content = record.content && typeof record.content === 'object' ? record.content : {}
  return (
    <Modal title={`${typeLabel} Assessment`} onClose={onClose} maxWidth={620}
      footer={<button className={btnSm} onClick={onClose}>Close</button>}>
      <div className="mb-2.5 flex gap-2 items-center flex-wrap">
        <strong className="text-gray-900 dark:text-white">{clientLabel(clients, record.client_id)}</strong>
        <StatusBadge status={record.status} />
        <span className="text-[.8rem] text-gray-400 dark:text-gray-500">{fmtDate(record.assessment_date)}</span>
        {record.score != null && record.score !== '' && <Chip className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">Score {record.score}{record.score_label ? ` · ${record.score_label}` : ''}</Chip>}
      </div>
      {Object.entries(content).map(([section, fields]) => (
        <div key={section} className="mb-3">
          <div className="text-[.74rem] font-extrabold text-[#0a4655] dark:text-teal-300 border-b-2 border-gray-200 dark:border-gray-600 pb-0.5 mb-1.5">{section}</div>
          {Object.entries(fields || {}).map(([f, v]) => (
            <div key={f} className="mb-1.5">
              <span className="text-[.78rem] font-bold text-gray-500 dark:text-gray-400">{f}: </span>
              <span className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{v || <em className="text-gray-300 dark:text-gray-600">—</em>}</span>
            </div>
          ))}
        </div>
      ))}
    </Modal>
  )
}
