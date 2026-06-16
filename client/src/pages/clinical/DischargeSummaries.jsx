import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import {
  clinicalApi, fmtDate, activeClients, clientLabel, todayStr, labelOf,
  StatusBadge, Chip, Modal, EmptyState, SignedLine, inp, lbl, field,
} from './clinicalShared.jsx'
import { Header, card, btnSm, btnSmGreen, btnSmRed } from './ClinicalNotes.jsx'
import { useConfirm } from '../../components/ui.jsx'

// Nav path is /clinical/discharge, but the REST segment is discharge-summaries.
const dapi = clinicalApi('discharge-summaries')

const TYPES = [
  ['planned', 'Planned'], ['unplanned', 'Unplanned'], ['ama', 'AMA'], ['transfer', 'Transfer'], ['deceased', 'Deceased'],
]
const TYPE_COLORS = {
  planned:   ['#dcfce7', '#15803d'],
  unplanned: ['#ffedd5', '#9a3412'],
  ama:       ['#fee2e2', '#991b1b'],
  transfer:  ['#dbeafe', '#1d4ed8'],
  deceased:  ['#f1f5f9', '#475569'],
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
          <div style={{ display: 'grid', gap: 10 }}>
            {rows.map(d => {
              const [tbg, tfg] = TYPE_COLORS[d.discharge_type] || TYPE_COLORS.planned
              const typeLabel = labelOf(TYPES, d.discharge_type)
              const isFinal = d.status === 'final'
              return (
                <div key={d.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.92rem', marginBottom: 3 }}>{clientLabel(clients, d.client_id)}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Chip bg={tbg} fg={tfg}>{typeLabel}</Chip>
                        <StatusBadge status={d.status} />
                        <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>Discharged {fmtDate(d.discharge_date)}</span>
                        {d.discharge_to && <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>→ {d.discharge_to}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                      <button style={btnSm} onClick={() => setViewing(d)}>View</button>
                      {isFinal
                        ? <SignedLine row={d} />
                        : <>
                            <button style={btnSm} onClick={() => setEditing(d)}>Edit</button>
                            <button style={btnSmGreen} onClick={() => finalise(d.id)}>Finalise</button>
                            <button style={btnSmRed} onClick={() => remove(d.id)}>Delete</button>
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
        <button className="btn-cancel" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</button>
      </>}>
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...field, flex: 2, minWidth: 200 }}>
          <label style={lbl}>Resident</label>
          <select style={inp} value={f.client_id} disabled={isEdit} onChange={e => set('client_id', e.target.value)}>
            <option value="">Select resident…</option>
            {activeClients(clients).map(c => <option key={c.id} value={c.id}>{clientLabel(clients, c.id)}</option>)}
          </select>
        </div>
        <div style={{ ...field, flex: 1, minWidth: 140 }}>
          <label style={lbl}>Discharge type</label>
          <select style={inp} value={f.discharge_type} onChange={e => set('discharge_type', e.target.value)}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...field, flex: 1, minWidth: 130 }}><label style={lbl}>Admission date</label><input style={inp} type="date" value={f.admission_date} onChange={e => set('admission_date', e.target.value)} /></div>
        <div style={{ ...field, flex: 1, minWidth: 130 }}><label style={lbl}>Discharge date</label><input style={inp} type="date" value={f.discharge_date} onChange={e => set('discharge_date', e.target.value)} /></div>
        <div style={{ ...field, flex: 1, minWidth: 130 }}><label style={lbl}>Follow-up date</label><input style={inp} type="date" value={f.follow_up_date} onChange={e => set('follow_up_date', e.target.value)} /></div>
      </div>
      <div style={field}><label style={lbl}>Discharged to</label><input style={inp} value={f.discharge_to} onChange={e => set('discharge_to', e.target.value)} placeholder="e.g. Sober living, IOP, family" /></div>
      {SECTIONS.map(([k, label]) => (
        <div key={k} style={field}>
          <label style={lbl}>{label}</label>
          <textarea style={{ ...inp, minHeight: 70, resize: 'vertical' }} value={f[k]} onChange={e => set(k, e.target.value)} />
        </div>
      ))}
    </Modal>
  )
}

function ViewModal({ record, clients, onClose }) {
  const typeLabel = labelOf(TYPES, record.discharge_type)
  const [tbg, tfg] = TYPE_COLORS[record.discharge_type] || TYPE_COLORS.planned
  return (
    <Modal title="Discharge Summary" onClose={onClose} maxWidth={640}
      footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{clientLabel(clients, record.client_id)}</strong>
        <Chip bg={tbg} fg={tfg}>{typeLabel}</Chip>
        <StatusBadge status={record.status} />
      </div>
      <div style={{ fontSize: '.82rem', color: '#475569', marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span><strong>Admitted:</strong> {fmtDate(record.admission_date)}</span>
        <span><strong>Discharged:</strong> {fmtDate(record.discharge_date)}</span>
        {record.discharge_to && <span><strong>To:</strong> {record.discharge_to}</span>}
        {record.follow_up_date && <span><strong>Follow-up:</strong> {fmtDate(record.follow_up_date)}</span>}
      </div>
      {SECTIONS.map(([k, label]) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '.74rem', fontWeight: 800, color: 'var(--sidebar-bg, #0a4655)', borderBottom: '2px solid var(--line, #e2e8f0)', paddingBottom: 3, marginBottom: 5 }}>{label}</div>
          <div style={{ fontSize: '.84rem', color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{record[k] || <em style={{ color: '#cbd5e1' }}>—</em>}</div>
        </div>
      ))}
    </Modal>
  )
}
