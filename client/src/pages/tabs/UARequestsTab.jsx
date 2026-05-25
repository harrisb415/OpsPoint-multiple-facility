import { useState, useEffect, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import PrintScopeModal from '../../components/PrintScopeModal.jsx'
import { openPrintWindow, fmtDateFriendly } from '../../utils/printLog.js'

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return s }
}

// Parse a UA log entry text into structured fields
function parseUAText(text) {
  if (!text || !(/— UA:/i.test(text))) return null

  // Split at " — UA:" to get subject and results portion
  const dashIdx = text.search(/— UA:/i)
  const subject  = dashIdx > 0 ? text.slice(0, dashIdx).trim() : ''
  const after    = text.slice(dashIdx).replace(/^—\s*UA:\s*/i, '')

  // Split off "conducted by" at the end
  const byIdx = after.search(/ — by /i)
  const resultStr  = byIdx >= 0 ? after.slice(0, byIdx).trim() : after.trim()
  const conductedBy = byIdx >= 0 ? after.slice(byIdx).replace(/^ — by /i, '').trim() : ''

  // Determine overall result
  const isAllNeg = /^NEG all/i.test(resultStr)
  const hasPos   = /POS:/i.test(resultStr)

  // Extract POS substances
  const posMatch  = resultStr.match(/POS:\s*([^|]+)/i)
  const posSubst  = posMatch ? posMatch[1].trim() : ''

  // Parse subject room/name (format: "Name (Rm. 101)" or "Rm. 101 Name")
  let room = '', name = ''
  const rmParen = subject.match(/\(Rm\.?\s*(\S+)\)/)
  if (rmParen) {
    room = rmParen[1]
    name = subject.replace(/\(Rm\.?\s*\S+\)/, '').trim()
  } else {
    const rmFront = subject.match(/^Rm\.?\s*(\S+)\s+(.+)/)
    if (rmFront) { room = rmFront[1]; name = rmFront[2] }
    else name = subject
  }

  return {
    subject,
    name,
    room,
    resultStr,
    isAllNeg,
    hasPos,
    posSubst,
    conductedBy,
  }
}

function UAResultBadge({ parsed }) {
  if (!parsed) return null
  if (parsed.isAllNeg) return (
    <span style={{ fontSize: '.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>NEG</span>
  )
  if (parsed.hasPos) return (
    <span style={{ fontSize: '.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>POS</span>
  )
  return (
    <span style={{ fontSize: '.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}>UA</span>
  )
}

export default function UARequestsTab() {
  const { data, loadData } = useData()
  const { hasPerm } = usePermission()
  const canRequest = hasPerm('ua.request')
  const canAck = hasPerm('ua.acknowledge')

  const uaRequests = data?.ua_requests || []
  const clients = data?.clients || []

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ client_id: '', is_interview: false, interview_name: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // UA Log state
  const [uaLog, setUaLog] = useState([])
  const [logLoading, setLogLoading] = useState(true)
  const [logErr, setLogErr] = useState('')

  // Sort state for UA Log
  const [uaSortKey, setUaSortKey] = useState('date')  // 'date' | 'resident' | 'result' | 'room' | 'shift'
  const [uaSortDir, setUaSortDir] = useState(-1)      // most recent first by default
  function toggleUaSort(key) {
    if (uaSortKey === key) setUaSortDir(d => -d)
    else { setUaSortKey(key); setUaSortDir(key === 'date' ? -1 : 1) }
  }

  // Print modal state
  const [printOpen, setPrintOpen] = useState(false)

  const activeClients = useMemo(() =>
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [clients]
  )

  const pending = uaRequests.filter(r => !r.acknowledged)
  const acknowledged = uaRequests.filter(r => r.acknowledged)

  // Sorted UA log for display
  const sortedUaLog = useMemo(() => {
    if (!uaLog.length) return uaLog
    const withParsed = uaLog.map(e => ({ raw: e, parsed: parseUAText(e.text) }))
    withParsed.sort((a, b) => {
      const cmp = compareUa(a, b, uaSortKey) * uaSortDir
      if (cmp !== 0) return cmp
      // Tie-break: most recent first
      return (b.raw.report_date || '').localeCompare(a.raw.report_date || '')
    })
    return withParsed.map(x => x.raw)
  }, [uaLog, uaSortKey, uaSortDir])

  // Summary counts for the print report
  function uaSummary(entries) {
    let pos = 0, neg = 0, other = 0
    entries.forEach(e => {
      const p = parseUAText(e.text)
      if (p?.hasPos) pos++
      else if (p?.isAllNeg) neg++
      else other++
    })
    return { pos, neg, other }
  }

  // Load UA log on mount
  useEffect(() => {
    async function load() {
      setLogLoading(true); setLogErr('')
      try {
        const r = await fetch('/api/ua-log', { credentials: 'include' })
        if (!r.ok) throw new Error()
        setUaLog(await r.json())
      } catch { setLogErr('Failed to load UA log') }
      finally { setLogLoading(false) }
    }
    load()
  }, [])

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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}',
    })
    await loadData()
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
                    {canAck && <th className="tc">Action</th>}
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
                      {canAck && (
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn btn-sm btn-green" onClick={() => acknowledge(req)}>Acknowledge</button>
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

      {/* ── UA Log (all recorded UA results) ────────────────────── */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>UA Log</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>
              {logLoading ? '…' : `${uaLog.length} records`}
            </span>
            <button onClick={() => setPrintOpen(true)} disabled={uaLog.length === 0}
              title="Print UA log"
              style={{
                fontSize: '.72rem', padding: '4px 10px',
                background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
                color: '#fff', borderRadius: 5, cursor: uaLog.length ? 'pointer' : 'not-allowed',
                fontWeight: 600, opacity: uaLog.length ? 1 : .5,
              }}>
              🖨 Print
            </button>
          </div>
        </div>
        <div className="section-body" style={{ padding: 0 }}>
          {logErr ? (
            <div className="empty-state" style={{ color: '#DC2626' }}>{logErr}</div>
          ) : logLoading ? (
            <div className="empty-state">Loading…</div>
          ) : uaLog.length === 0 ? (
            <div className="empty-state">No UA records found. UA results logged in shift reports will appear here.</div>
          ) : (
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr>
                    <SortableTh label="Date"      k="date"     curKey={uaSortKey} dir={uaSortDir} onSort={toggleUaSort} />
                    <SortableTh label="Shift"     k="shift"    curKey={uaSortKey} dir={uaSortDir} onSort={toggleUaSort} />
                    <th>Time</th>
                    <SortableTh label="Resident"  k="resident" curKey={uaSortKey} dir={uaSortDir} onSort={toggleUaSort} />
                    <SortableTh label="Rm"        k="room"     curKey={uaSortKey} dir={uaSortDir} onSort={toggleUaSort} />
                    <SortableTh label="Result"    k="result"   curKey={uaSortKey} dir={uaSortDir} onSort={toggleUaSort} />
                    <th>Substances</th>
                    <th>Conducted By</th>
                    <th className="tc">Photo</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUaLog.map(entry => {
                    const parsed = parseUAText(entry.text)
                    return (
                      <UALogRow key={entry.id} entry={entry} parsed={parsed} />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <PrintScopeModal
        open={printOpen}
        title="Print UA Log"
        shiftLabel="Current shift only"
        defaultMode="range"
        onClose={() => setPrintOpen(false)}
        onConfirm={({ mode, startDate, endDate }) => {
          setPrintOpen(false)
          const facility = data?.facility_name || 'OpsPoint'
          let entries = sortedUaLog
          let subtitle = `${uaLog.length} records`
          if (mode === 'shift') {
            const activeId = data?.active_report_id
            entries = entries.filter(e => e.report_id === activeId)
            const ar = (data?.reports || []).find(r => r.id === activeId)
            subtitle = ar
              ? `${ar.shift || 'Shift'} — ${fmtDateFriendly(ar.report_date)}  ·  ${entries.length} records`
              : `${entries.length} records`
          } else {
            entries = entries.filter(e =>
              e.report_date && e.report_date >= startDate && e.report_date <= endDate
            )
            subtitle = `${fmtDateFriendly(startDate)} – ${fmtDateFriendly(endDate)}  ·  ${entries.length} records`
          }
          printUaLogReport({ facility, subtitle, entries })
        }}
      />

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
    </div>
  )
}

// ── UA Log row with inline photo viewer ──────────────────────────
function UALogRow({ entry, parsed }) {
  const [showPhoto, setShowPhoto] = useState(false)
  const [photoSrc, setPhotoSrc]  = useState(null)
  const [loading, setLoading]    = useState(false)

  async function viewPhoto() {
    if (photoSrc) { setShowPhoto(true); return }
    setLoading(true)
    try {
      const r = await fetch(`/api/log/${entry.id}/photo`, { credentials: 'include' })
      if (!r.ok) return
      const j = await r.json()
      if (j.photo) { setPhotoSrc(j.photo); setShowPhoto(true) }
    } finally { setLoading(false) }
  }

  const shiftShort = { 'Day Shift': 'Day', 'Swing Shift': 'Swing', 'Graveyard Shift': 'Grave' }[entry.shift] || (entry.shift || '—')

  return (
    <>
      <tr style={{ background: parsed?.hasPos ? '#fff5f5' : 'transparent' }}>
        <td className="date-cell">{fmtDate(entry.report_date)}</td>
        <td style={{ fontSize: '.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>{shiftShort}</td>
        <td style={{ fontFamily: 'var(--mono)', fontSize: '.8rem', color: '#475569', whiteSpace: 'nowrap' }}>{entry.time || '—'}</td>
        <td style={{ fontWeight: 600, fontSize: '.86rem' }}>{parsed?.name || '—'}</td>
        <td className="rm">{parsed?.room || '—'}</td>
        <td><UAResultBadge parsed={parsed} /></td>
        <td style={{ fontSize: '.78rem', color: '#475569', maxWidth: 200 }}>
          {parsed?.hasPos && parsed.posSubst
            ? <span style={{ color: '#991b1b', fontWeight: 700 }}>POS: {parsed.posSubst}</span>
            : parsed?.resultStr || '—'
          }
        </td>
        <td style={{ fontSize: '.8rem', color: '#64748b' }}>{parsed?.conductedBy || '—'}</td>
        <td style={{ textAlign: 'center' }}>
          {entry.ua_photo ? (
            <button className="btn btn-sm" onClick={viewPhoto} disabled={loading}
              style={{ fontSize: '.72rem', padding: '2px 8px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8' }}>
              {loading ? '…' : '📷 View'}
            </button>
          ) : '—'}
        </td>
      </tr>

      {/* Photo lightbox */}
      {showPhoto && photoSrc && (
        <tr>
          <td colSpan={9} style={{ padding: 0 }}>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid var(--line)' }}
              onClick={() => setShowPhoto(false)}>
              <img src={photoSrc} alt="UA Photo"
                style={{ maxWidth: '100%', maxHeight: 320, display: 'block', borderRadius: 6, cursor: 'zoom-in', border: '1px solid var(--line)' }} />
              <div style={{ fontSize: '.72rem', color: '#94a3b8', marginTop: 4 }}>Click to close</div>
            </div>
          </td>
        </tr>
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

// ── Sort comparator ───────────────────────────────────────────────────
function compareUa(a, b, key) {
  if (key === 'date') {
    const da = a.raw.report_date || ''
    const db = b.raw.report_date || ''
    return da.localeCompare(db)
  }
  if (key === 'shift') {
    return String(a.raw.shift || '').localeCompare(String(b.raw.shift || ''))
  }
  if (key === 'resident') {
    return String(a.parsed?.name || '').localeCompare(String(b.parsed?.name || ''))
  }
  if (key === 'room') {
    return (parseInt(a.parsed?.room) || 0) - (parseInt(b.parsed?.room) || 0)
  }
  if (key === 'result') {
    // POS > UA > NEG (so positives surface first when descending)
    const score = (p) => p?.hasPos ? 2 : p?.isAllNeg ? 0 : 1
    return score(a.parsed) - score(b.parsed)
  }
  return 0
}

// ── Print report ──────────────────────────────────────────────────────
function printUaLogReport({ facility, subtitle, entries }) {
  let pos = 0, neg = 0, other = 0, withPhoto = 0
  entries.forEach(e => {
    if (e.ua_photo) withPhoto++
    const p = parseUAText(e.text)
    if (p?.hasPos) pos++
    else if (p?.isAllNeg) neg++
    else other++
  })

  const summary = [
    ['Total',     entries.length],
    ['Positive',  pos],
    ['Negative',  neg],
    ['Other',     other],
    ['w/ Photo',  withPhoto],
  ]

  const columns = [
    { key: 'date',      label: 'Date',       width: '95px',  mono: true },
    { key: 'shift',     label: 'Shift',      width: '60px' },
    { key: 'time',      label: 'Time',       width: '65px',  mono: true },
    { key: 'room',      label: 'Rm',         width: '45px',  mono: true, align: 'center' },
    { key: 'resident',  label: 'Resident',   width: '160px' },
    { key: 'result',    label: 'Result',     width: '65px',  align: 'center' },
    { key: 'substances', label: 'Substances' },
    { key: 'by',        label: 'Conducted By', width: '110px' },
  ]

  const shortShift = (s) => ({ 'Day Shift': 'Day', 'Swing Shift': 'Swing', 'Graveyard Shift': 'Grave' }[s] || s || '—')

  const rows = entries.map(e => {
    const p = parseUAText(e.text)
    const resultBadge = p?.hasPos
      ? { html: '<span class="badge-pos">POS</span>' }
      : p?.isAllNeg
        ? { html: '<span class="badge-neg">NEG</span>' }
        : { html: '<span class="badge-pending">UA</span>' }
    const substances = p?.hasPos && p.posSubst
      ? { html: '<strong style="color:#991b1b;">POS:</strong> ' + escapeHtml(p.posSubst) }
      : (p?.resultStr || '—')
    return {
      date:        fmtDateFriendly(e.report_date),
      shift:       shortShift(e.shift),
      time:        e.time || '—',
      room:        p?.room || '—',
      resident:    p?.name || '—',
      result:      resultBadge,
      substances,
      by:          p?.conductedBy || '—',
      _pos:        !!p?.hasPos,
    }
  })

  openPrintWindow({
    title: 'UA Log Report',
    facility,
    subtitle,
    summary,
    columns,
    rows,
    rowStyle: r => r._pos ? 'background:#fff5f5;border-left:3px solid #dc2626;' : '',
    emptyMessage: 'No UA records in the selected scope.',
  })
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
