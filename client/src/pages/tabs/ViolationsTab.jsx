import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import PrintScopeModal from '../../components/PrintScopeModal.jsx'
import { openPrintWindow, fmtDateFriendly } from '../../utils/printLog.js'

function todayStr() { return new Date().toISOString().slice(0, 10) }

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}

function StatusBadge({ status }) {
  const cls = {
    pending:   'vbadge vbadge-pending',
    assigned:  'vbadge vbadge-assigned',
    waived:    'vbadge vbadge-waived',
    completed: 'vbadge vbadge-completed',
  }
  const labels = { pending: 'Pending Review', assigned: 'Consequence Assigned', waived: 'Waived', completed: 'Completed' }
  return <span className={cls[status] || 'vbadge vbadge-pending'}>{labels[status] || status}</span>
}

const BLANK = { client_id: '', client_name: '', room: '', violation_date: todayStr(), description: '', notes: '' }

export default function ViolationsTab() {
  const { data, loadData }      = useData()
  const { hasPerm }             = usePermission()

  const canLog      = hasPerm('violations.log')
  const canReview   = hasPerm('violations.review')
  const canComplete = hasPerm('violations.complete')
  const canDelete   = hasPerm('violations.delete')

  const clients = useMemo(() =>
    (data?.clients || [])
      .filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [data?.clients]
  )

  // State
  const [violations, setViolations] = useState([])
  const [loadedOnce, setLoadedOnce]   = useState(false)
  const [loadErr, setLoadErr]         = useState('')

  const [sort, setSort]               = useState('newest') // newest | oldest | room | most
  const [dateRange, setDateRange]     = useState('all')    // this_week | this_month | all
  const [clientFilter, setClientFilter] = useState('')
  const [viewMode, setViewMode]       = useState('list')   // list | by_client

  const [modal, setModal]             = useState(null)     // null | 'add' | {violation}
  const [reviewModal, setReviewModal] = useState(null)     // null | {violation}
  const [form, setForm]               = useState(BLANK)
  const [consequence, setConsequence] = useState('')
  const [waive, setWaive]             = useState(false)
  const [saving, setSaving]           = useState(false)
  const [err, setErr]                 = useState('')

  // Expanded rows for By Client view
  const [expanded, setExpanded]       = useState({})

  // Print modal
  const [printOpen, setPrintOpen]     = useState(false)

  // Load violations
  async function loadViolations() {
    try {
      const r = await fetch('/api/violations', { credentials: 'include' })
      if (!r.ok) throw new Error()
      const rows = await r.json()
      setViolations(rows)
      setLoadedOnce(true)
    } catch { setLoadErr('Failed to load violations') }
  }

  // Load on mount
  useMemo(() => { if (!loadedOnce) loadViolations() }, [loadedOnce])

  // Date range filter
  function inRange(v) {
    if (dateRange === 'all') return true
    const d = v?.violation_date || v?.logged_at?.slice(0, 10)
    if (!d) return false
    const now   = new Date()
    const dt    = new Date(d + 'T12:00:00')
    if (dateRange === 'this_week') {
      const dow   = now.getDay()
      const start = new Date(now); start.setDate(now.getDate() - dow); start.setHours(0,0,0,0)
      return dt >= start
    }
    if (dateRange === 'this_month') {
      return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth()
    }
    return true
  }

  const filtered = useMemo(() => {
    let rows = violations.filter(v => {
      if (clientFilter && String(v.client_id) !== clientFilter) return false
      return inRange(v)
    })
    if (sort === 'newest')      rows = [...rows].sort((a,b) => b.id - a.id)
    else if (sort === 'oldest') rows = [...rows].sort((a,b) => a.id - b.id)
    else if (sort === 'room')   rows = [...rows].sort((a,b) => (parseInt(a.room)||0) - (parseInt(b.room)||0))
    else if (sort === 'name')   rows = [...rows].sort((a,b) => String(a.client_name||'').localeCompare(String(b.client_name||'')))
    else if (sort === 'status') {
      const order = { pending: 0, assigned: 1, waived: 2, completed: 3 }
      rows = [...rows].sort((a,b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
    }
    return rows
  }, [violations, clientFilter, dateRange, sort])

  // By-client grouping
  const byClient = useMemo(() => {
    const map = {}
    violations.forEach(v => {
      if (!map[v.client_id]) map[v.client_id] = { id: v.client_id, name: v.client_name, room: v.room, rows: [] }
      map[v.client_id].rows.push(v)
    })
    return Object.values(map).sort((a,b) => {
      if (sort === 'most') return b.rows.length - a.rows.length
      return (parseInt(a.room)||0) - (parseInt(b.room)||0)
    })
  }, [violations, sort])

  // Add form
  function openAdd() {
    setForm({ ...BLANK, violation_date: todayStr() })
    setErr(''); setModal('add')
  }

  function handleClientSelect(cid) {
    const c = clients.find(x => String(x.id) === String(cid))
    setForm(f => ({ ...f, client_id: cid, client_name: c?.name || '', room: c?.room || '' }))
  }

  async function submitAdd() {
    if (!form.client_id) { setErr('Select a resident'); return }
    if (!form.description.trim()) { setErr('Description required'); return }
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/violations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          client_id:       parseInt(form.client_id),
          client_name:     form.client_name,
          room:            form.room,
          violation_date: form.violation_date,
          description:     form.description.trim(),
          notes:           form.notes,
        }),
      })
      if (!r.ok) { const j = await r.json(); setErr(j.error||'Save failed'); return }
      setModal(null); await loadViolations()
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  // Review (assign consequence or waive)
  function openReview(v) { setReviewModal(v); setConsequence(''); setWaive(false); setErr('') }

  async function submitReview() {
    if (!waive && !consequence.trim()) { setErr('Enter a consequence or choose Waive'); return }
    setSaving(true); setErr('')
    try {
      const r = await fetch(`/api/violations/${reviewModal.id}/review`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ consequence: waive ? '' : consequence.trim(), waive }),
      })
      if (!r.ok) { const j = await r.json(); setErr(j.error||'Save failed'); return }
      setReviewModal(null); await loadViolations()
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  async function markComplete(v) {
    if (!window.confirm(`Mark consequence completed for ${v.client_name}?`)) return
    await fetch(`/api/violations/${v.id}/complete`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}'
    })
    await loadViolations()
  }

  async function del(v) {
    if (!window.confirm(`Permanently delete this violation record for ${v.client_name}?`)) return
    await fetch(`/api/violations/${v.id}`, { method: 'DELETE', credentials: 'include' })
    await loadViolations()
  }

  // Unique clients in current violation list (for filter dropdown)
  const clientOptions = useMemo(() => {
    const seen = new Map()
    violations.forEach(v => { if (!seen.has(v.client_id)) seen.set(v.client_id, { id: v.client_id, name: v.client_name, room: v.room }) })
    return [...seen.values()].sort((a,b) => (parseInt(a.room)||0) - (parseInt(b.room)||0))
  }, [violations])

  if (loadErr) return <div className="empty-state" style={{ color: '#DC2626' }}>{loadErr}</div>

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Violations</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>{violations.length} total</span>
            <button onClick={() => setPrintOpen(true)} disabled={violations.length === 0}
              title="Print violations log"
              style={{
                fontSize: '.72rem', padding: '4px 10px',
                background: '#f1f5f9', border: '1px solid var(--border-light)',
                color: 'var(--text-muted)', borderRadius: 5, cursor: violations.length ? 'pointer' : 'not-allowed',
                fontWeight: 600, opacity: violations.length ? 1 : .5,
              }}>
              Print
            </button>
            {canLog && <button className="btn btn-sm btn-primary" onClick={openAdd}>+ Log Violation</button>}
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* View mode */}
          <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
            {['list','by_client'].map(m => (
              <button key={m} onClick={() => setViewMode(m)} style={{
                padding: '4px 12px', fontSize: '.76rem', fontWeight: 700, border: 'none', cursor: 'pointer',
                background: viewMode === m ? 'var(--crimson)' : 'transparent',
                color: viewMode === m ? '#fff' : 'var(--steel)',
              }}>{m === 'list' ? 'List' : 'By Client'}</button>
            ))}
          </div>

          {/* Sort */}
          <select value={sort} onChange={e => setSort(e.target.value)}
            style={{ padding: '4px 8px', fontSize: '.78rem', border: '1.5px solid var(--line)', borderRadius: 5 }}>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="room">By Room</option>
            <option value="name">By Name</option>
            <option value="status">By Status</option>
            {viewMode === 'by_client' && <option value="most">Most Violations</option>}
          </select>

          {/* Date range */}
          <select value={dateRange} onChange={e => setDateRange(e.target.value)}
            style={{ padding: '4px 8px', fontSize: '.78rem', border: '1.5px solid var(--line)', borderRadius: 5 }}>
            <option value="all">All Time</option>
            <option value="this_month">This Month</option>
            <option value="this_week">This Week</option>
          </select>

          {/* Client filter */}
          <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
            style={{ padding: '4px 8px', fontSize: '.78rem', border: '1.5px solid var(--line)', borderRadius: 5 }}>
            <option value="">All Residents</option>
            {clientOptions.map(c => (
              <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>
            ))}
          </select>
        </div>

        <div className="section-body" style={{ padding: 0 }}>
          {/* LIST VIEW */}
          {viewMode === 'list' && (
            filtered.length === 0
              ? <div className="empty-state">No violations found.</div>
              : (
                <div className="roster-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Rm</th><th>Name</th><th>Date</th>
                        <th>Description</th><th>Status</th>
                        <th>Consequence</th><th>Logged By</th>
                        {(canReview || canComplete || canDelete) && <th className="tc">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(v => (
                        <ViolationRow
                          key={v.id} v={v}
                          canReview={canReview} canComplete={canComplete} canDelete={canDelete}
                          onReview={() => openReview(v)}
                          onComplete={() => markComplete(v)}
                          onDelete={() => del(v)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}

          {/* BY CLIENT VIEW */}
          {viewMode === 'by_client' && (
            byClient.length === 0
              ? <div className="empty-state">No violations found.</div>
              : byClient.map(cg => {
                const isExp = !!expanded[cg.id]
                const pending   = cg.rows.filter(v => v.status === 'pending').length
                const assigned  = cg.rows.filter(v => v.status === 'assigned').length
                const completed = cg.rows.filter(v => v.status === 'completed').length
                const waived    = cg.rows.filter(v => v.status === 'waived').length
                return (
                  <div key={cg.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', cursor: 'pointer',
                      background: isExp ? '#f8fafc' : '#fff',
                    }} onClick={() => setExpanded(e => ({ ...e, [cg.id]: !e[cg.id] }))}>
                      <span style={{ fontWeight: 700, fontSize: '.82rem', minWidth: 30 }}>Rm {cg.room}</span>
                      <span style={{ fontWeight: 600, flex: 1 }}>{cg.name}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: '#64748b' }}>{cg.rows.length} violation{cg.rows.length !== 1 ? 's' : ''}</span>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {pending > 0    && <span className="vbadge vbadge-pending">{pending} pending</span>}
                        {assigned > 0   && <span className="vbadge vbadge-assigned">{assigned} assigned</span>}
                        {completed > 0  && <span className="vbadge vbadge-completed">{completed} done</span>}
                        {waived > 0     && <span className="vbadge vbadge-waived">{waived} waived</span>}
                      </div>
                      <span style={{ color: '#94a3b8', fontSize: '.8rem' }}>{isExp ? '▲' : '▼'}</span>
                    </div>
                    {isExp && (
                      <div className="roster-wrap" style={{ margin: '0 14px 10px' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th><th>Description</th><th>Status</th>
                              <th>Consequence</th>
                              {(canReview || canComplete || canDelete) && <th className="tc">Actions</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {cg.rows.slice().sort((a,b) => b.id - a.id).map(v => (
                              <ViolationRow
                                key={v.id} v={v} compact
                                canReview={canReview} canComplete={canComplete} canDelete={canDelete}
                                onReview={() => openReview(v)}
                                onComplete={() => markComplete(v)}
                                onDelete={() => del(v)}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })
          )}
        </div>
      </div>

      {/* Add Modal */}
      {modal === 'add' && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-head">
              <h2>Log Violation</h2>
              <button className="xbtn" onClick={() => setModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              {err && <div className="auth-error">{err}</div>}
              <div className="field"><label>Resident</label>
                <select value={form.client_id} onChange={e => handleClientSelect(e.target.value)}>
                  <option value="">— Select resident —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Date</label>
                <input type="date" value={form.violation_date}
                  onChange={e => setForm(f => ({ ...f, violation_date: e.target.value }))} />
              </div>
              <div className="field"><label>Description / Behavior</label>
                <textarea rows={3} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the violation…"
                  style={{ resize: 'vertical', width: '100%' }} />
              </div>
              <div className="field"><label>Notes (optional)</label>
                <input type="text" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Additional context…" />
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitAdd} disabled={saving}>{saving ? 'Saving…' : 'Log Violation'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setReviewModal(null)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <h2>Review Violation — {reviewModal.client_name}</h2>
              <button className="xbtn" onClick={() => setReviewModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              {err && <div className="auth-error">{err}</div>}
              <div style={{ background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginBottom: 14 }}>
                <div style={{ fontSize: '.78rem', color: '#64748b', marginBottom: 4 }}>
                  {fmtDate(reviewModal.violation_date)} · Rm. {reviewModal.room}
                </div>
                <div style={{ fontSize: '.88rem', fontWeight: 600 }}>{reviewModal.description}</div>
                {reviewModal.notes && <div style={{ fontSize: '.8rem', color: '#475569', marginTop: 4 }}>{reviewModal.notes}</div>}
              </div>
              <div onClick={() => setWaive(v => !v)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                background: waive ? '#fef9c3' : '#f8fafc',
                border: `1.5px solid ${waive ? '#fde047' : 'var(--line)'}`,
                borderRadius: 8, cursor: 'pointer', userSelect: 'none',
              }}>
                <input type="checkbox" checked={waive} onChange={() => {}}
                  style={{ pointerEvents: 'none', accentColor: '#b45309', flexShrink: 0, width: 16, height: 16 }} />
                <span style={{ fontSize: '.84rem', fontWeight: waive ? 700 : 400, color: waive ? '#854d0e' : '#475569' }}>
                  Waive — No Consequence
                </span>
              </div>
              {!waive && (
                <div className="field" style={{ marginTop: 12 }}>
                  <label>Consequence</label>
                  <textarea rows={3} value={consequence}
                    onChange={e => setConsequence(e.target.value)}
                    placeholder="Describe the assigned consequence…"
                    style={{ resize: 'vertical', width: '100%' }} />
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setReviewModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitReview} disabled={saving}>{saving ? 'Saving…' : waive ? 'Waive' : 'Assign Consequence'}</button>
            </div>
          </div>
        </div>
      )}

      <PrintScopeModal
        open={printOpen}
        title="Print Violations Log"
        shiftLabel="Current filter view"
        defaultMode="range"
        onClose={() => setPrintOpen(false)}
        onConfirm={({ mode, startDate, endDate }) => {
          setPrintOpen(false)
          const facility = data?.facility_name || 'OpsPoint'
          let rows = filtered
          let subtitle = ''
          if (mode === 'shift') {
            subtitle = `Current filters · ${rows.length} records`
          } else {
            rows = rows.filter(v => {
              const d = v.violation_date || (v.logged_at || '').slice(0, 10)
              return d && d >= startDate && d <= endDate
            })
            subtitle = `${fmtDateFriendly(startDate)} – ${fmtDateFriendly(endDate)}  ·  ${rows.length} records`
          }
          printViolationsReport({ facility, subtitle, entries: rows })
        }}
      />
    </div>
  )
}

// ── Print report ──────────────────────────────────────────────────────
function printViolationsReport({ facility, subtitle, entries }) {
  const counts = { pending: 0, assigned: 0, waived: 0, completed: 0 }
  entries.forEach(v => { if (counts[v.status] !== undefined) counts[v.status]++ })

  const summary = [
    ['Total',     entries.length],
    ['Pending',   counts.pending],
    ['Assigned',  counts.assigned],
    ['Completed', counts.completed],
    ['Waived',    counts.waived],
  ]

  const columns = [
    { key: 'date',        label: 'Date',        width: '95px',  mono: true },
    { key: 'room',        label: 'Rm',          width: '50px',  mono: true, align: 'center' },
    { key: 'resident',    label: 'Resident',    width: '160px' },
    { key: 'description', label: 'Description' },
    { key: 'status',      label: 'Status',      width: '110px', align: 'center' },
    { key: 'consequence', label: 'Consequence', width: '180px' },
    { key: 'logged_by',   label: 'Logged By',   width: '110px' },
  ]

  const statusBadge = (s) => {
    if (s === 'completed') return { badge: 'neg', label: 'COMPLETED' }
    if (s === 'assigned')  return { badge: 'pending', label: 'ASSIGNED' }
    if (s === 'waived')    return { badge: 'pending', label: 'WAIVED' }
    if (s === 'pending')   return { badge: 'pending', label: 'PENDING' }
    return String(s || '—')
  }

  const fmt = (d) => {
    if (!d) return '—'
    try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
    catch { return d }
  }

  const rows = entries.map(v => ({
    date:        fmt(v.violation_date),
    room:        v.room || '—',
    resident:    v.client_name || '—',
    description: v.description || '',
    status:      statusBadge(v.status),
    consequence: v.consequence || (v.status === 'waived' ? 'Waived — no consequence' : '—'),
    logged_by:   v.logged_by || '—',
    _flag:       v.status === 'pending',
  }))

  openPrintWindow({
    title: 'Violations Log Report',
    facility,
    subtitle,
    summary,
    columns,
    rows,
    rowStyle: r => r._flag ? 'background:#fffbeb;' : '',
    emptyMessage: 'No violations in the selected scope.',
  })
}

function ViolationRow({ v, compact, canReview, canComplete, canDelete, onReview, onComplete, onDelete }) {
  return (
    <tr>
      {!compact && <td className="rm">{v.room}</td>}
      {!compact && <td className="name-cell">{v.client_name}</td>}
      <td className="date-cell">{fmtDate(v.violation_date)}</td>
      <td style={{ fontSize: '.84rem', maxWidth: 220 }}>{v.description}</td>
      <td><StatusBadge status={v.status} /></td>
      <td style={{ fontSize: '.82rem', color: '#475569', maxWidth: 180 }}>
        {v.consequence || (v.status === 'waived' ? '—' : '')}
        {v.consequence && v.consequence_by && (
          <div style={{ fontSize: '.7rem', color: '#94a3b8' }}>by {v.consequence_by}</div>
        )}
        {v.completed_at && (
          <div style={{ fontSize: '.7rem', color: '#15803d' }}>✓ {fmtDate(v.completed_at?.slice?.(0,10))}</div>
        )}
      </td>
      {!compact && <td style={{ fontSize: '.78rem', color: '#64748b' }}>{v.logged_by}</td>}
      {(canReview || canComplete || canDelete) && (
        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
          {canReview && v.status === 'pending' && (
            <button className="btn btn-sm btn-primary" style={{ marginRight: 4 }} onClick={onReview}>Review</button>
          )}
          {canComplete && v.status === 'assigned' && (
            <button className="btn btn-sm btn-green" style={{ marginRight: 4 }} onClick={onComplete}>Complete</button>
          )}
          {canDelete && (
            <button className="btn-danger-sm" onClick={onDelete}>✕</button>
          )}
        </td>
      )}
    </tr>
  )
}
