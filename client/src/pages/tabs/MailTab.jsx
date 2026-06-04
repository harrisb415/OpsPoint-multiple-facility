import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import PrintScopeModal from '../../components/PrintScopeModal.jsx'
import { openPrintWindow, fmtDateFriendly } from '../../utils/printLog.js'

const PAGE_SIZE = 30

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}

function StatusBadge({ status }) {
  const cfg = {
    pending:   { bg: '#fef9c3', color: '#854d0e', border: '#fde047', label: 'Pending' },
    approved:  { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd', label: 'Approved' },
    delivered: { bg: '#dcfce7', color: '#15803d', border: '#86efac', label: 'Delivered' },
  }
  const s = cfg[status] || cfg.pending
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      fontSize: '.73rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

export default function MailTab() {
  const { data, loadData, openProfile } = useData()
  const { hasPerm } = usePermission()
  const canLog     = hasPerm('mail.log')
  const canApprove = hasPerm('mail.approve')
  const canDeliver = hasPerm('mail.deliver')
  const canDelete  = hasPerm('mail.delete')

  const mail = data?.mail || []
  const clients = data?.clients || []

  const [filter, setFilter] = useState('all') // all | pending | approved | delivered
  const [page, setPage] = useState(0)
  const [modal, setModal] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [notes, setNotes] = useState({}) // clientId → notes string
  const [mailTypes, setMailTypes] = useState({}) // clientId → {letter:bool, package:bool}
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Sort state
  const [sortKey, setSortKey] = useState('logged_at') // logged_at | room | name | status
  const [sortDir, setSortDir] = useState(-1)          // newest first
  function toggleSort(k) {
    if (sortKey === k) setSortDir(d => -d)
    else { setSortKey(k); setSortDir(k === 'logged_at' ? -1 : 1) }
  }

  // Print modal
  const [printOpen, setPrintOpen] = useState(false)

  const activeClients = useMemo(() =>
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [clients]
  )

  const filtered = useMemo(() => {
    let rows = [...mail]
    if (filter !== 'all') rows = rows.filter(m => m.status === filter)
    rows.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'logged_at') cmp = String(a.logged_at || '').localeCompare(String(b.logged_at || ''))
      else if (sortKey === 'room')   cmp = (parseInt(a.room) || 0) - (parseInt(b.room) || 0)
      else if (sortKey === 'name')   cmp = String(a.client_name || '').localeCompare(String(b.client_name || ''))
      else if (sortKey === 'status') {
        const order = { pending: 0, approved: 1, delivered: 2 }
        cmp = (order[a.status] ?? 9) - (order[b.status] ?? 9)
      }
      return cmp * sortDir
    })
    return rows
  }, [mail, filter, sortKey, sortDir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const counts = useMemo(() => ({
    all: mail.length,
    pending: mail.filter(m => m.status === 'pending').length,
    approved: mail.filter(m => m.status === 'approved').length,
    delivered: mail.filter(m => m.status === 'delivered').length,
  }), [mail])

  function toggleClient(id) {
    const sid = String(id)
    setSelectedIds(prev =>
      prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid]
    )
  }

  function openModal() {
    setSelectedIds([])
    setNotes({})
    setMailTypes({})
    setError('')
    setModal(true)
  }

  async function submitLog() {
    if (!selectedIds.length) { setError('Select at least one resident.'); return }
    setSaving(true); setError('')
    try {
      const clientsList = selectedIds.map(id => {
        const c = clients.find(x => String(x.id) === id)
        const t = mailTypes[id] || {}
        const typeArr = ['letter', 'package'].filter(k => t[k])
        return {
          client_id: parseInt(id),
          client_name: c?.name || '',
          room: c?.room || '',
          notes: notes[id] || '',
          mail_type: typeArr.join(','),
        }
      })
      const r = await fetch('/api/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clients: clientsList }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Save failed'); return }
      setModal(false)
      await loadData()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  async function approve(m) {
    await fetch(`/api/mail/${m.id}/approve`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}' })
    await loadData()
  }

  async function deliver(m) {
    await fetch(`/api/mail/${m.id}/deliver`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}' })
    await loadData()
  }

  async function del(m) {
    if (!window.confirm(`Delete mail record for ${m.client_name}?`)) return
    await fetch(`/api/mail/${m.id}`, { method: 'DELETE', credentials: 'include' })
    await loadData()
  }

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'delivered', label: 'Delivered' },
  ]

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Mail Log</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>{mail.length} total</span>
            <button onClick={() => setPrintOpen(true)} disabled={mail.length === 0}
              title="Print mail log"
              style={{
                fontSize: '.72rem', padding: '4px 10px',
                background: '#f1f5f9', border: '1px solid var(--border-light)',
                color: 'var(--text-muted)', borderRadius: 5, cursor: mail.length ? 'pointer' : 'not-allowed',
                fontWeight: 600, opacity: mail.length ? 1 : .5,
              }}>
              Print
            </button>
            {canLog && <button className="btn btn-sm btn-primary" onClick={openModal}>+ Log Mail</button>}
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => { setFilter(f.key); setPage(0) }}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: '.76rem', fontWeight: 700,
                border: '1.5px solid', cursor: 'pointer', transition: 'all .15s',
                borderColor: filter === f.key ? 'var(--crimson)' : 'var(--line)',
                background: filter === f.key ? 'var(--crimson)' : 'transparent',
                color: filter === f.key ? '#fff' : 'var(--steel)',
              }}>
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>

        <div className="section-body" style={{ padding: 0 }}>
          {paged.length === 0 ? (
            <div className="empty-state">No mail records{filter !== 'all' ? ` with status "${filter}"` : ''}.</div>
          ) : (
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr>
                    <SortableTh label="Rm"     k="room"      curKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Name"   k="name"      curKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Status" k="status"    curKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Logged" k="logged_at" curKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <th>By</th><th>Type</th><th>Notes</th>
                    {(canApprove || canDeliver || canDelete) && <th className="tc">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {paged.map(m => (
                    <tr key={m.id}>
                      <td className="rm">{m.room}</td>
                      <td className="name-cell">
                        {m.client_id ? (
                          <button onClick={() => openProfile(m.client_id)} style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'inherit', fontFamily:'inherit', fontSize:'inherit', fontWeight:'inherit', textDecoration:'underline', textDecorationStyle:'dotted', textDecorationColor:'rgba(27,47,110,.4)' }}>
                            {m.client_name}
                          </button>
                        ) : m.client_name}
                      </td>
                      <td><StatusBadge status={m.status} /></td>
                      <td className="date-cell">{fmtDT(m.logged_at)}</td>
                      <td style={{ fontSize: '.82rem', color: '#475569' }}>{m.logged_by || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {(m.mail_type || '').split(',').filter(Boolean).map(t => (
                          <span key={t} style={{
                            display: 'inline-block', marginRight: 3,
                            fontSize: '.72rem', fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                            background: t === 'package' ? '#fef3c7' : '#eff6ff',
                            color: t === 'package' ? '#92400e' : '#1e40af',
                            border: `1px solid ${t === 'package' ? '#fde68a' : '#bfdbfe'}`,
                            textTransform: 'capitalize',
                          }}>{t}</span>
                        ))}
                        {!(m.mail_type || '') && <span style={{ color: '#94a3b8', fontSize: '.78rem' }}>—</span>}
                      </td>
                      <td style={{ fontSize: '.82rem', color: '#475569', maxWidth: 200 }}>{m.notes || ''}</td>
                      {(canApprove || canDeliver || canDelete) && (
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {canApprove && m.status === 'pending' && (
                            <button className="btn btn-sm btn-primary" style={{ marginRight: 4 }} onClick={() => approve(m)}>Approve</button>
                          )}
                          {canDeliver && m.status === 'approved' && (
                            <button className="btn btn-sm btn-green" style={{ marginRight: 4 }} onClick={() => deliver(m)}>Deliver</button>
                          )}
                          {canDelete && (
                            <button className="btn-danger-sm" onClick={() => del(m)}>✕</button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', fontSize: '.82rem', borderTop: '1px solid var(--line)' }}>
              <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ color: '#475569' }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }} disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </div>
      </div>

      <PrintScopeModal
        open={printOpen}
        title="Print Mail Log"
        shiftLabel="All visible records"
        defaultMode="range"
        onClose={() => setPrintOpen(false)}
        onConfirm={({ mode, startDate, endDate }) => {
          setPrintOpen(false)
          const facility = data?.facility_name || 'OpsPoint'
          let entries = filtered
          let subtitle
          if (mode === 'shift') {
            // For mail, "shift" mode prints whatever's visible (matching the current filter view)
            subtitle = filter === 'all'
              ? `All filters · ${entries.length} records`
              : `Status: ${filter} · ${entries.length} records`
          } else {
            entries = entries.filter(m => {
              const d = (m.logged_at || '').slice(0, 10)
              return d >= startDate && d <= endDate
            })
            subtitle = `${fmtDateFriendly(startDate)} – ${fmtDateFriendly(endDate)}  ·  ${entries.length} records`
          }
          printMailLogReport({ facility, subtitle, entries })
        }}
      />

      {/* Log Mail Modal */}
      {modal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <h2>Log Incoming Mail</h2>
              <button className="xbtn" onClick={() => setModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {error && <div className="auth-error">{error}</div>}
              <p style={{ fontSize: '.84rem', color: '#475569', marginBottom: 12 }}>
                Select one or more residents who received mail. Optionally add notes per resident.
              </p>
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1.5px solid var(--line)', borderRadius: 6 }}>
                {activeClients.map(c => {
                  const sid = String(c.id)
                  const selected = selectedIds.includes(sid)
                  return (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 12px', borderBottom: '1px solid var(--line)',
                      background: selected ? '#eff6ff' : 'transparent',
                    }}>
                      <input type="checkbox" checked={selected} onChange={() => toggleClient(c.id)}
                        style={{ width: 15, height: 15, flexShrink: 0 }} />
                      <span style={{ fontSize: '.84rem', fontWeight: 600, minWidth: 32 }}>Rm {c.room}</span>
                      <span style={{ fontSize: '.84rem', flex: 1 }}>{c.name}</span>
                      {selected && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          {['letter', 'package'].map(t => {
                            const checked = !!(mailTypes[sid] || {})[t]
                            return (
                              <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', userSelect: 'none' }}>
                                <input type="checkbox" checked={checked}
                                  onChange={() => setMailTypes(m => ({ ...m, [sid]: { ...(m[sid] || {}), [t]: !checked } }))}
                                  style={{ width: 13, height: 13 }} />
                                {t}
                              </label>
                            )
                          })}
                          <input type="text" placeholder="Notes (optional)"
                            value={notes[sid] || ''}
                            onChange={e => setNotes(n => ({ ...n, [sid]: e.target.value }))}
                            style={{ fontSize: '.78rem', padding: '3px 8px', border: '1px solid var(--line)', borderRadius: 4, width: 140 }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {selectedIds.length > 0 && (
                <p style={{ fontSize: '.78rem', color: '#64748b', marginTop: 8 }}>
                  {selectedIds.length} resident{selectedIds.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitLog} disabled={saving}>{saving ? 'Saving…' : 'Log Mail'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sortable column header ────────────────────────────────────────────
function SortableTh({ label, k, curKey, dir, onSort, className }) {
  const active = curKey === k
  return (
    <th
      className={className}
      onClick={() => onSort(k)}
      style={{
        cursor: 'pointer', userSelect: 'none',
        background: active ? 'rgba(217,119,6,.15)' : undefined,
      }}
      title={`Sort by ${label}`}
    >
      {label}
      {active && <span style={{ marginLeft: 4, fontSize: '.7rem' }}>{dir > 0 ? '↑' : '↓'}</span>}
    </th>
  )
}

// ── Print report ──────────────────────────────────────────────────────
function printMailLogReport({ facility, subtitle, entries }) {
  const counts = { pending: 0, approved: 0, delivered: 0 }
  entries.forEach(m => { if (counts[m.status] !== undefined) counts[m.status]++ })

  const summary = [
    ['Total',     entries.length],
    ['Pending',   counts.pending],
    ['Approved',  counts.approved],
    ['Delivered', counts.delivered],
  ]

  const columns = [
    { key: 'logged',     label: 'Logged',     width: '125px', mono: true },
    { key: 'room',       label: 'Rm',         width: '50px',  mono: true, align: 'center' },
    { key: 'name',       label: 'Resident',   width: '170px' },
    { key: 'status',     label: 'Status',     width: '85px',  align: 'center' },
    { key: 'mail_type',  label: 'Type',       width: '100px' },
    { key: 'logged_by',  label: 'Logged By',  width: '120px' },
    { key: 'notes',      label: 'Notes' },
  ]

  const statusBadge = (s) => {
    if (s === 'delivered') return { badge: 'delivered' }
    if (s === 'approved')  return { badge: 'approved' }
    return { badge: 'pending' }
  }

  const fmt = (s) => {
    if (!s) return '—'
    try {
      const d = new Date(s)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    } catch { return s }
  }

  const rows = entries.map(m => ({
    logged:    fmt(m.logged_at),
    room:      m.room || '—',
    name:      m.client_name || '—',
    status:    statusBadge(m.status),
    mail_type: (m.mail_type || '').split(',').filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' + ') || '—',
    logged_by: m.logged_by || '—',
    notes:     m.notes || '',
  }))

  openPrintWindow({
    title: 'Mail Log Report',
    facility,
    subtitle,
    summary,
    columns,
    rows,
    emptyMessage: 'No mail records in the selected scope.',
  })
}
