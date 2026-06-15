import { useState, useMemo, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { FlaskConical, CheckCircle, XCircle, Plus, Printer, MoreHorizontal } from 'lucide-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import ConductUAModal from '../../components/ConductUAModal.jsx'
import { openPrintWindow } from '../../utils/printLog.js'
import { Header, Kpi, KpiRow, Toolbar, Table, NameCell, TextCell, MutedCell, MonoCell, BadgeCell, ActionsCell, Badge, rowCls } from '../../components/console.jsx'

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
const RESULT_TONE = { pending: 'gray', pass: 'green', fail: 'red', dilute: 'yellow', refused: 'red', invalid: 'gray' }

function RecordResultBadge({ result }) {
  const styles = {
    pending: { bg:'#f1f5f9', color:'#475569', border:'#cbd5e1' },
    pass:    { bg:'#dcfce7', color:'#15803d', border:'#86efac' },
    fail:    { bg:'#fee2e2', color:'#991b1b', border:'#fca5a5' },
    dilute:  { bg:'#fef9c3', color:'#854d0e', border:'#fde047' },
    refused: { bg:'#fee2e2', color:'#991b1b', border:'#fca5a5' },
    invalid: { bg:'#f1f5f9', color:'#64748b', border:'#e2e8f0' },
  }
  const s = styles[result] || styles.pending
  return <span style={{ fontSize:'.72rem', fontWeight:700, padding:'2px 8px', borderRadius:10,
    background:s.bg, color:s.color, border:`1px solid ${s.border}` }}>{RESULT_LABEL[result]||result}</span>
}

export default function UARequestsTab() {
  const { data, loadData } = useData()
  const { hasPerm } = usePermission()
  const canRequest = hasPerm('ua.request')
  const canAck     = hasPerm('ua.acknowledge')
  const canRecord  = hasPerm('ua.record')
  const canDelete  = hasPerm('ua.delete')
  const { globalSearch = '' } = useOutletContext() || {}

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
  const [menuId, setMenuId] = useState(null)

  // Sort/filter for records section
  const [filterClient, setFilterClient] = useState('')
  const [filterResult, setFilterResult] = useState('')
  const [recSortKey, setRecSortKey]     = useState('tested_at')
  const [recSortDir, setRecSortDir]     = useState(-1)
  function toggleRecSort(k) {
    if (recSortKey === k) setRecSortDir(d => -d)
    else { setRecSortKey(k); setRecSortDir(-1) }
  }

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
    rows.sort((a, b) => {
      let cmp = 0
      if (recSortKey === 'tested_at') cmp = String(a.tested_at||'').localeCompare(String(b.tested_at||''))
      else if (recSortKey === 'room') cmp = (parseInt(a.room)||0)-(parseInt(b.room)||0)
      else if (recSortKey === 'result') cmp = String(a.result||'').localeCompare(String(b.result||''))
      return cmp * recSortDir
    })
    return rows
  }, [uaRecords, filterClient, filterResult, recSortKey, recSortDir, globalSearch])

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
    if (!window.confirm(`Cancel the pending UA request for ${req.client_name}?`)) return
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
    if (!window.confirm(`Delete UA record for ${r.client_name}? This is audit-logged.`)) return
    const res = await fetch(`/api/ua-records/${r.id}`, { method:'DELETE', credentials:'include' })
    if (!res.ok) { const j = await res.json().catch(()=>({})); alert(j.error||'Delete failed'); return }
    loadData()
  }

  return (
    <div>
      <Header
        crumb={['Health & Compliance', 'UA']}
        title="Urinalysis"
        sub="UA requests, results, and chain-of-custody records"
        actions={[
          { Icon: Printer, label: 'Print', onClick: printUARecords },
          ...(canRequest ? [{ Icon: Plus, label: 'Request UA', primary: true, onClick: openModal }] : []),
        ]}
      />

      <KpiRow>
        <Kpi label="Pending Requests" value={pending.length} sub="awaiting collection" Icon={FlaskConical} accent="primary" />
        <Kpi label="Records" value={uaRecords.length} sub="on file" Icon={FlaskConical} accent="sky" />
        <Kpi label="Negative" value={uaRecords.filter(r => r.result === 'pass').length} sub="clear" Icon={CheckCircle} accent="green" />
        <Kpi label="Positive" value={uaRecords.filter(r => r.result === 'fail').length} sub="flagged" Icon={XCircle} accent="red" />
      </KpiRow>

      {/* Pending requests */}
      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Pending requests</h3>
      <div className="mb-6">
        <Table headers={[{ label: 'Resident' }, { label: 'Type' }, { label: 'Requested By' }, { label: 'Requested At' }, { label: '', right: true }]}>
          {pending.length === 0 ? (
            <tr><td colSpan={5} className="p-8 text-sm text-center text-gray-400">No pending UA requests.</td></tr>
          ) : pending.map((req, i) => (
            <tr key={req.id} className={rowCls(i)}>
              <NameCell name={req.is_interview ? (req.interview_name || req.client_name) : req.client_name} sub={`Rm ${req.room}`} />
              <BadgeCell tone={req.is_interview ? 'yellow' : 'red'} label={req.is_interview ? 'Pre-Intake' : 'UA Request'} />
              <MutedCell>{req.requested_by || '—'}</MutedCell>
              <MonoCell>{fmtDT(req.requested_at)}</MonoCell>
              <ActionsCell>
                <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                  {canRecord && <button onClick={() => setConductModal({ req })} className="px-2.5 py-1 text-xs font-semibold text-white rounded-md bg-primary-600 hover:bg-primary-700">Conduct UA</button>}
                  {canAck && <button onClick={() => acknowledge(req)} className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">Ack</button>}
                  {(canAck || canRecord) && <button onClick={() => dismissRequest(req)} title="Cancel request" className="p-1.5 text-gray-400 rounded-md hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"><MoreHorizontal className="w-4 h-4" /></button>}
                </div>
              </ActionsCell>
            </tr>
          ))}
        </Table>
      </div>

      {acknowledged.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Acknowledged</h3>
          <Table headers={[{ label: 'Resident' }, { label: 'Type' }, { label: 'Requested By' }, { label: 'Requested At' }, { label: 'Acknowledged By' }, { label: 'Acknowledged At' }]}>
            {acknowledged.slice(0, 20).map((req, i) => (
              <tr key={req.id} className={`${rowCls(i)} opacity-70`}>
                <NameCell name={req.is_interview ? (req.interview_name || req.client_name) : req.client_name} sub={`Rm ${req.room}`} />
                <BadgeCell tone="gray" label={req.is_interview ? 'Pre-Intake' : 'UA Request'} />
                <MutedCell>{req.requested_by || '—'}</MutedCell>
                <MonoCell>{fmtDT(req.requested_at)}</MonoCell>
                <MutedCell>{req.acknowledged_by || '—'}</MutedCell>
                <MonoCell>{fmtDT(req.acknowledged_at)}</MonoCell>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {/* UA records */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">UA records</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select value={filterClient} onChange={e => setFilterClient(e.target.value)} className="px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
            <option value="">All residents</option>
            {activeClients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
          </select>
          <select value={filterResult} onChange={e => setFilterResult(e.target.value)} className="px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
            <option value="">All results</option>
            {Object.entries(RESULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="text-sm text-gray-400">{filteredRecords.length} records</span>
          {canRecord && <button onClick={() => setConductModal({ clientId: '' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary-600 hover:bg-primary-700"><Plus className="w-3.5 h-3.5" /> New UA</button>}
        </div>
      </div>
      <Table headers={[{ label: 'Resident' }, { label: 'Tested' }, { label: 'Reason' }, { label: 'Result' }, { label: 'Substances' }, { label: 'Observed By' }, { label: '', right: true }]}>
        {filteredRecords.length === 0 ? (
          <tr><td colSpan={7} className="p-8 text-sm text-center text-gray-400">No UA records on file. Use “Conduct UA” on a request, or “New UA”.</td></tr>
        ) : filteredRecords.map((r, i) => {
          const pr = r.panel_results || {}
          const posSubs = Object.entries(pr).filter(([, v]) => v === 'pos').map(([k]) => k)
          return (
            <tr key={r.id} className={r.result === 'fail' ? 'bg-red-50 dark:bg-red-900/20' : rowCls(i)}>
              <NameCell name={r.client_name} sub={`Rm ${r.room}`} />
              <MonoCell>{fmtDT(r.tested_at)}</MonoCell>
              <MutedCell>{REASON_LABEL[r.reason] || r.reason || '—'}</MutedCell>
              <BadgeCell tone={RESULT_TONE[r.result] || 'gray'} label={RESULT_LABEL[r.result] || r.result} />
              <MutedCell>{posSubs.length > 0 ? <span className="font-semibold text-red-700 dark:text-red-400">POS: {posSubs.join(', ')}</span> : (r.result === 'pass' ? 'NEG all' : '—')}</MutedCell>
              <MutedCell>{r.witnessed_by_name || '—'}</MutedCell>
              <ActionsCell>
                <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                  {canRecord && r.log_entry_id && <UAPhotoBtn logEntryId={r.log_entry_id} hasPhoto={!!r.has_log_photo} onSaved={loadData} />}
                  {canDelete && (r.locked_at
                    ? <span title="Locked (24h immutability)">🔒</span>
                    : <button onClick={() => delRecord(r)} title="Delete" className="p-1.5 text-gray-400 rounded-md hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"><MoreHorizontal className="w-4 h-4" /></button>)}
                </div>
              </ActionsCell>
            </tr>
          )
        })}
      </Table>

      {/* ── Request UA Modal ─────────────────────────────────────── */}
      {modal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <h2>Request UA</h2>
              <button className="xbtn" onClick={() => setModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {error && <div className="auth-error">{error}</div>}
              <div className="field"><label>Resident</label>
                <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                  <option value="">— Select resident —</option>
                  {activeClients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                </select>
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" id="ua-interview" checked={form.is_interview}
                  onChange={e => setForm(f => ({ ...f, is_interview: e.target.checked }))} />
                <label htmlFor="ua-interview" style={{ cursor: 'pointer' }}>Pre-Intake / Interview UA</label>
              </div>
              {form.is_interview && (
                <div className="field"><label>Interview Name (if different)</label>
                  <input type="text" value={form.interview_name} placeholder="Optional"
                    onChange={e => setForm(f => ({ ...f, interview_name: e.target.value }))} />
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Submit Request'}</button>
            </div>
          </div>
        </div>
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
        ? <button onClick={handleView} title="View chain-of-custody photo"
            style={{ fontSize:'.72rem', cursor:'pointer', background:'#eff6ff',
              border:'1px solid #bfdbfe', borderRadius:4, padding:'2px 7px',
              color:'#3b82f6', lineHeight:1.6 }}>
            📷 View
          </button>
        : <button onClick={() => fileRef.current?.click()} disabled={uploading}
            title="Attach chain-of-custody photo"
            style={{ fontSize:'.72rem', cursor: uploading ? 'not-allowed' : 'pointer',
              background:'none', border:'1px solid #e2e8f0', borderRadius:4,
              padding:'2px 7px', color:'#94a3b8', lineHeight:1.6 }}>
            {uploading ? '⏳' : '📷 Photo'}
          </button>
      }
      <input ref={fileRef} type="file" accept="image/*"
        style={{ display:'none' }} onChange={handleFile} />
      {showPhoto && photoSrc && (
        <div className="modal-overlay open" onClick={() => setShowPhoto(false)}
          style={{ zIndex:2000 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:16,
            maxWidth:'90vw', boxShadow:'0 25px 60px rgba(0,0,0,.4)' }}
            onClick={e => e.stopPropagation()}>
            <img src={photoSrc} alt="UA chain-of-custody"
              style={{ maxWidth:'100%', maxHeight:'80vh', display:'block', borderRadius:6 }} />
            <button onClick={() => setShowPhoto(false)}
              style={{ marginTop:10, background:'#f1f5f9', border:'1px solid #e2e8f0',
                borderRadius:6, padding:'6px 16px', cursor:'pointer', fontFamily:'var(--sans)' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
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
        position: 'relative',
        background: active ? 'rgba(217,119,6,.15)' : undefined,
      }}
      title={`Sort by ${label}`}
    >
      {label}
      {active && <span style={{ marginLeft: 4, fontSize: '.7rem' }}>{dir > 0 ? '↑' : '↓'}</span>}
    </th>
  )
}

