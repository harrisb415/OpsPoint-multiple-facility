import { useState, useMemo, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { FlaskConical, CheckCircle, XCircle, Plus, Printer, X } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, Card, Select, Checkbox, Label,
  TextInput, Modal, ModalHeader, ModalBody, ModalFooter, Alert,
} from 'flowbite-react'
import { Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from '../../components/table'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import ConductUAModal from '../../components/ConductUAModal.jsx'
import { openPrintWindow } from '../../utils/printLog.js'
import { initials } from '../../utils/ui.js'
import { Field, ColoredAvatar, StatusBadge, DeltaRow, FilterChip, useConfirm } from '../../components/ui.jsx'

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}

const RESULT_LABEL = { pending:'Pending', pass:'Negative', fail:'Positive', dilute:'Dilute', refused:'Refused', invalid:'Invalid' }
const REASON_LABEL = {
  suspicious:       'Suspicion',
  random:           'Random',
  return_from_pass: 'Return from pass',
  cm_request:       'CM request',
  other:            'Other',
}
const RESULT_BADGE = { pending: 'gray', pass: 'success', fail: 'failure', dilute: 'warning', refused: 'failure', invalid: 'gray' }

// Small avatar + name cell used across the three tables.
function NameCell({ name, room, clientId, openProfile }) {
  return (
    <TableCell>
      <div className="flex items-center gap-3">
        <ColoredAvatar name={name} />
        <div>
          {clientId && openProfile
            ? <button onClick={() => openProfile(clientId)} className="text-sm font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 text-left">{name}</button>
            : <p className="text-sm font-semibold text-gray-900 dark:text-white">{name}</p>
          }
          <p className="font-mono text-xs text-gray-400">Rm {room}</p>
        </div>
      </div>
    </TableCell>
  )
}

export default function UARequestsTab() {
  const { data, loadData, openProfile } = useData()
  const { hasPerm } = usePermission()
  const canRequest = hasPerm('ua.request')
  const canAck     = hasPerm('ua.acknowledge')
  const canRecord  = hasPerm('ua.record')
  const canDelete  = hasPerm('ua.delete')
  const { globalSearch = '' } = useOutletContext() || {}
  const confirm = useConfirm()

  const uaRequests = data?.ua_requests || []
  const uaRecords  = data?.ua_records  || []
  const clients    = data?.clients     || []
  const panel      = data?.ua_panel    || []

  const [modal, setModal]       = useState(false)
  const [form, setForm]         = useState({ client_id: '', is_interview: false, interview_name: '' })
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)

  // Conduct UA modal (inline, styled like ReportTab UA modal)
  const [conductModal, setConductModal] = useState(null) // null | { req } | { clientId }

  // Sort/filter for records section
  const [filterClient, setFilterClient] = useState('')
  const [filterResult, setFilterResult] = useState('')
  const [sortRecords, setSortRecords] = useState('newest')

  const activeClients = useMemo(() =>
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [clients]
  )

  const pending     = uaRequests.filter(r => !r.acknowledged)
  const acknowledged = uaRequests.filter(r => r.acknowledged)

  const filteredRecords = useMemo(() => {
    const gq = globalSearch.toLowerCase().trim()
    let rows = [...uaRecords]
    if (filterClient) rows = rows.filter(r => String(r.client_id) === filterClient)
    if (filterResult) rows = rows.filter(r => r.result === filterResult)
    if (gq) rows = rows.filter(r => (r.client_name || '').toLowerCase().includes(gq) || String(r.room || '').includes(gq))
    if (sortRecords === 'oldest') rows.sort((a, b) => String(a.tested_at || '').localeCompare(String(b.tested_at || '')))
    else if (sortRecords === 'room') rows.sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0))
    else if (sortRecords === 'name') rows.sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''))
    else rows.sort((a, b) => String(b.tested_at || '').localeCompare(String(a.tested_at || '')))
    return rows
  }, [uaRecords, filterClient, filterResult, globalSearch, sortRecords])

  function openModal() {
    setForm({ client_id: '', is_interview: false, interview_name: '' })
    setError('')
    setModal(true)
  }

  async function submit() {
    if (!form.client_id) { setError('Select a resident.'); return }
    const c = clients.find(x => String(x.id) === String(form.client_id))
    setSaving(true); setError('')
    try {
      const r = await fetch('/api/ua-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          client_id: parseInt(form.client_id),
          client_name: c?.name || '',
          room: c?.room || '',
          is_interview: form.is_interview,
          interview_name: form.interview_name,
        }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Save failed'); return }
      setModal(false)
      await loadData()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  async function acknowledge(req) {
    await fetch(`/api/ua-requests/${req.id}/acknowledge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}',
    })
    await loadData()
  }

  async function dismissRequest(req) {
    if (!await confirm({ title: `Cancel the pending UA request for ${req.client_name}?`, confirmText: 'Cancel request', color: 'red' })) return
    await fetch(`/api/ua-requests/${req.id}`, { method: 'DELETE', credentials: 'include' })
    await loadData()
  }

  function printUARecords() {
    const facility = data?.facility_name || 'OpsPoint'
    const rows = filteredRecords.map(r => {
      const pr = r.panel_results || {}
      const posSubs = Object.entries(pr).filter(([, v]) => v === 'pos').map(([k]) => k)
      return {
        tested_at:    fmtDT(r.tested_at),
        room:         r.room || '—',
        name:         r.client_name || '—',
        reason:       REASON_LABEL[r.reason] || r.reason || '—',
        method:       r.collection_method
          ? r.collection_method.charAt(0).toUpperCase() + r.collection_method.slice(1)
          : '—',
        result:       r.result === 'fail' ? { badge: 'pos', label: 'POSITIVE' }
                    : r.result === 'pass' ? { badge: 'neg', label: 'NEGATIVE' }
                    : r.result || '—',
        substances:   posSubs.length > 0 ? 'POS: ' + posSubs.join(', ') : (r.result === 'pass' ? 'NEG all' : '—'),
        conducted_by: r.witnessed_by_name || '—',
        notes:        r.notes || '',
        _fail:        r.result === 'fail',
      }
    })
    const posCount = rows.filter(r => r._fail).length
    openPrintWindow({
      title: 'UA Drug Testing Records',
      facility,
      subtitle: [
        filterClient ? (activeClients.find(c => String(c.id) === filterClient)?.name || '') : 'All residents',
        filterResult ? (RESULT_LABEL[filterResult] || filterResult) : 'All results',
      ].filter(Boolean).join(' · '),
      summary: [
        ['Total records', filteredRecords.length],
        ['Positive',      posCount],
        ['Negative',      filteredRecords.filter(r => r.result === 'pass').length],
        ['Printed',       new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })],
      ],
      columns: [
        { key: 'tested_at',    label: 'Tested',       width: '130px', mono: true },
        { key: 'room',         label: 'Rm',            width: '40px' },
        { key: 'name',         label: 'Resident',      width: '140px' },
        { key: 'reason',       label: 'Reason',        width: '110px' },
        { key: 'method',       label: 'Method',        width: '90px' },
        { key: 'result',       label: 'Result',        width: '80px' },
        { key: 'substances',   label: 'Substances' },
        { key: 'conducted_by', label: 'Conducted By',  width: '120px' },
        { key: 'notes',        label: 'Notes' },
      ],
      rows,
      rowStyle: r => r._fail ? 'background:#fff5f5;' : '',
    })
  }

  async function delRecord(r) {
    if (!await confirm({ title: `Delete UA record for ${r.client_name}?`, body: 'This is audit-logged.', confirmText: 'Delete', color: 'red' })) return
    const res = await fetch(`/api/ua-records/${r.id}`, { method:'DELETE', credentials:'include' })
    if (!res.ok) { const j = await res.json().catch(()=>({})); alert(j.error||'Delete failed'); return }
    loadData()
  }

  const kpis = [
    { label: 'Pending Requests', value: pending.length, sub: 'awaiting collection', Icon: FlaskConical, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
    { label: 'Records', value: uaRecords.length, sub: 'on file', Icon: FlaskConical, tint: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300' },
    { label: 'Negative', value: uaRecords.filter(r => r.result === 'pass').length, sub: 'clear', Icon: CheckCircle, tint: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300' },
    { label: 'Positive', value: uaRecords.filter(r => r.result === 'fail').length, sub: 'flagged', Icon: XCircle, tint: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Health &amp; Compliance</BreadcrumbItem>
            <BreadcrumbItem>UA</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Urinalysis</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">UA requests, results, and chain-of-custody records</p>
        </div>
        <div className="flex items-center gap-2">
          <Button color="light" onClick={printUARecords}><Printer className="w-4 h-4 mr-2" /> Print</Button>
          {canRequest && <Button onClick={openModal}><Plus className="w-4 h-4 mr-2" /> Request UA</Button>}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-4">
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

      {/* Pending requests */}
      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Pending requests</h3>
      <div className="mb-6">
        <Table hoverable>
          <TableHead>
            <TableRow>
              <TableHeadCell>Resident</TableHeadCell>
              <TableHeadCell>Type</TableHeadCell>
              <TableHeadCell>Requested By</TableHeadCell>
              <TableHeadCell>Requested At</TableHeadCell>
              <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y">
            {pending.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-sm text-center text-gray-400">No pending UA requests.</TableCell></TableRow>
            ) : pending.map(req => (
              <TableRow key={req.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                <NameCell name={req.is_interview ? (req.interview_name || req.client_name) : req.client_name} room={req.room} />
                <TableCell><StatusBadge color={req.is_interview ? 'warning' : 'failure'}>{req.is_interview ? 'Pre-Intake' : 'UA Request'}</StatusBadge></TableCell>
                <TableCell className="text-gray-500 dark:text-gray-400">{req.requested_by || '—'}</TableCell>
                <TableCell className="font-mono">{fmtDT(req.requested_at)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                    {canRecord && <Button size="xs" onClick={() => setConductModal({ req })}>Conduct UA</Button>}
                    {canAck && <Button size="xs" color="light" onClick={() => acknowledge(req)}>Ack</Button>}
                    {(canAck || canRecord) && <Button size="xs" color="light" onClick={() => dismissRequest(req)} title="Cancel request"><X className="w-4 h-4" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {acknowledged.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Acknowledged</h3>
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Resident</TableHeadCell>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell>Requested By</TableHeadCell>
                <TableHeadCell>Requested At</TableHeadCell>
                <TableHeadCell>Acknowledged By</TableHeadCell>
                <TableHeadCell>Acknowledged At</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y">
              {acknowledged.slice(0, 20).map(req => (
                <TableRow key={req.id} className="bg-white opacity-70 dark:border-gray-700 dark:bg-gray-800">
                  <NameCell name={req.is_interview ? (req.interview_name || req.client_name) : req.client_name} room={req.room} />
                  <TableCell><StatusBadge color="gray">{req.is_interview ? 'Pre-Intake' : 'UA Request'}</StatusBadge></TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400">{req.requested_by || '—'}</TableCell>
                  <TableCell className="font-mono">{fmtDT(req.requested_at)}</TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400">{req.acknowledged_by || '—'}</TableCell>
                  <TableCell className="font-mono">{fmtDT(req.acknowledged_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* UA records */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">UA records</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Select sizing="sm" className="w-44" value={filterClient} onChange={e => setFilterClient(e.target.value)}>
            <option value="">All residents</option>
            {activeClients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
          </Select>
          <Select sizing="sm" className="w-36" value={filterResult} onChange={e => setFilterResult(e.target.value)}>
            <option value="">All results</option>
            {Object.entries(RESULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <span className="text-sm text-gray-400">{filteredRecords.length} records</span>
          {canRecord && <Button size="xs" onClick={() => setConductModal({ clientId: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> New UA</Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {[['newest','Newest First'],['oldest','Oldest First'],['room','By Room'],['name','By Name']].map(([v, l]) => (
          <FilterChip key={v} active={sortRecords === v} onClick={() => setSortRecords(v)}>{l}</FilterChip>
        ))}
      </div>
      <Table hoverable>
        <TableHead>
          <TableRow>
            <TableHeadCell>Resident</TableHeadCell>
            <TableHeadCell>Tested</TableHeadCell>
            <TableHeadCell>Reason</TableHeadCell>
            <TableHeadCell>Result</TableHeadCell>
            <TableHeadCell>Substances</TableHeadCell>
            <TableHeadCell>Observed By</TableHeadCell>
            <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
          </TableRow>
        </TableHead>
        <TableBody className="divide-y">
          {filteredRecords.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="text-sm text-center text-gray-400">No UA records on file. Use “Conduct UA” on a request, or “New UA”.</TableCell></TableRow>
          ) : filteredRecords.map(r => {
            const pr = r.panel_results || {}
            const posSubs = Object.entries(pr).filter(([, v]) => v === 'pos').map(([k]) => k)
            return (
              <TableRow key={r.id} className={r.result === 'fail' ? 'bg-red-50 dark:bg-red-900/20' : 'bg-white dark:border-gray-700 dark:bg-gray-800'}>
                <NameCell name={r.client_name} room={r.room} clientId={r.client_id} openProfile={openProfile} />
                <TableCell className="font-mono">{fmtDT(r.tested_at)}</TableCell>
                <TableCell className="text-gray-500 dark:text-gray-400">{REASON_LABEL[r.reason] || r.reason || '—'}</TableCell>
                <TableCell><StatusBadge color={RESULT_BADGE[r.result] || 'gray'}>{RESULT_LABEL[r.result] || r.result}</StatusBadge></TableCell>
                <TableCell className="text-gray-500 dark:text-gray-400">{posSubs.length > 0 ? <span className="font-semibold text-red-700 dark:text-red-400">POS: {posSubs.join(', ')}</span> : (r.result === 'pass' ? 'NEG all' : '—')}</TableCell>
                <TableCell className="text-gray-500 dark:text-gray-400">{r.witnessed_by_name || '—'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                    {canRecord && r.log_entry_id && <UAPhotoBtn logEntryId={r.log_entry_id} hasPhoto={!!r.has_log_photo} onSaved={loadData} />}
                    {canDelete && (r.locked_at
                      ? <span title="Locked (24h immutability)">🔒</span>
                      : <Button size="xs" color="light" onClick={() => delRecord(r)} title="Delete"><X className="w-4 h-4" /></Button>)}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* ── Request UA Modal ─────────────────────────────────────── */}
      {modal && (
        <Modal show size="md" onClose={() => setModal(false)}>
          <ModalHeader>Request UA</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {error && <Alert color="failure">{error}</Alert>}
              <Field label="Resident">
                <Select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                  <option value="">— Select resident —</option>
                  {activeClients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                </Select>
              </Field>
              <Label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.is_interview} onChange={e => setForm(f => ({ ...f, is_interview: e.target.checked }))} />
                Pre-Intake / Interview UA
              </Label>
              {form.is_interview && (
                <Field label="Interview Name (if different)">
                  <TextInput value={form.interview_name} placeholder="Optional" onChange={e => setForm(f => ({ ...f, interview_name: e.target.value }))} />
                </Field>
              )}
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={submit} isProcessing={saving} disabled={saving}>Submit Request</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* ── Conduct UA Modal ─────────────────────────────────────── */}
      {conductModal && (
        <ConductUAModal
          req={conductModal.req}
          clientId={conductModal.clientId}
          panel={panel}
          clients={activeClients}
          onClose={() => setConductModal(null)}
          onSaved={async () => { setConductModal(null); await loadData() }}
        />
      )}
    </div>
  )
}

// ── UA record photo button ─────────────────────────────────────────────
// Uses the linked log entry's photo (same photo the report's "📷 Photo" button manages).
// Only rendered when the UA record has a log_entry_id.
function UAPhotoBtn({ logEntryId, hasPhoto, onSaved }) {
  const fileRef   = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [photoSrc, setPhotoSrc]   = useState(null)
  const [showPhoto, setShowPhoto] = useState(false)

  async function handleFile(ev) {
    const file = ev.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader()
        rd.onload = () => res(rd.result)
        rd.onerror = rej
        rd.readAsDataURL(file)
      })
      const resp = await fetch(`/api/log/${logEntryId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ photo: b64 }),
      })
      if (resp.ok) onSaved?.()
    } catch { /* empty */ }
    setUploading(false)
    if (ev.target) ev.target.value = ''
  }

  async function handleView() {
    if (photoSrc) { setShowPhoto(true); return }
    try {
      const resp = await fetch(`/api/log/${logEntryId}/photo`, { credentials: 'include' })
      if (resp.ok) {
        const j = await resp.json()
        if (j.photo) { setPhotoSrc(j.photo); setShowPhoto(true) }
      }
    } catch { /* empty */ }
  }

  return (
    <>
      {hasPhoto
        ? <Button size="xs" color="light" onClick={handleView} title="View chain-of-custody photo">📷 View</Button>
        : <Button size="xs" color="light" onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach chain-of-custody photo">{uploading ? '⏳' : '📷 Photo'}</Button>
      }
      <input ref={fileRef} type="file" accept="image/*"
        className="hidden" onChange={handleFile} />
      {showPhoto && photoSrc && (
        <Modal show size="lg" onClose={() => setShowPhoto(false)}>
          <ModalHeader>Chain-of-custody photo</ModalHeader>
          <ModalBody>
            <img src={photoSrc} alt="UA chain-of-custody" className="block object-contain mx-auto rounded-lg max-h-[70vh]" />
          </ModalBody>
        </Modal>
      )}
    </>
  )
}
