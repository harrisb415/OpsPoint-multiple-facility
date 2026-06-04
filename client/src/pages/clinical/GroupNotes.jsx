import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import {
  clinicalApi, fmtDate, activeClients, todayStr,
  StatusBadge, Chip, Modal, EmptyState, SignedLine, inp, lbl, field,
} from './clinicalShared.jsx'
import { card, btnSm, btnSmGreen, btnSmRed } from './ClinicalNotes.jsx'

const api = clinicalApi('group-notes')
const PARTICIPATION = ['present', 'absent', 'excused']
const PART_COLORS = { present: ['#dcfce7', '#15803d'], absent: ['#fee2e2', '#991b1b'], excused: ['#fef3c7', '#92400e'] }

export default function GroupNotes() {
  const { groupNotes, data, refresh } = useData()
  const clients = data?.clients || []
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [busy, setBusy] = useState(false)

  const groupNames = useMemo(
    () => Array.from(new Set((groupNotes || []).map(g => g.group_name).filter(Boolean))),
    [groupNotes]
  )

  async function finalise(id) {
    if (!window.confirm('Finalise this group note?')) return
    try { await api.sign(id); await refresh() } catch (e) { alert(e.message) }
  }
  async function remove(id) {
    if (!window.confirm('Delete this group note? This cannot be undone.')) return
    try { await api.remove(id); await refresh() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#0f172a' }}>Group Notes</h1>
        <button className="btn btn-primary" onClick={() => setEditing({})}>+ New</button>
      </div>

      {(groupNotes || []).length === 0
        ? <EmptyState>No group session notes yet.</EmptyState>
        : (
          <div style={{ display: 'grid', gap: 10 }}>
            {groupNotes.map(g => {
              const att = g.attendees || []
              const present = att.filter(a => a.participation === 'present').length
              const isFinal = g.status === 'final'
              return (
                <div key={g.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.92rem', marginBottom: 3 }}>{g.group_name || '(untitled group)'}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <StatusBadge status={g.status} />
                        <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>{fmtDate(g.session_date)}</span>
                        {g.topic && <Chip bg="#e0f2fe" fg="#0369a1">{g.topic}</Chip>}
                        <Chip bg="#f1f5f9" fg="#475569">{present}/{att.length} present</Chip>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                      <button style={btnSm} onClick={() => setViewing(g)}>View</button>
                      {isFinal
                        ? <SignedLine row={g} />
                        : <>
                            <button style={btnSm} onClick={() => setEditing(g)}>Edit</button>
                            <button style={btnSmGreen} onClick={() => finalise(g.id)}>Finalise</button>
                            <button style={btnSmRed} onClick={() => remove(g.id)}>Delete</button>
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

  // attendee map: { [clientId]: { checked, participation, individual_note } }
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
        <button className="btn-cancel" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</button>
      </>}>
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...field, flex: 2, minWidth: 200 }}>
          <label style={lbl}>Group name</label>
          <input style={inp} list="group-name-list" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="e.g. Morning Process Group" />
          <datalist id="group-name-list">{groupNames.map(n => <option key={n} value={n} />)}</datalist>
        </div>
        <div style={{ ...field, flex: 1, minWidth: 140 }}>
          <label style={lbl}>Session date</label>
          <input style={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div style={field}>
        <label style={lbl}>Topic</label>
        <input style={inp} value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Relapse prevention" />
      </div>
      <div style={field}>
        <label style={lbl}>Session note</label>
        <textarea style={{ ...inp, minHeight: 100, resize: 'vertical' }} value={content} onChange={e => setContent(e.target.value)} />
      </div>

      <label style={lbl}>Attendees</label>
      <div style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, maxHeight: 240, overflowY: 'auto' }}>
        {activeClients(clients).map(c => {
          const row = att[c.id] || {}
          return (
            <div key={c.id} style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={!!row.checked} onChange={e => setOne(c.id, { checked: e.target.checked, participation: row.participation || 'present' })} />
                <span style={{ flex: 1, fontSize: '.85rem', fontWeight: 600 }}>{c.name}{c.room ? ` · Rm ${c.room}` : ''}</span>
                {row.checked && (
                  <select style={{ ...inp, width: 'auto', padding: '3px 8px', fontSize: '.78rem' }}
                    value={row.participation || 'present'} onChange={e => setOne(c.id, { participation: e.target.value })}>
                    {PARTICIPATION.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                  </select>
                )}
              </div>
              {row.checked && (
                <input style={{ ...inp, marginTop: 6, padding: '5px 8px', fontSize: '.8rem' }}
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
      footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge status={record.status} />
        <span style={{ color: '#94a3b8', fontSize: '.8rem' }}>{fmtDate(record.session_date)}</span>
        {record.topic && <Chip bg="#e0f2fe" fg="#0369a1">{record.topic}</Chip>}
      </div>
      {record.content && <div style={{ fontSize: '.85rem', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: 14 }}>{record.content}</div>}
      <div style={{ fontSize: '.74rem', fontWeight: 800, color: 'var(--sidebar-bg, #0a4655)', marginBottom: 6 }}>Attendees ({att.length})</div>
      {att.length === 0
        ? <div style={{ color: '#94a3b8', fontSize: '.84rem' }}>No attendees recorded.</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '4px 6px' }}>Resident</th>
                <th style={{ padding: '4px 6px' }}>Participation</th>
                <th style={{ padding: '4px 6px' }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {att.map(a => {
                const [bg, fg] = PART_COLORS[a.participation] || ['#f1f5f9', '#475569']
                return (
                  <tr key={a.client_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '5px 6px', fontWeight: 600 }}>{a.client_name || `Client #${a.client_id}`}{a.room ? ` · Rm ${a.room}` : ''}</td>
                    <td style={{ padding: '5px 6px' }}><Chip bg={bg} fg={fg}>{a.participation}</Chip></td>
                    <td style={{ padding: '5px 6px', color: '#475569' }}>{a.individual_note || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
    </Modal>
  )
}
