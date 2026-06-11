import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

const PAGE_SIZE = 25

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}

function localDT(s) {
  if (!s) return ''
  try { return new Date(s).toISOString().slice(0, 16) }
  catch { return '' }
}

const BLANK_PASS = { client_id: '', room: '', name: '', departure: '', return_date: '', ua_notes: '', notes: '', status: 'In' }

function StatusBadge({ status }) {
  const styles = {
    Out: { background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047' },
    Extended: { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
    In: { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' },
    Returned: { background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1' },
  }
  const s = styles[status] || styles.Out
  return (
    <span style={{ ...s, fontSize: '.73rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  )
}

export default function PassesTab() {
  const { data, openProfile } = useData()
  const { hasPerm } = usePermission()
  const canEdit   = hasPerm('passes.edit')
  const canStatus = hasPerm('passes.status') || canEdit  // passes.edit implies status too

  const passes = data?.passes || []
  const clients = data?.clients || []
  const passNotice = data?.pass_notice || ''

  const [noticeText, setNoticeText] = useState(passNotice)
  const [noticeSaving, setNoticeSaving] = useState(false)
  const [retPage, setRetPage] = useState(0)
  const [modal, setModal] = useState(null) // null | 'add' | passObject
  const [form, setForm] = useState(BLANK_PASS)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const active = useMemo(() => passes.filter(p => p.status !== 'Returned'), [passes])
  const returned = useMemo(() => passes.filter(p => p.status === 'Returned')
    .slice().sort((a, b) => (b.return_date || '').localeCompare(a.return_date || '')), [passes])

  const retPages = Math.ceil(returned.length / PAGE_SIZE)
  const retPaged = returned.slice(retPage * PAGE_SIZE, (retPage + 1) * PAGE_SIZE)

  const activeClients = useMemo(() =>
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [clients]
  )

  async function saveNotice() {
    setNoticeSaving(true)
    await fetch('/api/pass-notice', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ notice: noticeText }),
    })
    setNoticeSaving(false)
  }

  function openAdd() {
    setForm({ ...BLANK_PASS })
    setError('')
    setModal('add')
  }

  function openEdit(p) {
    setForm({
      client_id: String(p.client_id || ''),
      room: p.room || '',
      name: p.name || '',
      departure: localDT(p.departure),
      return_date: localDT(p.return_date),
      ua_notes: p.ua_notes || '',
      notes: p.notes || '',
      status: p.status || 'Out',
    })
    setError('')
    setModal(p)
  }

  function handleClientSelect(clientId) {
    const c = clients.find(x => String(x.id) === String(clientId))
    setForm(f => ({ ...f, client_id: clientId, room: c?.room || f.room, name: c?.name || f.name }))
  }

  async function submit() {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      const isNew = modal === 'add'
      const url = isNew ? '/api/passes' : `/api/passes/${modal.id}`
      const body = {
        client_id: form.client_id ? parseInt(form.client_id) : null,
        room: form.room,
        name: form.name.trim(),
        departure: form.departure || null,
        return_date: form.return_date || null,
        ua_notes: form.ua_notes,
        notes: form.notes,
        status: form.status,
      }
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Save failed'); return }
      setModal(null)
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  async function quickStatus(p, newStatus) {
    await fetch(`/api/passes/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ...p, status: newStatus }),
    })
  }

  async function markReturned(p) {
    if (!window.confirm(`Mark ${p.name} as returned?`)) return
    await quickStatus(p, 'Returned')
  }

  async function del(p) {
    if (!window.confirm(`Delete pass for ${p.name}?`)) return
    await fetch(`/api/passes/${p.id}`, { method: 'DELETE', credentials: 'include' })
  }

  return (
    <div>
      {/* Pass Notice */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Pass Notice Board</span></div>
          {canEdit && (
            <button className="btn btn-sm btn-primary" disabled={noticeSaving} onClick={saveNotice}>
              {noticeSaving ? 'Saving…' : 'Save Notice'}
            </button>
          )}
        </div>
        <div className="section-body">
          <textarea value={noticeText} onChange={e => setNoticeText(e.target.value)}
            rows={3} disabled={!canEdit}
            placeholder="Enter any pass-related notices for this weekend…"
            style={{ width: '100%', resize: 'vertical', fontFamily: 'var(--sans)', fontSize: '.9rem', padding: '9px 11px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none', background: canEdit ? '#fff' : '#f8fafc', color: 'var(--text)' }} />
        </div>
      </div>

      {/* Active Passes */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Active Passes</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>{active.length} out</span>
            {canEdit && <button className="btn btn-sm btn-primary" onClick={openAdd}>+ Add Pass</button>}
          </div>
        </div>
        <div className="section-body" style={{ padding: 0 }}>
          {active.length === 0 ? (
            <div className="empty-state">No active passes.</div>
          ) : (
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rm</th><th>Name</th><th>Status</th>
                    <th>Departure</th><th>Return</th>
                    <th>UA Notes</th><th>Notes</th>
                    {(canEdit || canStatus) && <th className="tc">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {active.map(p => (
                    <tr key={p.id}>
                      <td className="rm">{p.room}</td>
                      <td className="name-cell">
                        {p.client_id ? (
                          <button onClick={() => openProfile(p.client_id)} style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'inherit', fontFamily:'inherit', fontSize:'inherit', fontWeight:'inherit', textDecoration:'underline', textDecorationStyle:'dotted', textDecorationColor:'rgba(27,47,110,.4)' }}>
                            {p.name}
                          </button>
                        ) : p.name}
                      </td>
                      <td>
                        {canStatus ? (
                          <select
                            value={p.status}
                            onChange={e => quickStatus(p, e.target.value)}
                            style={{
                              fontFamily: 'var(--sans)', fontSize: '.78rem', fontWeight: 700,
                              padding: '3px 6px', border: '1px solid var(--line)', borderRadius: 8,
                              cursor: 'pointer', outline: 'none',
                              background: p.status === 'Out' ? '#fef9c3'
                                : p.status === 'Extended' ? '#fee2e2'
                                : p.status === 'In' ? '#dcfce7'
                                : '#f1f5f9',
                              color: p.status === 'Out' ? '#854d0e'
                                : p.status === 'Extended' ? '#991b1b'
                                : p.status === 'In' ? '#15803d'
                                : '#64748b',
                            }}
                          >
                            <option value="Out">Out</option>
                            <option value="Extended">Extended</option>
                            <option value="In">In</option>
                          </select>
                        ) : (
                          <StatusBadge status={p.status} />
                        )}
                      </td>
                      <td className="date-cell">{fmtDT(p.departure)}</td>
                      <td className="date-cell">{fmtDT(p.return_date)}</td>
                      <td style={{ fontSize: '.82rem', color: '#475569' }}>{p.ua_notes || ''}</td>
                      <td style={{ fontSize: '.82rem', color: '#475569' }}>{p.notes || ''}</td>
                      {(canEdit || canStatus) && (
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {canEdit && (
                            <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)', marginRight: 4 }}
                              onClick={() => openEdit(p)}>✎</button>
                          )}
                          {canStatus && (
                            <button className="btn btn-sm btn-green" style={{ marginRight: canEdit ? 4 : 0 }} onClick={() => markReturned(p)}>Returned</button>
                          )}
                          {canEdit && (
                            <button className="btn-danger-sm" onClick={() => del(p)}>✕</button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Returned Passes */}
      {returned.length > 0 && (
        <div className="section">
          <div className="section-head">
            <div className="sh-left"><span className="sh-dot" /><span>Returned Passes</span></div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>{returned.length} total</span>
          </div>
          <div className="section-body" style={{ padding: 0 }}>
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rm</th><th>Name</th><th>Departure</th><th>Returned</th><th>Notes</th>
                    {canEdit && <th className="tc">Del</th>}
                  </tr>
                </thead>
                <tbody>
                  {retPaged.map(p => (
                    <tr key={p.id} style={{ opacity: .7 }}>
                      <td className="rm">{p.room}</td>
                      <td className="name-cell">
                        {p.client_id ? (
                          <button onClick={() => openProfile(p.client_id)} style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'inherit', fontFamily:'inherit', fontSize:'inherit', fontWeight:'inherit', textDecoration:'underline', textDecorationStyle:'dotted', textDecorationColor:'rgba(27,47,110,.4)' }}>
                            {p.name}
                          </button>
                        ) : p.name}
                      </td>
                      <td className="date-cell">{fmtDT(p.departure)}</td>
                      <td className="date-cell">{fmtDT(p.return_date)}</td>
                      <td style={{ fontSize: '.82rem', color: '#475569' }}>{p.notes || ''}</td>
                      {canEdit && (
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn-danger-sm" onClick={() => del(p)}>✕</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {retPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', fontSize: '.82rem', borderTop: '1px solid var(--line)' }}>
                <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }} disabled={retPage === 0} onClick={() => setRetPage(p => p - 1)}>← Prev</button>
                <span style={{ color: '#475569' }}>{retPage * PAGE_SIZE + 1}–{Math.min((retPage + 1) * PAGE_SIZE, returned.length)} of {returned.length}</span>
                <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }} disabled={retPage + 1 >= retPages} onClick={() => setRetPage(p => p + 1)}>Next →</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h2>{modal === 'add' ? 'Add Weekend Pass' : `Edit Pass — ${modal.name}`}</h2>
              <button className="xbtn" onClick={() => setModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              {error && <div className="auth-error">{error}</div>}
              {modal === 'add' && (
                <div className="field"><label>Select Resident</label>
                  <select value={form.client_id} onChange={e => handleClientSelect(e.target.value)}>
                    <option value="">— Select or type below —</option>
                    {activeClients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field"><label>Room</label>
                  <input type="text" value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))} /></div>
                <div className="field"><label>Name</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div className="field"><label>Departure</label>
                  <input type="datetime-local" value={form.departure} onChange={e => setForm(f => ({ ...f, departure: e.target.value }))} /></div>
                <div className="field"><label>Expected Return</label>
                  <input type="datetime-local" value={form.return_date} onChange={e => setForm(f => ({ ...f, return_date: e.target.value }))} /></div>
              </div>
              <div className="field"><label>Status</label>
                <select value={form.status} disabled={!canStatus}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="Out">Out</option>
                  <option value="Extended">Extended</option>
                  <option value="In">In</option>
                </select>
                {!canStatus && <div style={{ fontSize: '.72rem', color: '#94a3b8', marginTop: 2 }}>Requires passes.status permission to change.</div>}
              </div>
              <div className="field"><label>UA Requirements / Notes</label>
                <input type="text" value={form.ua_notes} onChange={e => setForm(f => ({ ...f, ua_notes: e.target.value }))} placeholder="e.g. UA required on return" /></div>
              <div className="field"><label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} /></div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Pass'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
