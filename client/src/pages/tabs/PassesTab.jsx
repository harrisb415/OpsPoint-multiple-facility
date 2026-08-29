import { useState, useMemo, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, MoreHorizontal, Ticket, CalendarCheck, LogIn, LogOut, Clock } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, Card, Dropdown, DropdownItem,
  Pagination,
  Textarea, TextInput, Select, Modal, ModalHeader, ModalBody, ModalFooter, Alert,
} from 'flowbite-react'
import { Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from '../../components/table'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { CARD_HEAD_TITLE, CARD_HEAD_INSET_LG, CARD_HEAD_BAND } from '../../utils/ui.js'
import { Field, ErrLine, ColoredAvatar, StatusBadge, DeltaRow, useConfirm } from '../../components/ui.jsx'

const PAGE_SIZE = 25
const PASS_BADGE = { Approved: 'info', Out: 'warning', Extended: 'failure', In: 'success', Returned: 'gray' }

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}
function localDT(s) { if (!s) return ''; try { return new Date(s).toISOString().slice(0, 16) } catch { return '' } }

// How early a resident may be marked departed, relative to the scheduled time.
const EARLY_DEPART_MS = 10 * 60 * 1000

const BLANK_PASS = { client_id: '', room: '', name: '', departure: '', return_date: '', ua_notes: '', notes: '', status: 'Approved' }

export default function PassesTab() {
  const { data, openProfile, loadData } = useData()
  const { hasPerm } = usePermission()
  const canEdit   = hasPerm('passes.edit')
  const canStatus = hasPerm('passes.status') || canEdit
  const { globalSearch = '' } = useOutletContext() || {}
  const confirm = useConfirm()

  const passes = data?.passes || []
  const clients = data?.clients || []

  const [noticeText, setNoticeText] = useState(data?.pass_notice || '')
  const [noticeSaving, setNoticeSaving] = useState(false)
  const [retPage, setRetPage] = useState(0)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK_PASS)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Mark Departed stays disabled until shortly before the scheduled departure.
  // Residents routinely leave a few minutes early, so a hard gate on the exact
  // time just means staff can't log what actually happened; the grace window
  // keeps the log honest without letting a pass be opened hours ahead.
  // Ticking every 30s so a page left open enables the button on its own.
  // A pass with no departure time is unconstrained.
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  const departureAt = (p) => {
    if (!p.departure) return null
    const t = new Date(p.departure).getTime()
    return Number.isNaN(t) ? null : t
  }
  const canDepart = (p) => { const t = departureAt(p); return t === null || nowTs >= t - EARLY_DEPART_MS }
  // Earliest the button unlocks — used for the tooltip so the reason is exact.
  const departUnlockAt = (p) => { const t = departureAt(p); return t === null ? null : new Date(t - EARLY_DEPART_MS) }

  const gq = globalSearch.toLowerCase().trim()
  const pmatch = p => !gq || (p.name || '').toLowerCase().includes(gq) || String(p.room || '').includes(gq)
  // Three stages of the pass lifecycle. Approved passes are granted but the
  // resident is still on site, so they stay In Building; only Out/Extended
  // map onto the 'pass' status via passOverride.
  const approved = useMemo(() => passes.filter(p => p.status === 'Approved' && pmatch(p))
    .slice().sort((a, b) => (a.departure || '').localeCompare(b.departure || '')), [passes, gq])  // eslint-disable-line react-hooks/exhaustive-deps
  const active = useMemo(() => passes.filter(p => (p.status === 'Out' || p.status === 'Extended') && pmatch(p)), [passes, gq])  // eslint-disable-line react-hooks/exhaustive-deps
  const returned = useMemo(() => passes.filter(p => p.status === 'Returned' && pmatch(p))
    .slice().sort((a, b) => (b.return_date || '').localeCompare(a.return_date || '')), [passes, gq])  // eslint-disable-line react-hooks/exhaustive-deps
  const retPages = Math.ceil(returned.length / PAGE_SIZE)
  const retPaged = returned.slice(retPage * PAGE_SIZE, (retPage + 1) * PAGE_SIZE)

  const activeClients = useMemo(() =>
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [clients]
  )

  async function saveNotice() {
    setNoticeSaving(true)
    await fetch('/api/pass-notice', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ notice: noticeText }) })
    setNoticeSaving(false)
  }
  function openAdd() { setForm({ ...BLANK_PASS }); setError(''); setModal('add') }
  function openEdit(p) {
    setForm({ client_id: String(p.client_id || ''), room: p.room || '', name: p.name || '', departure: localDT(p.departure), return_date: localDT(p.return_date), ua_notes: p.ua_notes || '', notes: p.notes || '', status: p.status || 'Approved' })
    setError(''); setModal(p)
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
      const body = { client_id: form.client_id ? parseInt(form.client_id) : null, room: form.room, name: form.name.trim(), departure: form.departure || null, return_date: form.return_date || null, ua_notes: form.ua_notes, notes: form.notes, status: form.status }
      const r = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Save failed'); return }
      setModal(null)
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }
  // Send only the status. Spreading the whole pass also sent departure,
  // notes and so on, which the server counts as a details edit and rejects
  // for a user who has passes.status but not passes.edit.
  async function quickStatus(p, newStatus) {
    const r = await fetch(`/api/passes/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: newStatus }) })
    if (r.ok) loadData()
  }

  // Extend bundles the status with a new return date — the server treats that
  // pair as a status-level action and appends a note recording the change.
  const [extendFor, setExtendFor]   = useState(null)
  const [extendDate, setExtendDate] = useState('')
  const [extendErr, setExtendErr]   = useState('')
  function openExtend(p) {
    setExtendFor(p)
    setExtendDate(localDT(p.return_date))
    setExtendErr('')
  }
  async function submitExtend() {
    if (!extendDate) { setExtendErr('Pick a new return date and time.'); return }
    const prev = extendFor.return_date ? new Date(extendFor.return_date).getTime() : null
    if (prev !== null && new Date(extendDate).getTime() <= prev) {
      setExtendErr('The new return must be later than the current one.'); return
    }
    const r = await fetch(`/api/passes/${extendFor.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ status: 'Extended', return_date: extendDate }),
    })
    if (r.ok) { setExtendFor(null); loadData() }
    else { const d = await r.json().catch(() => ({})); setExtendErr(d.error || 'Could not extend this pass.') }
  }
  async function del(p) {
    if (!await confirm({ title: `Delete pass for ${p.name}?`, confirmText: 'Delete', color: 'red' })) return
    const r = await fetch(`/api/passes/${p.id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) loadData()
  }

  const notesOf = p => [p.ua_notes ? `UA: ${p.ua_notes}` : '', p.notes || ''].filter(Boolean).join(' · ') || '—'

  const NameCell = ({ p }) => (
    <TableCell>
      <div className="flex items-center gap-3">
        <ColoredAvatar name={p.name} photo={(data.clients || []).find(cl => cl.id === p.client_id)?.photo} />
        <div>
          {p.client_id
            ? <button onClick={() => openProfile(p.client_id)} className="text-sm font-semibold text-left text-gray-900 dark:text-white hover:text-primary-700 hover:underline">{p.name}</button>
            : <p className="text-sm font-semibold text-gray-900 dark:text-white">{p.name}</p>}
          <p className="font-mono text-xs text-gray-400">Rm {p.room}</p>
        </div>
      </div>
    </TableCell>
  )

  const RowMenu = ({ p }) => {
    if (!canEdit && !canStatus) return null
    return (
      <Dropdown arrowIcon={false} inline label={<MoreHorizontal className="w-4 h-4 text-gray-400" />}>
        {canEdit && <DropdownItem onClick={() => openEdit(p)}>Edit</DropdownItem>}
        {canStatus && p.status === 'Approved' && <DropdownItem disabled={!canDepart(p)} onClick={() => quickStatus(p, 'Out')}>Mark Departed</DropdownItem>}
        {canStatus && p.status !== 'Returned' && p.status !== 'Approved' && <DropdownItem className="text-green-700 dark:text-green-400" onClick={() => quickStatus(p, 'Returned')}>Mark Returned</DropdownItem>}
        {canStatus && (p.status === 'Out' || p.status === 'Extended') && <DropdownItem onClick={() => openExtend(p)}>Extend…</DropdownItem>}
        {canStatus && p.status === 'Returned' && <DropdownItem onClick={() => quickStatus(p, 'Out')}>Reopen as departed</DropdownItem>}
        {canEdit && <DropdownItem className="text-red-600" onClick={() => del(p)}>Delete</DropdownItem>}
      </Dropdown>
    )
  }

  const kpis = [
    { label: 'Approved', value: approved.length, sub: 'not departed yet', Icon: CalendarCheck, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
    { label: 'Active', value: active.length, sub: 'out on pass', Icon: Ticket, tint: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300' },

    { label: 'Returned', value: returned.length, sub: 'total', Icon: LogIn, tint: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Daily Ops</BreadcrumbItem>
            <BreadcrumbItem>Passes</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-gray-900 dark:text-white">Passes</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Active and recent resident passes</p>
        </div>
        {canEdit && <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> New Pass</Button>}
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map(k => (
          <Card key={k.label}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">{k.label}</h3>
                <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{k.value}</p>
                <p className="mt-2 text-xs text-gray-400">{k.sub}</p>
              </div>
              <div className={`flex items-center justify-center rounded-lg w-11 h-11 ${k.tint}`}><k.Icon className="w-5 h-5" /></div>
            </div>
            <DeltaRow delta={null} label="no prior data" />
          </Card>
        ))}
      </div>

      {/* Pass notice board */}
      <Card className="mb-4">
        <div className={CARD_HEAD_INSET_LG}>
          <h3 className={CARD_HEAD_TITLE}>Pass Notice Board</h3>
          {canEdit && <Button size="xs" onClick={saveNotice} isProcessing={noticeSaving} disabled={noticeSaving}>Save Notice</Button>}
        </div>
        <Textarea value={noticeText} onChange={e => setNoticeText(e.target.value)} rows={2} disabled={!canEdit}
          placeholder="Enter any pass-related notices for this weekend…" />
      </Card>

      {/* Approved — granted but still on site, so the resident stays In Building */}
      <div className={CARD_HEAD_BAND}>
        <h3 className={CARD_HEAD_TITLE}>Approved &mdash; not departed</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">{approved.length} waiting to leave</span>
      </div>
      <div className="mb-6">
        <Table hoverable>
          <TableHead>
            <TableRow>
              <TableHeadCell>Resident</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell>Departure</TableHeadCell>
              <TableHeadCell>Return</TableHeadCell>
              <TableHeadCell>Notes</TableHeadCell>
              <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y">
            {approved.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-sm text-center text-gray-400">No approved passes waiting.</TableCell></TableRow>
            ) : approved.map(p => (
              <TableRow key={p.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                <NameCell p={p} />
                <TableCell><StatusBadge color={PASS_BADGE[p.status] || 'gray'}>{p.status}</StatusBadge></TableCell>
                <TableCell className="font-mono">{fmtDT(p.departure)}</TableCell>
                <TableCell className="font-mono">{fmtDT(p.return_date)}</TableCell>
                <TableCell className="text-gray-500 dark:text-gray-400">{notesOf(p)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {canStatus && (
                      <Button size="xs" disabled={!canDepart(p)} onClick={() => quickStatus(p, 'Out')}
                        title={canDepart(p) ? 'Mark this resident as departed' : `Available from ${fmtDT(departUnlockAt(p))} (10 min before departure)`}>
                        <LogOut className="w-3.5 h-3.5 mr-1.5" /> Mark Departed
                      </Button>
                    )}
                    <RowMenu p={p} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Active passes */}
      <div className={CARD_HEAD_BAND}>
          <h3 className={CARD_HEAD_TITLE}>Active passes</h3>
        </div>
      <div className="mb-6">
        <Table hoverable>
          <TableHead>
            <TableRow>
              <TableHeadCell>Resident</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell>Departure</TableHeadCell>
              <TableHeadCell>Return</TableHeadCell>
              <TableHeadCell>Notes</TableHeadCell>
              <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y">
            {active.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-sm text-center text-gray-400">No active passes.</TableCell></TableRow>
            ) : active.map(p => (
              <TableRow key={p.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                <NameCell p={p} />
                <TableCell><StatusBadge color={PASS_BADGE[p.status] || 'gray'}>{p.status}</StatusBadge></TableCell>
                <TableCell className="font-mono">{fmtDT(p.departure)}</TableCell>
                <TableCell className="font-mono">{fmtDT(p.return_date)}</TableCell>
                <TableCell className="text-gray-500 dark:text-gray-400">{notesOf(p)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {canStatus && (
                      <Button size="xs" color="light" onClick={() => openExtend(p)}
                        title="Push the expected return back; the change is noted on the pass">
                        <Clock className="w-3.5 h-3.5 mr-1.5" /> Extend
                      </Button>
                    )}
                    {canStatus && (
                      <Button size="xs" color="light" onClick={() => quickStatus(p, 'Returned')}>
                        <LogIn className="w-3.5 h-3.5 mr-1.5" /> Mark Returned
                      </Button>
                    )}
                    <RowMenu p={p} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Returned passes */}
      {returned.length > 0 && (
        <>
          <div className={CARD_HEAD_BAND}>
          <h3 className={CARD_HEAD_TITLE}>Returned passes</h3>
        </div>
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Resident</TableHeadCell>
                <TableHeadCell>Departure</TableHeadCell>
                <TableHeadCell>Returned</TableHeadCell>
                <TableHeadCell>Notes</TableHeadCell>
                <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y">
              {retPaged.map(p => (
                <TableRow key={p.id} className="bg-white opacity-70 dark:border-gray-700 dark:bg-gray-800">
                  <NameCell p={p} />
                  <TableCell className="font-mono">{fmtDT(p.departure)}</TableCell>
                  <TableCell className="font-mono">{fmtDT(p.return_date)}</TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400">{p.notes || '—'}</TableCell>
                  <TableCell className="text-right">
                    {canEdit && <Button size="xs" color="light" onClick={() => del(p)}>Delete</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {retPages > 1 && (
            <div className="flex justify-center mt-3">
              <Pagination currentPage={retPage + 1} totalPages={retPages} onPageChange={pg => setRetPage(pg - 1)} />
            </div>
          )}
        </>
      )}

      {/* Extend — asks for the new return, server records the change on the pass */}
      {extendFor && (
        <Modal show size="md" onClose={() => setExtendFor(null)}>
          <ModalHeader>Extend Pass &mdash; {extendFor.name}</ModalHeader>
          <ModalBody>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Current return <span className="font-mono text-gray-700 dark:text-gray-200">{fmtDT(extendFor.return_date)}</span>.
              {' '}The pass is marked Extended and a note is added so the change is visible on the record.
            </p>
            <Field label="New expected return">
              <TextInput type="datetime-local" value={extendDate}
                onChange={e => { setExtendDate(e.target.value); setExtendErr('') }} />
            </Field>
            {extendErr && <ErrLine>{extendErr}</ErrLine>}
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setExtendFor(null)}>Cancel</Button>
            <Button onClick={submitExtend}>Extend Pass</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Add/Edit Modal */}
      {modal && (

        <Modal show size="lg" onClose={() => setModal(null)}>
          <ModalHeader>{modal === 'add' ? 'Add Weekend Pass' : `Edit Pass — ${modal.name}`}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {error && <Alert color="failure">{error}</Alert>}
              {modal === 'add' && (
                <Field label="Select Resident">
                  <Select value={form.client_id} onChange={e => handleClientSelect(e.target.value)}>
                    <option value="">— Select or type below —</option>
                    {activeClients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                  </Select>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Room"><TextInput value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))} /></Field>
                <Field label="Name"><TextInput value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
                <Field label="Departure"><TextInput type="datetime-local" value={form.departure} onChange={e => setForm(f => ({ ...f, departure: e.target.value }))} /></Field>
                <Field label="Expected Return"><TextInput type="datetime-local" value={form.return_date} onChange={e => setForm(f => ({ ...f, return_date: e.target.value }))} /></Field>
              </div>
              {/* Status is driven by the row actions (Mark Departed / Extend /
                  Mark Returned), so the dropdown is gone. It also offered "In",
                  which was never a valid status and was silently dropped on save. */}
              <Field label="UA Requirements / Notes"><TextInput value={form.ua_notes} onChange={e => setForm(f => ({ ...f, ua_notes: e.target.value }))} placeholder="e.g. UA required on return" /></Field>
              <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></Field>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={submit} isProcessing={saving} disabled={saving}>Save Pass</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
