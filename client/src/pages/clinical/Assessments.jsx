import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import {
  clinicalApi, fmtDate, activeClients, clientLabel, todayStr, labelOf,
  StatusBadge, Chip, Modal, EmptyState, SignedLine, inp, lbl, field,
} from './clinicalShared.jsx'
import { Header, card, btnSm, btnSmGreen, btnSmRed } from './ClinicalNotes.jsx'

const api = clinicalApi('assessments')

const ASSESS_TYPES = [
  ['biopsychosocial', 'Biopsychosocial'],
  ['substance_use',   'Substance Use'],
  ['mental_status',   'Mental Status'],
  ['trauma',          'Trauma'],
  ['risk',            'Risk'],
  ['other',           'Other'],
]

// Each template is { Section: { Field: '' } } — nested objects render as fieldsets.
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

// Build a filled content object for a type, carrying over any matching values.
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
    if (!window.confirm('Finalise this assessment?')) return
    try { await api.sign(id); await refresh() } catch (e) { alert(e.message) }
  }
  async function remove(id) {
    if (!window.confirm('Delete this assessment? This cannot be undone.')) return
    try { await api.remove(id); await refresh() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <Header title="Assessments" clients={clients} filter={filter} setFilter={setFilter} onNew={() => setEditing({})} />
      {rows.length === 0
        ? <EmptyState>No assessments{filter !== 'all' ? ' for this resident' : ''} yet.</EmptyState>
        : (
          <div style={{ display: 'grid', gap: 10 }}>
            {rows.map(a => {
              const typeLabel = labelOf(ASSESS_TYPES, a.assessment_type)
              const isFinal = a.status === 'final'
              return (
                <div key={a.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.92rem', marginBottom: 3 }}>{clientLabel(clients, a.client_id)}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Chip bg="#ede9fe" fg="#6d28d9">{typeLabel}</Chip>
                        <StatusBadge status={a.status} />
                        <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>{fmtDate(a.assessment_date)}</span>
                        {a.score != null && a.score !== '' && <Chip bg="#fef3c7" fg="#92400e">Score {a.score}{a.score_label ? ` · ${a.score_label}` : ''}</Chip>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                      <button style={btnSm} onClick={() => setViewing(a)}>View</button>
                      {isFinal
                        ? <SignedLine row={a} />
                        : <>
                            <button style={btnSm} onClick={() => setEditing(a)}>Edit</button>
                            <button style={btnSmGreen} onClick={() => finalise(a.id)}>Finalise</button>
                            <button style={btnSmRed} onClick={() => remove(a.id)}>Delete</button>
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
        <button className="btn-cancel" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</button>
      </>}>
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...field, flex: 2, minWidth: 200 }}>
          <label style={lbl}>Resident</label>
          <select style={inp} value={clientId} disabled={isEdit} onChange={e => setClientId(e.target.value)}>
            <option value="">Select resident…</option>
            {activeClients(clients).map(c => <option key={c.id} value={c.id}>{clientLabel(clients, c.id)}</option>)}
          </select>
        </div>
        <div style={{ ...field, flex: 1, minWidth: 140 }}>
          <label style={lbl}>Date</label>
          <input style={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div style={field}>
        <label style={lbl}>Assessment type</label>
        <select style={inp} value={type} onChange={e => changeType(e.target.value)}>
          {ASSESS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {/* Generic structured content form */}
      {Object.entries(content).map(([section, fields]) => (
        <fieldset key={section} style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, padding: '8px 12px 12px', marginBottom: 12 }}>
          <legend style={{ fontSize: '.74rem', fontWeight: 800, color: 'var(--sidebar-bg, #0a4655)', padding: '0 6px' }}>{section}</legend>
          {Object.entries(fields).map(([f, v]) => (
            <div key={f} style={{ marginBottom: 8 }}>
              <label style={{ ...lbl, textTransform: 'none', fontSize: '.74rem', color: '#475569' }}>{f}</label>
              <textarea style={{ ...inp, minHeight: 44, resize: 'vertical' }} value={v} onChange={e => setVal(section, f, e.target.value)} />
            </div>
          ))}
        </fieldset>
      ))}

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...field, flex: 1 }}><label style={lbl}>Score (optional)</label><input style={inp} type="number" step="any" value={score} onChange={e => setScore(e.target.value)} /></div>
        <div style={{ ...field, flex: 2 }}><label style={lbl}>Score label (optional)</label><input style={inp} value={scoreLabel} onChange={e => setScoreLabel(e.target.value)} placeholder="e.g. Low risk" /></div>
      </div>
    </Modal>
  )
}

function ViewModal({ record, clients, onClose, typeLabel }) {
  const content = record.content && typeof record.content === 'object' ? record.content : {}
  return (
    <Modal title={`${typeLabel} Assessment`} onClose={onClose} maxWidth={620}
      footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{clientLabel(clients, record.client_id)}</strong>
        <StatusBadge status={record.status} />
        <span style={{ color: '#94a3b8', fontSize: '.8rem' }}>{fmtDate(record.assessment_date)}</span>
        {record.score != null && record.score !== '' && <Chip bg="#fef3c7" fg="#92400e">Score {record.score}{record.score_label ? ` · ${record.score_label}` : ''}</Chip>}
      </div>
      {Object.entries(content).map(([section, fields]) => (
        <div key={section} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '.74rem', fontWeight: 800, color: 'var(--sidebar-bg, #0a4655)', borderBottom: '2px solid var(--line, #e2e8f0)', paddingBottom: 3, marginBottom: 6 }}>{section}</div>
          {Object.entries(fields || {}).map(([f, v]) => (
            <div key={f} style={{ marginBottom: 5 }}>
              <span style={{ fontSize: '.78rem', fontWeight: 700, color: '#64748b' }}>{f}: </span>
              <span style={{ fontSize: '.84rem', color: '#1e293b', whiteSpace: 'pre-wrap' }}>{v || <em style={{ color: '#cbd5e1' }}>—</em>}</span>
            </div>
          ))}
        </div>
      ))}
    </Modal>
  )
}
