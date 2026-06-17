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
          <div className="grid gap-2.5">
            {rows.map(n => {
              const TYPE_CLS = {
                progress:     'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
                intake:       'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                medical:      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                psychosocial: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
                other:        'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
              }
              const isFinal = n.status === 'final'
              return (
                <div key={n.id} className={card}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-[.92rem] mb-0.5 text-gray-900 dark:text-white">{clientLabel(clients, n.client_id)}</div>
                      <div className="flex gap-1.5 items-center flex-wrap">
                        <Chip className={TYPE_CLS[n.note_type] || TYPE_CLS.other}>{n.note_type}</Chip>
                        <StatusBadge status={n.status} />
                        <span className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(n.note_date)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {isFinal
                        ? <SignedLine row={n} />
                        : (
                          <>
                            <button className={btnSm} onClick={() => setEditing(n)}>Edit</button>
                            <button className={btnSmGreen} onClick={() => finalise(n.id)}>Finalise</button>
                            <button className={btnSmRed} onClick={() => remove(n.id)}>Delete</button>
                          </>
                        )}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {n.content
                      ? (n.content.length > 280 ? n.content.slice(0, 280) + '…' : n.content)
                      : <span className="text-gray-400 dark:text-gray-500">(no content)</span>}
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
        <button className={btnSm} onClick={onClose}>Cancel</button>
        <button className={btnSmGreen} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</button>
      </>}
    >
      {err && <div className="mb-3 p-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">{err}</div>}
      <div className={field}>
        <label className={lbl}>Resident</label>
        <select className={inp} value={clientId} disabled={isEdit} onChange={e => setClientId(e.target.value)}>
          <option value="">Select resident…</option>
          {activeClients(clients).map(c => <option key={c.id} value={c.id}>{clientLabel(clients, c.id)}</option>)}
        </select>
      </div>
      <div className="flex gap-3">
        <div className={`${field} flex-1`}>
          <label className={lbl}>Type</label>
          <select className={inp} value={type} onChange={e => setType(e.target.value)}>
            {NOTE_TYPES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div className={`${field} flex-1`}>
          <label className={lbl}>Date</label>
          <input className={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div className={field}>
        <label className={lbl}>Note</label>
        <textarea className={`${inp} min-h-[160px] resize-y`} value={content}
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

const card = 'bg-white dark:bg-gray-800 rounded-xl px-[18px] py-4 border border-gray-200 dark:border-gray-700 shadow-sm'
const _btn = 'px-2.5 py-1 text-[.76rem] font-bold rounded cursor-pointer border'
const btnSm = `${_btn} border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600`
const btnSmGreen = `${_btn} border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50`
const btnSmRed = `${_btn} border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50`

export { card, btnSm, btnSmGreen, btnSmRed }
