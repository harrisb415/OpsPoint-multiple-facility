import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Mail as MailIcon, Inbox, CheckCircle, Plus, Printer, MoreHorizontal } from 'lucide-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import PrintScopeModal from '../../components/PrintScopeModal.jsx'
import { openPrintWindow, fmtDateFriendly } from '../../utils/printLog.js'
import { Header, Kpi, KpiRow, Toolbar, Table, NameCell, TextCell, MutedCell, MonoCell, BadgeCell, ActionsCell, rowCls } from '../../components/console.jsx'

const PAGE_SIZE = 30
const MAIL_TONE = { pending: 'yellow', approved: 'blue', delivered: 'green' }
const MAIL_LABEL = { pending: 'Pending', approved: 'Approved', delivered: 'Delivered' }

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
  const { globalSearch = '' } = useOutletContext() || {}

  const mail = data?.mail || []
  const clients = data?.clients || []

  const [filter, setFilter] = useState('all') // all | pending | approved | delivered
  const [menuId, setMenuId] = useState(null)
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
    const gq = globalSearch.toLowerCase().trim()
    let rows = [...mail]
    if (filter !== 'all') rows = rows.filter(m => m.status === filter)
    if (gq) rows = rows.filter(m => (m.client_name || '').toLowerCase().includes(gq) || String(m.room || '').includes(gq))
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
  }, [mail, filter, sortKey, sortDir, globalSearch])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const counts = useMemo(() => ({
    all: mail.length,
    pending: mail.filter(m => m.status === 'pending').length,
    approved: mail.filter(m => m.status === 'approved').length,
    delivered: mail.filter(m => m.status === 'delivered').length,
  }), [mail])
  const loggedToday = useMemo(() => { const t = new Date().toLocaleDateString('en-CA'); return mail.filter(m => (m.logged_at || '').slice(0, 10) === t).length }, [mail])

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
      <Header
        crumb={['Daily Ops', 'Mail']}
        title="Mail Log"
        sub="Incoming mail and packages"
        actions={[
          { Icon: Printer, label: 'Print', onClick: () => mail.length && setPrintOpen(true) },
          ...(canLog ? [{ Icon: Plus, label: 'Log Mail', primary: true, onClick: openModal }] : []),
        ]}
      />

      <KpiRow>
        <Kpi label="Logged Today" value={loggedToday} sub="items" Icon={MailIcon} accent="primary" />
        <Kpi label="Pending" value={counts.pending} sub="awaiting approval" Icon={Inbox} accent="yellow" />
        <Kpi label="Delivered" value={counts.delivered} sub="completed" Icon={CheckCircle} accent="green" />
      </KpiRow>

      <Toolbar
        filters={FILTERS.map(f => `${f.label} (${counts[f.key]})`)}
        active={Math.max(0, FILTERS.findIndex(f => f.key === filter))}
        onFilter={i => { setFilter(FILTERS[i].key); setPage(0) }}
        count={filtered.length}
      />

      <Table headers={[{ label: 'Recipient' }, { label: 'Type' }, { label: 'Logged By' }, { label: 'Time' }, { label: 'Status' }, { label: '', right: true }]}>
        {paged.length === 0 ? (
          <tr><td colSpan={6} className="p-8 text-sm text-center text-gray-400">No mail records{filter !== 'all' ? ` with status "${filter}"` : ''}.</td></tr>
        ) : paged.map((m, i) => (
          <tr key={m.id} className={rowCls(i)}>
            <NameCell name={m.client_name} sub={`Rm ${m.room}`} onClick={m.client_id ? () => openProfile(m.client_id) : undefined} />
            <TextCell>{(m.mail_type || '').split(',').filter(Boolean).map(t => t[0].toUpperCase() + t.slice(1)).join(', ') || '—'}</TextCell>
            <MutedCell>{m.logged_by || '—'}</MutedCell>
            <MonoCell>{fmtDT(m.logged_at)}</MonoCell>
            <BadgeCell tone={MAIL_TONE[m.status] || 'gray'} label={MAIL_LABEL[m.status] || m.status} />
            <ActionsCell>
              {(canApprove || canDeliver || canDelete) && (
                <div className="relative inline-block text-left">
                  <button onClick={() => setMenuId(menuId === m.id ? null : m.id)} className="p-1.5 text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"><MoreHorizontal className="w-4 h-4" /></button>
                  {menuId === m.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuId(null)} />
                      <div className="absolute right-0 z-50 w-40 p-1 mt-1 text-left bg-white border border-gray-200 shadow-lg rounded-lg dark:bg-gray-800 dark:border-gray-700">
                        {canApprove && m.status === 'pending' && <button onClick={() => { setMenuId(null); approve(m) }} className="block w-full px-3 py-2 text-sm text-left text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">Approve</button>}
                        {canDeliver && m.status === 'approved' && <button onClick={() => { setMenuId(null); deliver(m) }} className="block w-full px-3 py-2 text-sm text-left text-green-700 rounded-md hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30">Deliver</button>}
                        {canDelete && <button onClick={() => { setMenuId(null); del(m) }} className="block w-full px-3 py-2 text-sm text-left text-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30">Delete</button>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </ActionsCell>
          </tr>
        ))}
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center gap-3 mt-3">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">← Prev</button>
          <span className="text-sm text-gray-500 dark:text-gray-400 font-mono tabular-nums">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
          <button disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">Next →</button>
        </div>
      )}

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
