import { useState, useMemo, useRef, useCallback } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

const PAGE_SIZE = 50

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function formatPhone(raw) {
  if (!raw) return ''
  const d = String(raw).replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

const BLANK_FORM = { room: '', name: '', case_manager: '', phone: '', intake_date: '', discharge_date: '' }
const BLANK_ADD  = { room: '', name: '', case_manager: '', phone: '', intake_date: todayStr() }

function blankAdd(vacantRooms) {
  return { room: vacantRooms[0] || '', name: '', case_manager: '', phone: '', intake_date: todayStr() }
}

export default function ClientsTab() {
  const { data, saveData } = useData()
  const { hasPerm } = usePermission()
  const canEdit = hasPerm('residents.edit')

  const [search, setSearch] = useState('')
  const [showDischarged, setShowDischarged] = useState(false)
  const [page, setPage] = useState(0)

  // Edit modal
  const [editModal, setEditModal] = useState(null) // null | client object
  const [editForm, setEditForm] = useState(BLANK_FORM)
  const [editPhoto, setEditPhoto] = useState(null) // base64 for pending new photo
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const photoRef = useRef(null)

  // Add client modal
  const [addModal, setAddModal]   = useState(false)
  const [addForm, setAddForm]     = useState(BLANK_ADD)
  const [addError, setAddError]   = useState('')
  const [addSaving, setAddSaving] = useState(false)

  // Photo popout
  const [photoPopout, setPhotoPopout] = useState(null) // null | { src, name }

  // Discharge modal
  const [dischargeModal, setDischargeModal] = useState(null) // null | client

  // Reactivate modal
  const [reactivateModal, setReactivateModal] = useState(null) // null | client
  const [reactRoom, setReactRoom]             = useState('')
  const [reactSaving, setReactSaving]         = useState(false)

  const clients = data?.clients || []

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return clients
      // Always include vacant + special rooms; only hide discharged residents unless toggled
      .filter(c => {
        if (c.is_special) return true
        if (c.name === 'VACANT') return true
        return showDischarged || c.is_active
      })
      .filter(c => {
        if (!q) return true
        return String(c.room).toLowerCase().includes(q)
          || c.name.toLowerCase().includes(q)
          || (c.special_label || '').toLowerCase().includes(q)
          || (c.case_manager || '').toLowerCase().includes(q)
          || (c.phone || '').toLowerCase().includes(q)
      })
      .slice()
      .sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0))
  }, [clients, search, showDischarged])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  async function saveAdd() {
    if (!addForm.name.trim()) { setAddError('Name is required.'); return }
    if (!addForm.room) { setAddError('Select a vacant room.'); return }
    setAddSaving(true); setAddError('')
    try {
      const r = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room: addForm.room.trim(),
          name: addForm.name.trim(),
          case_manager: addForm.case_manager,
          phone: addForm.phone,
          intake_date: addForm.intake_date || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) { setAddError(j.error || 'Save failed'); return }
      setAddModal(false); setAddForm(BLANK_ADD)
    } catch { setAddError('Network error') }
    finally { setAddSaving(false) }
  }

  function openEdit(c) {
    setEditForm({ room: c.room || '', name: c.name || '', case_manager: c.case_manager || '', phone: c.phone || '', intake_date: c.intake_date || '', discharge_date: c.discharge_date || '' })
    setEditPhoto(null)
    setEditError('')
    setEditModal(c)
  }

  async function saveEdit() {
    if (!editForm.name.trim()) { setEditError('Name is required.'); return }
    setEditSaving(true)
    setEditError('')
    try {
      const r = await fetch(`/api/clients/${editModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room: editForm.room,
          name: editForm.name.trim(),
          case_manager: editForm.case_manager,
          phone: editForm.phone,
          intake_date: editForm.intake_date || null,
          discharge_date: editForm.discharge_date || null,
          ...(editPhoto === 'REMOVE' ? { photo: null } : editPhoto ? { photo: editPhoto } : {}),
        }),
      })
      const j = await r.json()
      if (!r.ok) { setEditError(j.error || 'Save failed'); return }
      setEditModal(null)
    } catch { setEditError('Network error') }
    finally { setEditSaving(false) }
  }

  async function discharge(c) {
    const updated = clients.map(x => x.id === c.id ? { ...x, is_active: false, discharge_date: x.discharge_date || todayStr() } : x)
    await saveData({ clients: updated })
    setDischargeModal(null)
  }

  const vacantRooms = useMemo(
    () => clients.filter(c => c.is_active && c.name === 'VACANT').map(c => c.room).sort((a, b) => (parseInt(a)||0)-(parseInt(b)||0)),
    [clients]
  )

  function openReactivate(c) {
    setReactRoom(vacantRooms[0] || c.room || '')
    setReactivateModal(c)
  }

  async function confirmReactivate() {
    if (!reactivateModal) return
    setReactSaving(true)
    const targetRoom = String(reactRoom || reactivateModal.room)
    try {
      const r = await fetch(`/api/clients/${reactivateModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room: targetRoom,
          is_active: true,
          discharge_date: null,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        console.error('Reactivate failed:', j.error || r.status)
      }
    } catch (e) {
      console.error('Reactivate network error:', e)
    } finally {
      setReactivateModal(null)
      setReactSaving(false)
    }
  }

  const active = clients.filter(c => !c.is_special && c.is_active && c.name !== 'VACANT').length
  const vacant = clients.filter(c => !c.is_special && c.is_active && c.name === 'VACANT').length
  const special = clients.filter(c => c.is_special).length
  const discharged = clients.filter(c => !c.is_special && !c.is_active).length

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Clients</span></div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.75rem', color: '#94a3b8', fontFamily: 'var(--mono)' }}>
              {active} active · {vacant} vacant · {special} special · {discharged} discharged
            </span>
            {canEdit && (
              <button className="btn btn-sm btn-primary" onClick={() => { setAddForm(blankAdd(vacantRooms)); setAddError(''); setAddModal(true) }}>
                + Add Client
              </button>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '.78rem', color: '#94a3b8' }}>
              <input type="checkbox" checked={showDischarged} onChange={e => { setShowDischarged(e.target.checked); setPage(0) }} />
              Show discharged
            </label>
            <input type="text" placeholder="Search…" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
              style={{ fontSize: '.78rem', padding: '4px 10px', border: '1px solid rgba(255,255,255,.2)', borderRadius: 5, background: 'rgba(255,255,255,.1)', color: '#fff', outline: 'none', width: 160 }} />
          </div>
        </div>
        <div className="section-body" style={{ padding: 0 }}>
          {paged.length === 0 ? (
            <div className="empty-state">No clients found.</div>
          ) : (
            <>
              <div className="roster-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Rm</th>
                      <th>Name</th>
                      <th>Case Manager</th>
                      <th>Phone</th>
                      <th>Intake</th>
                      <th>Discharge</th>
                      <th>Status</th>
                      {canEdit && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map(c => {
                      const isVacant  = c.name === 'VACANT' && !c.is_special
                      const isSpecial = !!c.is_special
                      const rowStyle  = isVacant
                        ? { background: 'rgba(148,163,184,.06)' }
                        : isSpecial
                          ? { background: 'rgba(120,53,15,.05)' }
                          : undefined
                      return (
                      <tr key={c.id} className={!c.is_active ? 'drow' : ''} style={rowStyle}>
                        <td className="rm">{c.room}</td>
                        <td className="name-cell">
                          {isSpecial ? (
                            <>
                              <span style={{ marginRight: 8, fontSize: '1rem', verticalAlign: 'middle' }}>🏷️</span>
                              <span style={{ fontStyle: 'italic', color: '#78350f' }}>{c.special_label || c.name || 'Special Room'}</span>
                              <span style={{ marginLeft: 7, fontSize: '.62rem', fontWeight: 700, background: '#fed7aa', color: '#7c2d12', padding: '2px 6px', borderRadius: 10, textTransform: 'uppercase' }}>Special</span>
                            </>
                          ) : isVacant ? (
                            <>
                              <span style={{ display: 'inline-block', width: 28, height: 28, borderRadius: '50%', background: '#e2e8f0', marginRight: 8, verticalAlign: 'middle', textAlign: 'center', lineHeight: '28px', fontSize: '.85rem', color: '#94a3b8' }}>—</span>
                              <span style={{ fontStyle: 'italic', color: '#64748b' }}>Vacant</span>
                            </>
                          ) : (
                            <>
                              {c.photo && (
                                <img src={c.photo} alt=""
                                  onClick={() => setPhotoPopout({ src: c.photo, name: c.name })}
                                  style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: '50%',
                                    marginRight: 8, verticalAlign: 'middle', border: '1px solid var(--line)',
                                    cursor: 'pointer' }} />
                              )}
                              {c.name}
                              {!c.is_active && <span style={{ marginLeft: 7, fontSize: '.62rem', fontWeight: 700, background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 10, textTransform: 'uppercase' }}>Discharged</span>}
                            </>
                          )}
                        </td>
                        <td style={{ fontSize: '.84rem', color: (isVacant || isSpecial) ? '#cbd5e1' : undefined }}>{(isVacant || isSpecial) ? '—' : (c.case_manager || '—')}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: (isVacant || isSpecial) ? '#cbd5e1' : undefined }}>{(isVacant || isSpecial) ? '—' : (formatPhone(c.phone) || '—')}</td>
                        <td className="date-cell" style={{ color: (isVacant || isSpecial) ? '#cbd5e1' : undefined }}>{(isVacant || isSpecial) ? '—' : fmtDate(c.intake_date)}</td>
                        <td className="date-cell" style={{ color: (isVacant || isSpecial) ? '#cbd5e1' : undefined }}>{(isVacant || isSpecial) ? '—' : fmtDate(c.discharge_date)}</td>
                        <td>
                          {isSpecial ? (
                            <span style={{ fontSize: '.75rem', fontWeight: 700, color: '#92400e' }}>Special</span>
                          ) : isVacant ? (
                            <span style={{ fontSize: '.75rem', fontWeight: 700, color: '#64748b' }}>Vacant</span>
                          ) : (
                            <span style={{ fontSize: '.75rem', fontWeight: 700, color: c.is_active ? '#15803d' : '#94a3b8' }}>
                              {c.is_active ? 'Active' : 'Discharged'}
                            </span>
                          )}
                        </td>
                        {canEdit && (
                          <td>
                            <div style={{ display: 'flex', gap: 5, whiteSpace: 'nowrap' }}>
                              {isVacant ? (
                                <button className="btn btn-sm btn-primary"
                                  onClick={() => { setAddForm({ ...BLANK_ADD, room: c.room }); setAddError(''); setAddModal(true) }}>
                                  + Assign Client
                                </button>
                              ) : isSpecial ? (
                                <span style={{ fontSize: '.72rem', color: '#94a3b8', fontStyle: 'italic' }}>Manage in Facility Setup</span>
                              ) : (
                                <>
                                  <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)' }}
                                    onClick={() => openEdit(c)}>✎ Edit</button>
                                  {c.is_active
                                    ? <button className="btn-danger-sm" onClick={() => setDischargeModal(c)}>Discharge</button>
                                    : <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)' }}
                                        onClick={() => openReactivate(c)}>Reactivate</button>
                                  }
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', fontSize: '.82rem', borderTop: '1px solid var(--line)' }}>
                  <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
                  <span style={{ color: '#475569' }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                  <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }} disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setEditModal(null)}>
          <div className="modal">
            <div className="modal-head">
              <h2>Edit Client — Rm. {editModal.room}</h2>
              <button className="xbtn" onClick={() => setEditModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              {editError && <div className="auth-error">{editError}</div>}
              <div className="field">
                <label>Photo</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {(editPhoto && editPhoto !== 'REMOVE')
                    ? <img src={editPhoto} alt="Client photo"
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: '50%', border: '2px solid var(--line)', flexShrink: 0 }} />
                    : (editModal?.photo && editPhoto !== 'REMOVE')
                      ? <img src={editModal.photo} alt="Client photo"
                          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: '50%', border: '2px solid var(--line)', flexShrink: 0 }} />
                      : <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#e2e8f0',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '1.6rem', flexShrink: 0 }}>👤</div>
                  }
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button type="button" className="btn btn-sm"
                      onClick={() => photoRef.current?.click()}
                      style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)' }}>
                      📷 {((editModal?.photo && editPhoto !== 'REMOVE') || (editPhoto && editPhoto !== 'REMOVE')) ? 'Change Photo' : 'Add Photo'}
                    </button>
                    {((editPhoto && editPhoto !== 'REMOVE') || (editModal?.photo && editPhoto !== 'REMOVE')) && (
                      <button type="button" className="btn btn-sm"
                        onClick={() => setEditPhoto('REMOVE')}
                        style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626', fontSize: '.75rem' }}>
                        Remove
                      </button>
                    )}
                  </div>
                  <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={async ev => {
                      const file = ev.target.files?.[0]
                      if (!file) return
                      const b64 = await new Promise((res, rej) => {
                        const rd = new FileReader()
                        rd.onload = () => res(rd.result)
                        rd.onerror = rej
                        rd.readAsDataURL(file)
                      })
                      setEditPhoto(b64)
                      ev.target.value = ''
                    }} />
                </div>
              </div>
              <div className="field"><label>Room</label>
                <input type="text" value={editForm.room} onChange={e => setEditForm(f => ({ ...f, room: e.target.value }))} /></div>
              <div className="field"><label>Name</label>
                <input type="text" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="field"><label>Case Manager</label>
                <input type="text" value={editForm.case_manager} onChange={e => setEditForm(f => ({ ...f, case_manager: e.target.value }))} /></div>
              <div className="field"><label>Phone</label>
                <input type="text" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></div>
              <div className="field"><label>Intake Date</label>
                <input type="date" value={editForm.intake_date} onChange={e => setEditForm(f => ({ ...f, intake_date: e.target.value }))} /></div>
              <div className="field"><label>Discharge Date</label>
                <input type="date" value={editForm.discharge_date} onChange={e => setEditForm(f => ({ ...f, discharge_date: e.target.value }))} /></div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={editSaving}>{editSaving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Reactivate Modal */}
      {reactivateModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setReactivateModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <h2>Reactivate {reactivateModal.name}</h2>
              <button className="xbtn" onClick={() => setReactivateModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '.88rem', color: '#475569', marginBottom: 14 }}>
                Assign a room and reactivate <strong>{reactivateModal.name}</strong>.
              </p>
              <div className="field">
                <label>Room Assignment</label>
                {vacantRooms.length > 0 ? (
                  <select value={reactRoom} onChange={e => setReactRoom(e.target.value)}
                    style={{ fontFamily: 'var(--sans)', fontSize: '.9rem', padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none', width: '100%' }}>
                    {vacantRooms.map(r => (
                      <option key={r} value={r}>Room {r} (vacant)</option>
                    ))}
                    <option value={reactivateModal.room}>Room {reactivateModal.room} (previous)</option>
                  </select>
                ) : (
                  <div>
                    <p style={{ fontSize: '.8rem', color: '#C8500A', marginBottom: 6 }}>No VACANT rooms available. Enter room number manually:</p>
                    <input type="text" value={reactRoom} onChange={e => setReactRoom(e.target.value)}
                      placeholder="Room number" style={{ width: '100%', fontFamily: 'var(--sans)', fontSize: '.9rem', padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none' }} />
                  </div>
                )}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setReactivateModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmReactivate} disabled={reactSaving || !reactRoom}>
                {reactSaving ? 'Saving…' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Client Modal */}
      {addModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAddModal(false)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <h2>Add Client</h2>
              <button className="xbtn" onClick={() => setAddModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {addError && <div className="auth-error">{addError}</div>}
              <div className="field"><label>Room <span style={{ color: '#DC2626' }}>*</span></label>
                {vacantRooms.length > 0 ? (
                  <select value={addForm.room} autoFocus
                    onChange={e => setAddForm(f => ({ ...f, room: e.target.value }))}
                    style={{ fontFamily: 'var(--sans)', fontSize: '.9rem', padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none', width: '100%' }}>
                    {vacantRooms.map(r => <option key={r} value={r}>Room {r} (vacant)</option>)}
                  </select>
                ) : (
                  <div style={{ fontSize: '.84rem', color: '#C8500A', padding: '8px 0' }}>
                    No vacant rooms available. Add VACANT rooms via facility management first.
                  </div>
                )}
              </div>
              <div className="field"><label>Name <span style={{ color: '#DC2626' }}>*</span></label>
                <input type="text" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" /></div>
              <div className="field"><label>Case Manager <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
                <input type="text" value={addForm.case_manager} onChange={e => setAddForm(f => ({ ...f, case_manager: e.target.value }))} /></div>
              <div className="field"><label>Phone <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
                <input type="text" value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 555-5555" /></div>
              <div className="field"><label>Intake Date <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
                <input type="date" value={addForm.intake_date} onChange={e => setAddForm(f => ({ ...f, intake_date: e.target.value }))} /></div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAdd} disabled={addSaving}>{addSaving ? 'Saving…' : 'Add Client'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Popout */}
      {photoPopout && (
        <div className="modal-overlay open" onClick={() => setPhotoPopout(null)} style={{ zIndex: 2000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, maxWidth: '92vw',
            display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ fontWeight: 600, fontSize: '.9rem', color: '#0f172a' }}>{photoPopout.name}</span>
              <button className="xbtn" onClick={() => setPhotoPopout(null)}>&times;</button>
            </div>
            <img src={photoPopout.src} alt={photoPopout.name}
              style={{ maxWidth: '80vw', maxHeight: '70vh', objectFit: 'contain', borderRadius: 8 }} />
          </div>
        </div>
      )}

      {/* Discharge Modal */}
      {dischargeModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setDischargeModal(null)}>
          <div className="modal">
            <div className="modal-head">
              <h2>Discharge {dischargeModal.name}</h2>
              <button className="xbtn" onClick={() => setDischargeModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '.88rem', color: '#475569' }}>
                This will mark <strong>{dischargeModal.name}</strong> (Room {dischargeModal.room}) as discharged. Their record will be preserved in the archive.
              </p>
              <div className="field"><label>Discharge Date</label>
                <input type="date" defaultValue={todayStr()} id="dc-date" /></div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setDischargeModal(null)}>Cancel</button>
              <button className="btn btn-red" onClick={() => {
                const d = document.getElementById('dc-date')?.value || todayStr()
                discharge({ ...dischargeModal, discharge_date: d })
              }}>Discharge</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
