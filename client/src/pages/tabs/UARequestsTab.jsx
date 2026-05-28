import { useState, useMemo, useRef } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import ConductUAModal from '../../components/ConductUAModal.jsx'
import { openPrintWindow } from '../../utils/printLog.js'

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
  suspicious:       'Suspicious',
  random:           'Random',
  return_from_pass: 'Return from pass',
  cm_request:       'CM request',
  other:            'Other',
}

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
    let rows = [...uaRecords]
    if (filterClient) rows = rows.filter(r => String(r.client_id) === filterClient)
    if (filterResult) rows = rows.filter(r => r.result === filterResult)
    rows.sort((a, b) => {
      let cmp = 0
      if (recSortKey === 'tested_at') cmp = String(a.tested_at||'').localeCompare(String(b.tested_at||''))
      else if (recSortKey === 'room') cmp = (parseInt(a.room)||0)-(parseInt(b.room)||0)
      else if (recSortKey === 'result') cmp = String(a.result||'').localeCompare(String(b.result||''))
      return cmp * recSortDir
    })
    return rows
  }, [uaRecords, filterClient, filterResult, recSortKey, recSortDir])

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
      {/* ── Pending UA Requests ─────────────────────────────────── */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Pending UA Requests</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {pending.length > 0 && (
              <span style={{
                background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5',
                fontSize: '.73rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
              }}>
                {pending.length} pending
              </span>
            )}
            {canRequest && (
              <button className="btn btn-sm btn-primary" onClick={openModal}>+ Request UA</button>
            )}
          </div>
        </div>
        <div className="section-body" style={{ padding: 0 }}>
          {pending.length === 0 ? (
            <div className="empty-state">No pending UA requests.</div>
          ) : (
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rm</th><th>Name</th><th>Type</th>
                    <th>Requested By</th><th>Requested At</th>
                    {(canAck || canRecord) && <th className="tc">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {pending.map(req => (
                    <tr key={req.id}>
                      <td className="rm">{req.room}</td>
                      <td className="name-cell">{req.is_interview ? (req.interview_name || req.client_name) : req.client_name}</td>
                      <td>
                        <span style={{
                          fontSize: '.73rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                          background: req.is_interview ? '#fef3c7' : '#fee2e2',
                          color: req.is_interview ? '#92400e' : '#991b1b',
                          border: `1px solid ${req.is_interview ? '#fde68a' : '#fca5a5'}`,
                        }}>
                          {req.is_interview ? 'Pre-Intake' : 'UA Request'}
                        </span>
                      </td>
                      <td style={{ fontSize: '.82rem', color: '#475569' }}>{req.requested_by || '—'}</td>
                      <td className="date-cell">{fmtDT(req.requested_at)}</td>
                      {(canAck || canRecord) && (
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {canRecord && (
                            <button className="btn btn-sm btn-primary" style={{ marginRight: 4 }} onClick={() => setConductModal({ req })}>🧪 Conduct UA</button>
                          )}
                          {canAck && (
                            <button className="btn btn-sm btn-green" style={{ marginRight: 4 }} onClick={() => acknowledge(req)}>Acknowledge</button>
                          )}
                          {(canAck || canRecord) && (
                            <button className="btn-danger-sm" title="Cancel request" onClick={() => dismissRequest(req)}>✕</button>
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

      {/* ── Acknowledged ────────────────────────────────────────── */}
      {acknowledged.length > 0 && (
        <div className="section">
          <div className="section-head">
            <div className="sh-left"><span className="sh-dot" /><span>Acknowledged</span></div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>{acknowledged.length}</span>
          </div>
          <div className="section-body" style={{ padding: 0 }}>
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rm</th><th>Name</th><th>Type</th>
                    <th>Requested By</th><th>Requested At</th>
                    <th>Acknowledged By</th><th>Acknowledged At</th>
                  </tr>
                </thead>
                <tbody>
                  {acknowledged.slice(0, 20).map(req => (
                    <tr key={req.id} style={{ opacity: .7 }}>
                      <td className="rm">{req.room}</td>
                      <td className="name-cell">{req.is_interview ? (req.interview_name || req.client_name) : req.client_name}</td>
                      <td>
                        <span style={{
                          fontSize: '.73rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                          background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1',
                        }}>
                          {req.is_interview ? 'Pre-Intake' : 'UA Request'}
                        </span>
                      </td>
                      <td style={{ fontSize: '.82rem', color: '#475569' }}>{req.requested_by || '—'}</td>
                      <td className="date-cell">{fmtDT(req.requested_at)}</td>
                      <td style={{ fontSize: '.82rem', color: '#475569' }}>{req.acknowledged_by || '—'}</td>
                      <td className="date-cell">{fmtDT(req.acknowledged_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── UA Records (formal log) ────────────────────────────── */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>UA Records</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={filterClient} onChange={e=>setFilterClient(e.target.value)}
              style={{ fontSize: '.78rem', padding: '4px 8px' }}>
              <option value="">All residents</option>
              {activeClients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
            </select>
            <select value={filterResult} onChange={e=>setFilterResult(e.target.value)}
              style={{ fontSize: '.78rem', padding: '4px 8px' }}>
              <option value="">All results</option>
              {Object.entries(RESULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>
              {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''}
            </span>
            <button className="btn btn-sm" onClick={printUARecords}
              style={{ background:'#f1f5f9', color:'#475569', border:'1px solid #e2e8f0' }}>
              🖨 Print
            </button>
            {canRecord && (
              <button className="btn btn-sm btn-primary" onClick={() => setConductModal({ clientId: '' })}>+ New UA</button>
            )}
          </div>
        </div>
        <div className="section-body" style={{ padding: 0 }}>
          {filteredRecords.length === 0 ? (
            <div className="empty-state">No UA records on file. Click "Conduct UA" next to a request, or "+ New UA" to add one.</div>
          ) : (
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr>
                    <SortableTh label="Tested"   k="tested_at" curKey={recSortKey} dir={recSortDir} onSort={toggleRecSort} />
                    <SortableTh label="Rm"       k="room"      curKey={recSortKey} dir={recSortDir} onSort={toggleRecSort} />
                    <th>Resident</th>
                    <th>Reason</th>
                    <th>Method</th>
                    <SortableTh label="Result"   k="result"    curKey={recSortKey} dir={recSortDir} onSort={toggleRecSort} />
                    <th>Substances</th>
                    <th>Conducted By</th>
                    {canRecord && <th className="tc">Photo</th>}
                    {canDelete && <th className="tc">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map(r => {
                    const pr = r.panel_results || {}
                    const posSubs = Object.entries(pr).filter(([_, v]) => v === 'pos').map(([k]) => k)
                    return (
                      <tr key={r.id} style={{ background: r.result === 'fail' ? '#fff5f5' : 'transparent' }}>
                        <td className="date-cell">{fmtDT(r.tested_at)}</td>
                        <td className="rm">{r.room}</td>
                        <td className="name-cell">{r.client_name}</td>
                        <td style={{ fontSize: '.78rem', color: '#64748b' }}>{REASON_LABEL[r.reason] || r.reason || '—'}</td>
                        <td style={{ fontSize: '.82rem', color: '#475569' }}>{r.collection_method || '—'}</td>
                        <td><RecordResultBadge result={r.result}/></td>
                        <td style={{ fontSize: '.78rem', color: '#475569', maxWidth: 200 }}>
                          {posSubs.length > 0
                            ? <span style={{ color: '#991b1b', fontWeight: 700 }}>POS: {posSubs.join(', ')}</span>
                            : (r.result === 'pass' ? 'NEG all' : '—')}
                        </td>
                        <td style={{ fontSize: '.8rem', color: '#64748b' }}>{r.witnessed_by_name || '—'}</td>
                        {canRecord && (
                          <td style={{ textAlign: 'center' }}>
                            {r.log_entry_id
                              ? <UAPhotoBtn
                                  logEntryId={r.log_entry_id}
                                  hasPhoto={!!r.has_log_photo}
                                  onSaved={loadData}
                                />
                              : <span style={{ color:'#cbd5e1', fontSize:'.72rem' }}>—</span>
                            }
                          </td>
                        )}
                        {canDelete && (
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {r.locked_at
                              ? <span title="Locked (24h immutability)">🔒</span>
                              : <button className="btn-danger-sm" onClick={() => delRecord(r)} title="Delete">✕</button>}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
    } catch {}
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
    } catch {}
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

