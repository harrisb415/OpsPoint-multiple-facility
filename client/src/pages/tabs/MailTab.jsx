import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Mail as MailIcon, Inbox, CheckCircle, Plus, Printer, MoreHorizontal } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, Card, Dropdown, DropdownItem,
  Pagination,
  Modal, ModalHeader, ModalBody, ModalFooter, Alert,
} from 'flowbite-react'
import { Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from '../../components/table'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import PrintScopeModal from '../../components/PrintScopeModal.jsx'
import { openPrintWindow, fmtDateFriendly } from '../../utils/printLog.js'
import { initials } from '../../utils/ui.js'
import { ColoredAvatar, StatusBadge, FilterChip, useConfirm } from '../../components/ui.jsx'

const PAGE_SIZE = 30
const MAIL_BADGE = { pending: 'warning', approved: 'info', delivered: 'success' }
const MAIL_LABEL = { pending: 'Pending', approved: 'Approved', delivered: 'Delivered' }

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}

export default function MailTab() {
  const { data, loadData, openProfile } = useData()
  const { hasPerm } = usePermission()
  const canLog     = hasPerm('mail.log')
  const canApprove = hasPerm('mail.approve')
  const canDeliver = hasPerm('mail.deliver')
  const canDelete  = hasPerm('mail.delete')
  const { globalSearch = '' } = useOutletContext() || {}
  const confirm = useConfirm()

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
    if (!await confirm({ title: `Delete mail record for ${m.client_name}?`, confirmText: 'Delete', color: 'red' })) return
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
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Daily Ops</BreadcrumbItem>
            <BreadcrumbItem>Mail</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Mail Log</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Incoming mail and packages</p>
        </div>
        <div className="flex items-center gap-2">
          <Button color="light" onClick={() => mail.length && setPrintOpen(true)}><Printer className="w-4 h-4 mr-2" /> Print</Button>
          {canLog && <Button onClick={openModal}><Plus className="w-4 h-4 mr-2" /> Log Mail</Button>}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { label: 'Logged Today', value: loggedToday, sub: 'items', Icon: MailIcon, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
          { label: 'Pending', value: counts.pending, sub: 'awaiting approval', Icon: Inbox, tint: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-300' },
          { label: 'Delivered', value: counts.delivered, sub: 'completed', Icon: CheckCircle, tint: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300' },
        ].map(k => (
          <Card key={k.label}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">{k.label}</h3>
                <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{k.value}</p>
                <p className="mt-2 text-xs text-gray-400">{k.sub}</p>
              </div>
              <div className={`flex items-center justify-center rounded-lg w-11 h-11 ${k.tint}`}><k.Icon className="w-5 h-5" /></div>
            </div>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(f => (
            <FilterChip key={f.key} active={f.key === filter} onClick={() => { setFilter(f.key); setPage(0) }}>
              {f.label} ({counts[f.key]})
            </FilterChip>
          ))}
        </div>
        <span className="text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {/* Table */}
      <Table hoverable>
        <TableHead>
          <TableRow>
            <TableHeadCell>Recipient</TableHeadCell>
            <TableHeadCell>Type</TableHeadCell>
            <TableHeadCell>Logged By</TableHeadCell>
            <TableHeadCell>Time</TableHeadCell>
            <TableHeadCell>Status</TableHeadCell>
            <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
          </TableRow>
        </TableHead>
        <TableBody className="divide-y">
          {paged.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-sm text-center text-gray-400">No mail records{filter !== 'all' ? ` with status "${filter}"` : ''}.</TableCell></TableRow>
          ) : paged.map(m => (
            <TableRow key={m.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
              <TableCell>
                <div className="flex items-center gap-3">
                  <ColoredAvatar name={m.client_name} photo={(data.clients || []).find(cl => cl.id === m.client_id)?.photo} />
                  <div>
                    {m.client_id
                      ? <button onClick={() => openProfile(m.client_id)} className="text-sm font-semibold text-left text-gray-900 dark:text-white hover:text-primary-700 hover:underline">{m.client_name}</button>
                      : <p className="text-sm font-semibold text-gray-900 dark:text-white">{m.client_name}</p>}
                    <p className="font-mono text-xs text-gray-400">Rm {m.room}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>{(m.mail_type || '').split(',').filter(Boolean).map(t => t[0].toUpperCase() + t.slice(1)).join(', ') || '—'}</TableCell>
              <TableCell className="text-gray-500 dark:text-gray-400">{m.logged_by || '—'}</TableCell>
              <TableCell className="font-mono">{fmtDT(m.logged_at)}</TableCell>
              <TableCell><StatusBadge color={MAIL_BADGE[m.status] || 'gray'}>{MAIL_LABEL[m.status] || m.status}</StatusBadge></TableCell>
              <TableCell className="text-right">
                {(canApprove || canDeliver || canDelete) && (
                  <Dropdown arrowIcon={false} inline label={<MoreHorizontal className="w-4 h-4 text-gray-400" />}>
                    {canApprove && m.status === 'pending' && <DropdownItem onClick={() => approve(m)}>Approve</DropdownItem>}
                    {canDeliver && m.status === 'approved' && <DropdownItem className="text-green-700 dark:text-green-400" onClick={() => deliver(m)}>Deliver</DropdownItem>}
                    {canDelete && <DropdownItem className="text-red-600" onClick={() => del(m)}>Delete</DropdownItem>}
                  </Dropdown>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex justify-center mt-3">
          <Pagination currentPage={page + 1} totalPages={totalPages} onPageChange={pg => setPage(pg - 1)} />
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
        <Modal show size="lg" onClose={() => setModal(false)}>
          <ModalHeader>Log Incoming Mail</ModalHeader>
          <ModalBody>
              {error && <Alert color="failure" className="mb-3">{error}</Alert>}
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                Select one or more residents who received mail. Optionally add notes per resident.
              </p>
              <div className="max-h-80 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md">
                {activeClients.map(c => {
                  const sid = String(c.id)
                  const selected = selectedIds.includes(sid)
                  return (
                    <div key={c.id} className={`flex items-center gap-2.5 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700 ${selected ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-transparent'}`}>
                      <input type="checkbox" checked={selected} onChange={() => toggleClient(c.id)}
                        className="w-3.5 h-3.5 flex-shrink-0 accent-blue-600 cursor-pointer" />
                      <span className="text-sm font-semibold w-8 flex-shrink-0">Rm {c.room}</span>
                      <span className="text-sm flex-1">{c.name}</span>
                      {selected && (
                        <div className="flex items-center gap-2.5 flex-wrap">
                          {['letter', 'package'].map(t => {
                            const checked = !!(mailTypes[sid] || {})[t]
                            return (
                              <label key={t} className="flex items-center gap-1 text-xs font-semibold cursor-pointer capitalize select-none">
                                <input type="checkbox" checked={checked}
                                  onChange={() => setMailTypes(m => ({ ...m, [sid]: { ...(m[sid] || {}), [t]: !checked } }))}
                                  className="w-3 h-3 accent-blue-600 cursor-pointer" />
                                {t}
                              </label>
                            )
                          })}
                          <input type="text" placeholder="Notes (optional)"
                            value={notes[sid] || ''}
                            onChange={e => setNotes(n => ({ ...n, [sid]: e.target.value }))}
                            className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white w-[140px]" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {selectedIds.length > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  {selectedIds.length} resident{selectedIds.length !== 1 ? 's' : ''} selected
                </p>
              )}
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={submitLog} isProcessing={saving} disabled={saving}>Log Mail</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
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
