import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Ban, Flame, CheckCircle, Plus, Printer, MoreHorizontal } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, Card, Dropdown, DropdownItem, Select, Checkbox, Label,
  TextInput, Textarea, Modal, ModalHeader, ModalBody, ModalFooter, Alert,
} from 'flowbite-react'
import { Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from '../../components/table'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import PrintScopeModal from '../../components/PrintScopeModal.jsx'
import { openPrintWindow, fmtDateFriendly } from '../../utils/printLog.js'
import { Field, ColoredAvatar, StatusBadge, FilterChip, useConfirm } from '../../components/ui.jsx'

const CARD = 'p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 sm:p-5 dark:bg-gray-800'

function todayStr() { return new Date().toISOString().slice(0, 10) }

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function VioStatusBadge({ status }) {
  return <StatusBadge color={VIO_BADGE[status] || 'gray'}>{VIO_LABEL[status] || status}</StatusBadge>
}

const BLANK = { client_id: '', client_name: '', room: '', violation_date: todayStr(), description: '', notes: '' }
const VIO_BADGE = { pending: 'warning', assigned: 'info', waived: 'gray', completed: 'success' }
const VIO_LABEL = { pending: 'Pending Review', assigned: 'Consequence Assigned', waived: 'Waived', completed: 'Completed' }
const VIO_STATUS_KEYS = [null, 'pending', 'assigned', 'waived', 'completed']

export default function ViolationsTab() {
  const { data, openProfile }   = useData()
  const { hasPerm }             = usePermission()

  const canLog      = hasPerm('violations.log')
  const canReview   = hasPerm('violations.review')
  const canComplete = hasPerm('violations.complete')
  const canDelete   = hasPerm('violations.delete')
  const { globalSearch = '' } = useOutletContext() || {}
  const confirm = useConfirm()

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
  const [statusFilter, setStatusFilter] = useState(0)

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

  const preFiltered = useMemo(() => {
    const gq = globalSearch.toLowerCase().trim()
    const skey = VIO_STATUS_KEYS[statusFilter]
    return violations.filter(v => {
      if (clientFilter && String(v.client_id) !== clientFilter) return false
      if (skey && v.status !== skey) return false
      if (gq && !((v.client_name || '').toLowerCase().includes(gq) || String(v.room || '').includes(gq) || (v.description || '').toLowerCase().includes(gq))) return false
      return inRange(v)
    })
  }, [violations, clientFilter, dateRange, statusFilter, globalSearch])

  const filtered = useMemo(() => {
    let rows = [...preFiltered]
    if (sort === 'newest')      rows.sort((a,b) => b.id - a.id)
    else if (sort === 'oldest') rows.sort((a,b) => a.id - b.id)
    else if (sort === 'room')   rows.sort((a,b) => (parseInt(a.room)||0) - (parseInt(b.room)||0))
    else if (sort === 'name')   rows.sort((a,b) => String(a.client_name||'').localeCompare(String(b.client_name||'')))
    else if (sort === 'status') {
      const order = { pending: 0, assigned: 1, waived: 2, completed: 3 }
      rows.sort((a,b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
    }
    return rows
  }, [preFiltered, sort])

  // By-client grouping — uses preFiltered so status/date/client/search filters apply
  const byClient = useMemo(() => {
    const map = {}
    preFiltered.forEach(v => {
      if (!map[v.client_id]) map[v.client_id] = { id: v.client_id, name: v.client_name, room: v.room, rows: [] }
      map[v.client_id].rows.push(v)
    })
    return Object.values(map).sort((a,b) => {
      if (sort === 'most') return b.rows.length - a.rows.length
      return (parseInt(a.room)||0) - (parseInt(b.room)||0)
    })
  }, [preFiltered, sort])

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
    if (!await confirm({ title: `Mark consequence completed for ${v.client_name}?`, confirmText: 'Mark Complete' })) return
    await fetch(`/api/violations/${v.id}/complete`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}'
    })
    await loadViolations()
  }

  async function del(v) {
    if (!await confirm({ title: `Delete this violation record for ${v.client_name}?`, body: 'This cannot be undone.', confirmText: 'Delete', color: 'red' })) return
    await fetch(`/api/violations/${v.id}`, { method: 'DELETE', credentials: 'include' })
    await loadViolations()
  }

  // Unique clients in current violation list (for filter dropdown)
  const clientOptions = useMemo(() => {
    const seen = new Map()
    violations.forEach(v => { if (!seen.has(v.client_id)) seen.set(v.client_id, { id: v.client_id, name: v.client_name, room: v.room }) })
    return [...seen.values()].sort((a,b) => (parseInt(a.room)||0) - (parseInt(b.room)||0))
  }, [violations])

  if (loadErr) return <div className="py-10 text-center text-sm text-red-600 dark:text-red-400">{loadErr}</div>

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Records</BreadcrumbItem>
            <BreadcrumbItem>Infractions</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-gray-900 dark:text-white">Infractions</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">House rule infractions and actions taken</p>
        </div>
        <div className="flex items-center gap-2">
          <Button color="light" onClick={() => violations.length && setPrintOpen(true)}><Printer className="w-4 h-4 mr-2" /> Print</Button>
          {canLog && <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Log Infraction</Button>}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { label: 'Total', value: violations.length, sub: 'logged', Icon: Ban, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
          { label: 'Pending Review', value: violations.filter(v => v.status === 'pending').length, sub: 'awaiting review', Icon: Flame, tint: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
          { label: 'Resolved', value: violations.filter(v => v.status === 'completed' || v.status === 'waived').length, sub: 'completed or waived', Icon: CheckCircle, tint: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300' },
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
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {['All', 'Pending', 'Assigned', 'Waived', 'Completed'].map((f, i) => (
          <FilterChip key={f} active={i === statusFilter} onClick={() => setStatusFilter(i)}>{f}</FilterChip>
        ))}
        <span className="ml-auto text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {/* Secondary filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1">
          {['list', 'by_client'].map(m => (
            <FilterChip key={m} active={viewMode === m} onClick={() => setViewMode(m)}>{m === 'list' ? 'List' : 'By Client'}</FilterChip>
          ))}
        </div>
        <Select sizing="sm" className="w-40" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="room">By Room</option>
          <option value="name">By Name</option>
          <option value="status">By Status</option>
          {viewMode === 'by_client' && <option value="most">Most Violations</option>}
        </Select>
        <Select sizing="sm" className="w-36" value={dateRange} onChange={e => setDateRange(e.target.value)}>
          <option value="all">All Time</option>
          <option value="this_month">This Month</option>
          <option value="this_week">This Week</option>
        </Select>
        <Select sizing="sm" className="w-44" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
          <option value="">All Residents</option>
          {clientOptions.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
        </Select>
      </div>

      {/* LIST VIEW */}
      {viewMode === 'list' && (
        filtered.length === 0
          ? <div className={`${CARD} text-sm text-center text-gray-400`}>No violations found.</div>
          : (
            <Table hoverable>
              <TableHead>
                <TableRow>
                  <TableHeadCell>Resident</TableHeadCell>
                  <TableHeadCell>Date</TableHeadCell>
                  <TableHeadCell>Description</TableHeadCell>
                  <TableHeadCell>Status</TableHeadCell>
                  <TableHeadCell>Consequence</TableHeadCell>
                  <TableHeadCell>Logged By</TableHeadCell>
                  <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody className="divide-y">
                {filtered.map(v => (
                  <TableRow key={v.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <ColoredAvatar name={v.client_name} photo={(data.clients || []).find(cl => cl.id === v.client_id)?.photo} />
                        <div>
                          <button onClick={() => openProfile(v.client_id)} className="text-sm font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 text-left">{v.client_name}</button>
                          <p className="font-mono text-xs text-gray-400">Rm {v.room}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">{fmtDate(v.violation_date)}</TableCell>
                    <TableCell className="text-gray-500 dark:text-gray-400">{v.description}</TableCell>
                    <TableCell><StatusBadge color={VIO_BADGE[v.status] || 'gray'}>{VIO_LABEL[v.status] || v.status}</StatusBadge></TableCell>
                    <TableCell className="text-gray-500 dark:text-gray-400">{v.consequence || (v.status === 'waived' ? '—' : '')}{v.completed_at && <span className="block text-xs text-green-600 dark:text-green-400">✓ {fmtDate(v.completed_at?.slice?.(0, 10))}</span>}</TableCell>
                    <TableCell className="text-gray-500 dark:text-gray-400">{v.logged_by || '—'}</TableCell>
                    <TableCell className="text-right">
                      {(canReview || canComplete || canDelete) && (
                        <Dropdown arrowIcon={false} inline label={<MoreHorizontal className="w-4 h-4 text-gray-400" />}>
                          {canReview && v.status === 'pending' && <DropdownItem onClick={() => openReview(v)}>Review</DropdownItem>}
                          {canComplete && v.status === 'assigned' && <DropdownItem className="text-green-700 dark:text-green-400" onClick={() => markComplete(v)}>Mark Complete</DropdownItem>}
                          {canDelete && <DropdownItem className="text-red-600" onClick={() => del(v)}>Delete</DropdownItem>}
                        </Dropdown>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
      )}

      {/* BY CLIENT VIEW */}
      {viewMode === 'by_client' && (
        <div className={`${CARD} !p-0 overflow-hidden`}>
          {byClient.length === 0
            ? <div className="p-8 text-sm text-center text-gray-400">No violations found.</div>
            : byClient.map(cg => {
                const isExp = !!expanded[cg.id]
                const pending   = cg.rows.filter(v => v.status === 'pending').length
                const assigned  = cg.rows.filter(v => v.status === 'assigned').length
                const completed = cg.rows.filter(v => v.status === 'completed').length
                const waived    = cg.rows.filter(v => v.status === 'waived').length
                return (
                  <div key={cg.id} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
                    <div className={`flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer transition-colors ${isExp ? 'bg-gray-50 dark:bg-gray-700/50' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
                      onClick={() => setExpanded(e => ({ ...e, [cg.id]: !e[cg.id] }))}>
                      <span className="text-[0.82rem] font-bold min-w-[30px] text-gray-700 dark:text-gray-300">Rm {cg.room}</span>
                      <button onClick={e => { e.stopPropagation(); openProfile(cg.id) }} className="font-semibold flex-1 text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 text-left">{cg.name}</button>
                      <span className="font-mono text-[0.75rem] text-gray-500 dark:text-gray-400">{cg.rows.length} violation{cg.rows.length !== 1 ? 's' : ''}</span>
                      <div className="flex gap-1 flex-wrap">
                        {pending > 0    && <StatusBadge color="warning">{pending} pending</StatusBadge>}
                        {assigned > 0   && <StatusBadge color="info">{assigned} assigned</StatusBadge>}
                        {completed > 0  && <StatusBadge color="success">{completed} done</StatusBadge>}
                        {waived > 0     && <StatusBadge color="gray">{waived} waived</StatusBadge>}
                      </div>
                      <span className="text-gray-400 text-[0.8rem]">{isExp ? '▲' : '▼'}</span>
                    </div>
                    {isExp && (
                      <div className="overflow-x-auto mb-2.5">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                              <th className="px-3.5 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Date</th>
                              <th className="px-3.5 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Description</th>
                              <th className="px-3.5 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                              <th className="px-3.5 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Consequence</th>
                              {(canReview || canComplete || canDelete) && <th className="px-3.5 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400">Actions</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
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
          }
        </div>
      )}

      {/* Add Modal */}
      {modal === 'add' && (
        <Modal show size="lg" onClose={() => setModal(null)}>
          <ModalHeader>Log Violation</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {err && <Alert color="failure">{err}</Alert>}
              <Field label="Resident">
                <Select value={form.client_id} onChange={e => handleClientSelect(e.target.value)}>
                  <option value="">— Select resident —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                </Select>
              </Field>
              <Field label="Date"><TextInput type="date" value={form.violation_date} onChange={e => setForm(f => ({ ...f, violation_date: e.target.value }))} /></Field>
              <Field label="Description / Behavior"><Textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the violation…" /></Field>
              <Field label="Notes (optional)"><TextInput value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional context…" /></Field>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={submitAdd} isProcessing={saving} disabled={saving}>Log Violation</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Review Modal */}
      {reviewModal && (
        <Modal show size="md" onClose={() => setReviewModal(null)}>
          <ModalHeader>Review Violation — {reviewModal.client_name}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {err && <Alert color="failure">{err}</Alert>}
              <div className="p-3 border border-gray-200 rounded-lg bg-gray-50 dark:bg-gray-700/40 dark:border-gray-700">
                <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">{fmtDate(reviewModal.violation_date)} · Rm. {reviewModal.room}</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{reviewModal.description}</div>
                {reviewModal.notes && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{reviewModal.notes}</div>}
              </div>
              <Label className="flex items-center gap-2.5 p-2.5 text-sm border rounded-lg cursor-pointer border-gray-200 dark:border-gray-700">
                <Checkbox checked={waive} onChange={() => setWaive(v => !v)} />
                Waive — No Consequence
              </Label>
              {!waive && (
                <Field label="Consequence"><Textarea rows={3} value={consequence} onChange={e => setConsequence(e.target.value)} placeholder="Describe the assigned consequence…" /></Field>
              )}
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setReviewModal(null)}>Cancel</Button>
            <Button onClick={submitReview} isProcessing={saving} disabled={saving}>{waive ? 'Waive' : 'Assign Consequence'}</Button>
          </ModalFooter>
        </Modal>
      )}

      <PrintScopeModal
        open={printOpen}
        title="Print Infractions Log"
        shiftLabel="Current filter view"
        defaultMode="range"
        onClose={() => setPrintOpen(false)}
        onConfirm={({ mode, startDate, endDate }) => {
          setPrintOpen(false)
          const facility = data?.facility_name || 'OpsPoint'
          let rows = filtered
          let subtitle
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
    title: 'Infractions Log',
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
    <tr className="bg-white dark:bg-gray-800">
      {!compact && <td className="px-3.5 py-2 font-mono text-xs text-center text-gray-500 dark:text-gray-400">{v.room}</td>}
      {!compact && <td className="px-3.5 py-2 font-semibold text-sm text-gray-900 dark:text-white">{v.client_name}</td>}
      <td className="px-3.5 py-2 font-mono text-xs whitespace-nowrap text-gray-500 dark:text-gray-400">{fmtDate(v.violation_date)}</td>
      <td className="px-3.5 py-2 text-sm text-gray-700 dark:text-gray-300 max-w-[220px]">{v.description}</td>
      <td className="px-3.5 py-2"><VioStatusBadge status={v.status} /></td>
      <td className="px-3.5 py-2 text-sm text-gray-500 dark:text-gray-400 max-w-[180px]">
        {v.consequence || (v.status === 'waived' ? '—' : '')}
        {v.consequence && v.consequence_by && (
          <div className="text-[0.7rem] text-gray-400">by {v.consequence_by}</div>
        )}
        {v.completed_at && (
          <div className="text-[0.7rem] text-green-600 dark:text-green-400">✓ {fmtDate(v.completed_at?.slice?.(0,10))}</div>
        )}
      </td>
      {!compact && <td className="px-3.5 py-2 text-[0.78rem] text-gray-500 dark:text-gray-400">{v.logged_by}</td>}
      {(canReview || canComplete || canDelete) && (
        <td className="px-3.5 py-2 text-center whitespace-nowrap">
          {canReview && v.status === 'pending' && (
            <Button size="xs" className="mr-1" onClick={onReview}>Review</Button>
          )}
          {canComplete && v.status === 'assigned' && (
            <Button size="xs" color="success" className="mr-1" onClick={onComplete}>Complete</Button>
          )}
          {canDelete && (
            <Button size="xs" color="failure" onClick={onDelete}>✕</Button>
          )}
        </td>
      )}
    </tr>
  )
}
