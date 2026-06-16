import { useState, useMemo } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { useData } from '../../contexts/DataContext.jsx'
import {
  clinicalApi, fmtDate, activeClients, clientLabel, todayStr,
  StatusBadge, Chip, Modal, EmptyState, SignedLine, inp, lbl, field,
} from './clinicalShared.jsx'
import { useConfirm } from '../../components/ui.jsx'

const api = clinicalApi('notes')
const NOTE_TYPES = ['progress', 'intake', 'medical', 'psychosocial', 'other']
const TYPE_COLORS = {
  progress:     ['#e0f2fe', '#0369a1'],
  intake:       ['#dcfce7', '#15803d'],
  medical:      ['#fee2e2', '#991b1b'],
  psychosocial: ['#ede9fe', '#6d28d9'],
  other:        ['#f1f5f9', '#475569'],
}

export default function ClinicalNotes() {
  const { clinicalNotes, data, refresh } = useData()
  const confirm = useConfirm()
  const clients = data?.clients || []
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState(null) // null | {} (new) | record
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const list = clinicalNotes || []
    return filter === 'all' ? list : list.filter(n => n.client_id === parseInt(filter))
  }, [clinicalNotes, filter])

  async function finalise(id) {
    if (!await confirm({ title: 'Finalise this note?', body: 'Once signed it can no longer be edited or deleted.', confirmText: 'Finalise' })) return
    try { await api.sign(id); await refresh() } catch (e) { alert(e.message) }
  }
  async function remove(id) {
    if (!await confirm({ title: 'Delete this draft note?', body: 'This cannot be undone.', confirmText: 'Delete', color: 'red' })) return
    try { await api.remove(id); await refresh() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <Header
        title="Clinical Notes"
        clients={clients}
        filter={filter} setFilter={setFilter}
        onNew={() => setEditing({})}
      />

      {rows.length === 0
        ? <EmptyState>No clinical notes{filter !== 'all' ? ' for this resident' : ''} yet.</EmptyState>
        : (
          <div style={{ display: 'grid', gap: 10 }}>
            {rows.map(n => {
              const [tbg, tfg] = TYPE_COLORS[n.note_type] || TYPE_COLORS.other
              const isFinal = n.status === 'final'
              return (
                <div key={n.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.92rem', marginBottom: 3 }}>{clientLabel(clients, n.client_id)}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Chip bg={tbg} fg={tfg}>{n.note_type}</Chip>
                        <StatusBadge status={n.status} />
                        <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>{fmtDate(n.note_date)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {isFinal
                        ? <SignedLine row={n} />
                        : (
                          <>
                            <button style={btnSm} onClick={() => setEditing(n)}>Edit</button>
                            <button style={btnSmGreen} onClick={() => finalise(n.id)}>Finalise</button>
                            <button style={btnSmRed} onClick={() => remove(n.id)}>Delete</button>
                          </>
                        )}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: '.85rem', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {n.content
                      ? (n.content.length > 280 ? n.content.slice(0, 280) + '…' : n.content)
                      : <span style={{ color: '#cbd5e1' }}>(no content)</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

      {editing && (
        <NoteModal
          clients={clients}
          record={editing.id ? editing : null}
          busy={busy} setBusy={setBusy}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh() }}
        />
      )}
    </div>
  )
}

function NoteModal({ clients, record, onClose, onSaved, busy, setBusy }) {
  const isEdit = !!record
  const [clientId, setClientId] = useState(record?.client_id || '')
  const [type, setType]   = useState(record?.note_type || 'progress')
  const [date, setDate]   = useState(record?.note_date || todayStr())
  const [content, setContent] = useState(record?.content || '')
  const [err, setErr] = useState('')

  async function save() {
    if (!clientId) { setErr('Select a resident.'); return }
    setBusy(true); setErr('')
    try {
      const body = { client_id: parseInt(clientId), note_type: type, note_date: date, content }
      if (isEdit) await api.update(record.id, body)
      else        await api.create(body)
      await onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Clinical Note' : 'New Clinical Note'}
      onClose={onClose}
      footer={<>
        <button className="btn-cancel" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</button>
      </>}
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={field}>
        <label style={lbl}>Resident</label>
        <select style={inp} value={clientId} disabled={isEdit} onChange={e => setClientId(e.target.value)}>
          <option value="">Select resident…</option>
          {activeClients(clients).map(c => <option key={c.id} value={c.id}>{clientLabel(clients, c.id)}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...field, flex: 1 }}>
          <label style={lbl}>Type</label>
          <select style={inp} value={type} onChange={e => setType(e.target.value)}>
            {NOTE_TYPES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div style={{ ...field, flex: 1 }}>
          <label style={lbl}>Date</label>
          <input style={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div style={field}>
        <label style={lbl}>Note</label>
        <textarea style={{ ...inp, minHeight: 160, resize: 'vertical' }} value={content}
          onChange={e => setContent(e.target.value)} placeholder="Clinical note…" />
      </div>
    </Modal>
  )
}

// ── Shared header bar (title + client filter + New) ───────────────────────
export function Header({ title, clients, filter, setFilter, onNew, newLabel = 'New' }) {
  return (
    <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <nav className="flex items-center mb-1 text-xs text-gray-400">
          <span>Clinical</span><ChevronRight className="w-3.5 h-3.5 mx-1" /><span className="text-gray-600 dark:text-gray-300">{title}</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {clients && setFilter && (
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="px-2.5 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
            <option value="all">All residents</option>
            {activeClients(clients).map(c => <option key={c.id} value={c.id}>{clientLabel(clients, c.id)}</option>)}
          </select>
        )}
        {onNew && (
          <button onClick={onNew}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm bg-primary-600 hover:bg-primary-700">
            <Plus className="w-4 h-4" />{newLabel}
          </button>
        )}
      </div>
    </div>
  )
}

const card = { background: '#fff', borderRadius: 12, padding: '16px 18px', border: '1px solid #e5e7eb', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' }
const btnSm = { padding: '4px 10px', fontSize: '.76rem', fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--line, #cbd5e1)', background: '#f8fafc', color: '#334155' }
const btnSmGreen = { ...btnSm, background: '#dcfce7', color: '#15803d', borderColor: '#bbf7d0' }
const btnSmRed = { ...btnSm, background: '#fee2e2', color: '#b91c1c', borderColor: '#fecaca' }

export { card, btnSm, btnSmGreen, btnSmRed }
