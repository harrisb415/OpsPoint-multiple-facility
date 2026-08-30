import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import {
  clinicalApi, fmtDate, activeClients, todayStr,
  StatusBadge, Chip, Modal, EmptyState, SignedLine, inp, lbl, field,
} from './clinicalShared.jsx'
import { Header, card, btnSm, btnSmGreen, btnSmRed } from './ClinicalNotes.jsx'
import { useConfirm } from '../../components/ui.jsx'

const api = clinicalApi('group-notes')
const PARTICIPATION = ['present', 'absent', 'excused']
const PART_CLS = {
  present: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  absent:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  excused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
}

export default function GroupNotes() {
  const { groupNotes, data, refresh } = useData()
  const confirm = useConfirm()
  const clients = data?.clients || []
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [busy, setBusy] = useState(false)

  const groupNames = useMemo(
    () => Array.from(new Set((groupNotes || []).map(g => g.group_name).filter(Boolean))),
    [groupNotes]
  )

  async function finalise(id) {
    if (!await confirm({ title: 'Finalise this group note?', confirmText: 'Finalise' })) return
    try { await api.sign(id); await refresh() } catch (e) { alert(e.message) }
  }
  async function remove(id) {
    if (!await confirm({ title: 'Delete this group note?', body: 'This cannot be undone.', confirmText: 'Delete', color: 'red' })) return
    try { await api.remove(id); await refresh() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <Header title="Group Notes" onNew={() => setEditing({})} />

      {(groupNotes || []).length === 0
        ? <EmptyState>No group session notes yet.</EmptyState>
        : (
          <div className="grid gap-2.5">
            {groupNotes.map(g => {
              const att = g.attendees || []
              const present = att.filter(a => a.participation === 'present').length
              const isFinal = g.status === 'final'
              return (
                <div key={g.id} className={card}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-[.92rem] mb-0.5 text-gray-900 dark:text-white">{g.group_name || '(untitled group)'}</div>
                      <div className="flex gap-1.5 items-center flex-wrap">
                        <StatusBadge status={g.status} />
                        <span className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(g.session_date)}</span>
                        {g.topic && <Chip className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{g.topic}</Chip>}
                        <Chip>{present}/{att.length} present</Chip>
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0 items-center">
                      <button className={btnSm} onClick={() => setViewing(g)}>View</button>
                      {isFinal
                        ? <SignedLine row={g} />
                        : <>
                            <button className={btnSm} onClick={() => setEditing(g)}>Edit</button>
                            <button className={btnSmGreen} onClick={() => finalise(g.id)}>Finalise</button>
                            <button className={btnSmRed} onClick={() => remove(g.id)}>Delete</button>
                          </>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

      {editing && (
        <GroupModal clients={clients} record={editing.id ? editing : null} groupNames={groupNames} busy={busy} setBusy={setBusy}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />
      )}
      {viewing && <ViewModal record={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function GroupModal({ clients, record, groupNames, onClose, onSaved, busy, setBusy }) {
  const isEdit = !!record
  const [groupName, setGroupName] = useState(record?.group_name || '')
  const [date, setDate] = useState(record?.session_date || todayStr())
  const [topic, setTopic] = useState(record?.topic || '')
  const [content, setContent] = useState(record?.content || '')
  const [err, setErr] = useState('')

  const [att, setAtt] = useState(() => {
    const m = {}
    ;(record?.attendees || []).forEach(a => { m[a.client_id] = { checked: true, participation: a.participation || 'present', individual_note: a.individual_note || '' } })
    return m
  })
  const setOne = (cid, patch) => setAtt(a => ({ ...a, [cid]: { ...(a[cid] || { participation: 'present', individual_note: '' }), ...patch } }))

  async function save() {
    if (!groupName.trim()) { setErr('Group name is required.'); return }
    setBusy(true); setErr('')
    try {
      const attendees = Object.entries(att)
        .filter(([, v]) => v.checked)
        .map(([cid, v]) => ({ client_id: parseInt(cid), participation: v.participation, individual_note: v.individual_note }))
      const body = { group_name: groupName.trim(), session_date: date, topic, content, attendees }
      if (isEdit) await api.update(record.id, body); else await api.create(body)
      await onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={isEdit ? 'Edit Group Note' : 'New Group Note'} onClose={onClose} maxWidth={680}
      footer={<>
        <button className={btnSm} onClick={onClose}>Cancel</button>
        <button className={btnSmGreen} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</button>
      </>}>
      {err && <div className="mb-3 p-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">{err}</div>}
      <div className="flex gap-3 flex-wrap">
        <div className={`${field} flex-[2] min-w-[200px]`}>
          <label className={lbl}>Group name</label>
          <input className={inp} list="group-name-list" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="e.g. Morning Process Group" />
          <datalist id="group-name-list">{groupNames.map(n => <option key={n} value={n} />)}</datalist>
        </div>
        <div className={`${field} flex-1 min-w-[140px]`}>
          <label className={lbl}>Session date</label>
          <input className={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div className={field}>
        <label className={lbl}>Topic</label>
        <input className={inp} value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Relapse prevention" />
      </div>
      <div className={field}>
        <label className={lbl}>Session note</label>
        <textarea className={`${inp} min-h-[100px] resize-y`} value={content} onChange={e => setContent(e.target.value)} />
      </div>

      <label className={lbl}>Attendees</label>
      <div className="border border-gray-200 dark:border-gray-600 rounded-lg max-h-60 overflow-y-auto">
        {activeClients(clients).map(c => {
          const row = att[c.id] || {}
          return (
            <div key={c.id} className="px-2.5 py-2 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={!!row.checked} onChange={e => setOne(c.id, { checked: e.target.checked, participation: row.participation || 'present' })}
                  className="w-3.5 h-3.5 accent-blue-600 cursor-pointer flex-shrink-0" />
                <span className="flex-1 text-sm font-semibold text-gray-800 dark:text-gray-200">{c.name}{c.room ? ` · Rm ${c.room}` : ''}</span>
                {row.checked && (
                  <select className={`${inp} w-auto py-[3px] px-2 text-xs`}
                    value={row.participation || 'present'} onChange={e => setOne(c.id, { participation: e.target.value })}>
                    {PARTICIPATION.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                  </select>
                )}
              </div>
              {row.checked && (
                <input className={`${inp} mt-1.5 py-[5px] px-2 text-[.8rem]`}
                  placeholder="Individual note (optional)" value={row.individual_note || ''} onChange={e => setOne(c.id, { individual_note: e.target.value })} />
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function ViewModal({ record, onClose }) {
  const att = record.attendees || []
  return (
    <Modal title={record.group_name || 'Group Note'} onClose={onClose} maxWidth={620}
      footer={<button className={btnSm} onClick={onClose}>Close</button>}>
      <div className="mb-2.5 flex gap-2 items-center flex-wrap">
        <StatusBadge status={record.status} />
        <span className="text-[.8rem] text-gray-400 dark:text-gray-500">{fmtDate(record.session_date)}</span>
        {record.topic && <Chip className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{record.topic}</Chip>}
      </div>
      {record.content && <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed mb-3.5">{record.content}</div>}
      <div className="text-[.74rem] font-extrabold text-primary-700 dark:text-primary-300 mb-1.5">Attendees ({att.length})</div>
      {att.length === 0
        ? <div className="text-sm text-gray-400 dark:text-gray-500">No attendees recorded.</div>
        : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400">
                <th className="px-1.5 py-1 text-xs font-semibold">Resident</th>
                <th className="px-1.5 py-1 text-xs font-semibold">Participation</th>
                <th className="px-1.5 py-1 text-xs font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {att.map(a => (
                <tr key={a.client_id} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="px-1.5 py-1.5 font-semibold text-gray-900 dark:text-white">{a.client_name || `Client #${a.client_id}`}{a.room ? ` · Rm ${a.room}` : ''}</td>
                  <td className="px-1.5 py-1.5"><Chip className={PART_CLS[a.participation] || 'bg-gray-100 text-gray-500'}>{a.participation}</Chip></td>
                  <td className="px-1.5 py-1.5 text-gray-500 dark:text-gray-400">{a.individual_note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Modal>
  )
}
