import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

const PAGE_SIZE = 20

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function fmtDateShort(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

const STATUS_OPTS = [
  { v: 'building', l: 'In Building', c: 's-building' },
  { v: 'work',     l: 'Work',         c: 's-work' },
  { v: 'pass',     l: 'Weekend Pass', c: 's-pass' },
  { v: 'out',      l: 'Out / Other',  c: 's-out' },
  { v: 'bhc',      l: 'BHC',          c: 's-bhc' },
  { v: 'efc',      l: 'EFC',          c: 's-efc' },
  { v: 'hospital', l: 'Hospital',     c: 's-hospital' },
]

function stOpt(v) { return STATUS_OPTS.find(o => o.v === v) || { v, l: v, c: '' } }

function parseTimeMins(t) {
  const m = t?.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1]), mn = parseInt(m[2]), ap = m[3].toUpperCase()
  if (ap === 'AM' && h === 12) h = 0
  if (ap === 'PM' && h !== 12) h += 12
  return h * 60 + mn
}

export default function ArchiveTab() {
  const { data } = useData()
  const { hasPerm } = usePermission()
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(null)
  const canDelete = hasPerm('reports.delete')

  const sorted = useMemo(() =>
    [...(data?.reports || [])]
      .filter(r => r.id !== data?.active_report_id)
      .sort((a, b) => (b.report_date || '').localeCompare(a.report_date || '') || (b.updated_at || '').localeCompare(a.updated_at || '')),
    [data?.reports, data?.active_report_id]
  )

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  async function deleteReport(r, e) {
    e.stopPropagation()
    if (!window.confirm(`Delete report #${r.id} (${r.shift}, ${r.report_date})? This cannot be undone.`)) return
    await fetch(`/api/reports/${r.id}`, { method: 'DELETE', credentials: 'include' })
  }

  if (selected) {
    return <ReportDetail report={selected} data={data} onBack={() => setSelected(null)} />
  }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Archive</span></div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>
            {sorted.length} reports
          </span>
        </div>
        <div className="section-body" style={{ padding: 0 }}>
          {sorted.length === 0 ? (
            <div className="empty-state">No archived reports yet.</div>
          ) : (
            <>
              <div className="report-list" style={{ padding: '12px 14px' }}>
                {paged.map(r => {
                  const snapshotCount = (r.roster_snapshot || []).filter(c => c.is_active && !c.is_special && c.name !== 'VACANT').length
                  const censusCount   = r.census ? Object.values(r.census).reduce((a, b) => a + b, 0) : 0
                  const tot = snapshotCount || censusCount || '—'
                  return (
                    <div key={r.id} className="report-card" onClick={() => setSelected(r)}>
                      <div className="rc-date">{fmtDateShort(r.report_date)}</div>
                      <div className="rc-shift">{r.shift || '—'}</div>
                      <div className="rc-mod">MOD: {r.mod_name || '—'}</div>
                      {r.is_closed && (
                        <span style={{ fontSize: '.67rem', fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '2px 7px', borderRadius: 10 }}>
                          Closed
                        </span>
                      )}
                      <div className="rc-total">{tot} residents</div>
                      <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}>View</button>
                      {canDelete && (
                        <button className="rc-del" onClick={e => deleteReport(r, e)} title="Delete report">&times;</button>
                      )}
                    </div>
                  )
                })}
              </div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', fontSize: '.82rem', borderTop: '1px solid var(--line)' }}>
                  <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }}
                    disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
                  <span style={{ color: '#475569' }}>
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
                  </span>
                  <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }}
                    disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function printArchivedReport(r, data) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  const facility = data?.facility_name || 'OpsPoint'
  const clients  = (r.roster_snapshot || data?.clients || []).filter(c => c.is_active)
  const logEntries = [...(r.log_entries || [])].sort((a, b) => parseTimeMins(a.time) - parseTimeMins(b.time))
  const census   = r.census   || {}
  const statuses = r.statuses || {}
  const comments = r.comments || {}
  const censusTot = Object.values(census).reduce((a, b) => a + b, 0)
  const printedAt = new Date().toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' })

  const rosterRows = clients.map((c, i) => {
    const cur = statuses[c.id] || (c.name === 'VACANT' ? 'vacant' : 'building')
    const opt = stOpt(cur)
    return `<tr${i % 2 === 1 ? ' class="alt"' : ''}${c.is_special ? ' class="srow"' : ''}>
      <td>${esc(c.room||'')}</td><td>${esc(c.name)}</td>
      <td>${c.is_special ? '—' : esc(opt.l)}</td>
      <td>${esc(comments[c.id]||'')}</td></tr>`
  }).join('')

  const logRows = logEntries.map((e, i) =>
    `<tr${i%2===1?' class="alt"':''}${e.text&&/POS:/.test(e.text)?' style="background:#fee2e2;"':''}>
      <td class="mono">${esc(e.time)}</td><td>${esc(e.text)}</td></tr>`
  ).join('')

  const censusCells = [['building','In Building'],['work','Work'],['pass','Pass'],
    ['bhc','BHC'],['efc','EFC'],['hospital','Hospital'],['out','Out/Other']]
    .map(([k,l]) => `<td>${esc(l)}<br><strong>${census[k]||0}</strong></td>`).join('')

  const issuesHtml = (r.issues||[]).length > 0
    ? `<div class="section"><div class="sh">Issues &amp; Concerns</div><div class="sb">
        ${r.issues.map(v=>`<div class="issue">${esc(v)}</div>`).join('')}</div></div>` : ''

  const medHtml = (r.med_notes||[]).length > 0
    ? `<div class="section"><div class="sh">Medical Notes</div><div class="sb">
        ${r.med_notes.map(v=>`<div class="issue med">${esc(v)}</div>`).join('')}</div></div>` : ''

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Calibri,Arial,sans-serif;font-size:12px;color:#111;background:#fff}
    .wrap{max-width:10in;margin:0 auto;padding:16px 20px}
    .hdr{background:#0f4c5c;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;border-bottom:3px solid #c9780c}
    .hdr h1{font-size:1.1rem;font-weight:800}
    .hdr .sub{color:#a8c0e8;font-size:.8rem;margin-top:2px}
    .hdr .meta{color:#a8c0e8;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px}
    .hdr .closed{background:rgba(220,38,38,.3);color:#fca5a5;font-size:.65rem;font-weight:700;letter-spacing:.08em;padding:2px 8px;border-radius:10px;display:inline-block;margin-top:4px}
    .section{background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-top:12px;overflow:hidden}
    .sh{background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:7px 14px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#475569}
    .sb{padding:12px 14px}
    table.census{width:100%;border-collapse:collapse}
    table.census td{text-align:center;padding:8px 10px;border:1px solid #e2e8f0;font-size:.82rem;color:#475569}
    table.census td strong{display:block;font-size:1.1rem;font-weight:800;color:#0f4c5c}
    .ct{background:#0f4c5c;color:#fff!important}
    .ct strong{color:#fcc858!important}
    table.roster,table.log{width:100%;border-collapse:collapse}
    table.roster th,table.log th{background:#0f4c5c;color:#cce8ef;padding:7px 10px;text-align:left;font-size:.65rem;letter-spacing:.06em;text-transform:uppercase}
    table.roster td,table.log td{padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:.82rem;vertical-align:top}
    .srow td{color:#94a3b8;font-style:italic}
    .alt td{background:#f8fafc}
    .mono{font-family:'Cascadia Code',Consolas,monospace;font-size:.76rem;color:#475569}
    .issue{padding:6px 10px;border-left:3px solid #e2e8f0;margin-bottom:6px;font-size:.85rem}
    .issue.med{background:#eff6ff;border-color:#bfdbfe}
    .footer{color:#64748b;font-size:.68rem;margin-top:14px;text-align:center;padding-top:6px;border-top:1px solid #e2e8f0}
    .no-print{margin-bottom:10px}
    .btn-print{background:#0f4c5c;color:#fff;border:none;padding:7px 14px;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}
    .btn-close{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;padding:7px 14px;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit;margin-left:6px}
    @media print{.no-print{display:none!important}body{background:#fff}.wrap{padding:0;max-width:none}@page{size:letter;margin:.4in}}
  `

  const censusSect = Object.keys(census).length > 0
    ? `<div class="section"><div class="sh">Census</div><div class="sb" style="padding:0">
        <table class="census"><tr>${censusCells}<td class="ct"><strong>${censusTot}</strong>Total</td></tr></table>
       </div></div>` : ''

  const logSect = logEntries.length > 0
    ? `<div class="section"><div class="sh">Activity Log · ${logEntries.length} entries</div>
        <div class="sb" style="padding:0"><table class="log">
          <thead><tr><th style="width:80px">Time</th><th>Entry</th></tr></thead>
          <tbody>${logRows}</tbody></table></div></div>` : ''

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Report #${r.id} — ${esc(r.shift)} — ${esc(r.report_date)}</title>
    <style>${css}</style></head><body><div class="wrap">
    <div class="no-print">
      <button class="btn-print" id="op-print">🖨 Print / Save PDF</button>
      <button class="btn-close" id="op-close">Close</button>
    </div>
    <div class="hdr">
      <div class="meta">${esc(facility)} · Shift Report · Confidential</div>
      <h1>${esc(r.shift||'Shift Report')}</h1>
      <div class="sub">${esc(fmtDate(r.report_date))} · Report #${r.id}${r.mod_name?' · MOD: '+esc(r.mod_name):''}</div>
      ${r.is_closed?'<span class="closed">CLOSED</span>':''}
    </div>
    ${censusSect}
    ${logSect}${issuesHtml}${medHtml}
    <div class="section"><div class="sh">Roster</div><div class="sb" style="padding:0">
      <table class="roster"><thead><tr>
        <th style="width:55px">Rm</th><th>Name</th><th style="width:120px">Status</th><th>Comment</th>
      </tr></thead><tbody>${rosterRows}</tbody></table></div></div>
    <div class="footer">Printed ${esc(printedAt)} · OpsPoint · Confidential</div>
    </div></body></html>`

  const win = window.open('', '_blank')
  if (!win) { alert('Popup blocked — please allow popups for this site to print.'); return }
  win.document.write(html)
  win.document.close()
  setTimeout(() => {
    try {
      const pb = win.document.getElementById('op-print')
      const cb = win.document.getElementById('op-close')
      if (pb) pb.addEventListener('click', () => win.print())
      if (cb) cb.addEventListener('click', () => win.close())
      win.focus(); win.print()
    } catch { /* empty */ }
  }, 250)
}

function ReportDetail({ report: r, data, onBack }) {
  const clients = r.roster_snapshot || data?.clients || []
  const logEntries = [...(r.log_entries || [])].sort((a, b) => parseTimeMins(a.time) - parseTimeMins(b.time))
  const census = r.census || {}
  const statuses = r.statuses || {}
  const comments = r.comments || {}

  return (
    <div>
      <div style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
        <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }}
          onClick={onBack}>← Back to Archive</button>
        <button className="btn btn-sm" style={{ background: 'var(--teal-700)', color: '#fff', border: 'none' }}
          onClick={() => printArchivedReport(r, data)}>🖨 Print</button>
      </div>

      {/* Meta */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left">
            <span className="sh-dot" />
            <span>Report #{r.id}</span>
          </div>
          {r.is_closed && <span style={{ fontSize: '.72rem', color: '#dc2626', fontWeight: 600, letterSpacing: '.05em' }}>CLOSED</span>}
        </div>
        <div className="section-body">
          <div className="meta-grid">
            <div><label style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#475569' }}>Date</label>
              <div style={{ marginTop: 4, fontWeight: 600 }}>{fmtDate(r.report_date)}</div></div>
            <div><label style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#475569' }}>Shift</label>
              <div style={{ marginTop: 4, fontWeight: 600 }}>{r.shift || '—'}</div></div>
            <div><label style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#475569' }}>MOD</label>
              <div style={{ marginTop: 4, fontWeight: 600 }}>{r.mod_name || '—'}</div></div>
          </div>
        </div>
      </div>

      {/* Census */}
      {Object.keys(census).length > 0 && (
        <div className="section">
          <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Census</span></div></div>
          <div className="section-body">
            <div className="census-grid">
              {[['building','In Building'],['work','Work'],['pass','Pass'],['bhc','BHC'],['efc','EFC'],['hospital','Hospital'],['out','Out/Other']].map(([k, l]) => (
                <div key={k} className={`census-card${(census[k] || 0) > 0 ? ' hi' : ''}`}>
                  <div className="count">{census[k] || 0}</div>
                  <div className="clabel">{l}</div>
                </div>
              ))}
              <div className="census-card hi">
                <div className="count">{Object.values(census).reduce((a, b) => a + b, 0)}</div>
                <div className="clabel">Total</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Log */}
      {logEntries.length > 0 && (
        <div className="section">
          <div className="section-head">
            <div className="sh-left"><span className="sh-dot" /><span>Activity Log</span></div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>{logEntries.length} entries</span>
          </div>
          <div className="section-body">
            <div className="log-entries">
              {logEntries.map((e, i) => (
                <div key={i} className="log-entry" style={e.text && /POS:/.test(e.text) ? { borderLeft: '4px solid #DC2626', background: '#fff5f5' } : {}}>
                  <span className="ts">{e.time}</span>
                  <span className="msg">{e.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Issues */}
      {(r.issues || []).length > 0 && (
        <div className="section">
          <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Issues & Concerns</span></div></div>
          <div className="section-body">
            <div className="issues-list">
              {r.issues.map((v, i) => (
                <div key={i} className="issue-item"><span className="issue-text">{v}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Med Notes */}
      {(r.med_notes || []).length > 0 && (
        <div className="section">
          <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Medical Notes</span></div></div>
          <div className="section-body">
            <div className="issues-list">
              {r.med_notes.map((v, i) => (
                <div key={i} className="issue-item" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
                  <span className="issue-text">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Roster */}
      <div className="section">
        <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Roster</span></div></div>
        <div className="section-body" style={{ padding: 0 }}>
          <div className="roster-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rm</th><th>Name</th><th>Status</th><th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {clients.filter(c => c.is_active).map(c => {
                  const cur = statuses[c.id] || (c.name === 'VACANT' ? 'vacant' : 'building')
                  const opt = stOpt(cur)
                  return (
                    <tr key={c.id} className={c.is_special ? 'srow' : ''}>
                      <td className="rm">{c.room}</td>
                      <td className="name-cell">{c.name}</td>
                      <td>
                        {c.is_special ? <span style={{ color: '#cbd5e1' }}>—</span>
                          : <span className={`ss ${opt.c}`} style={{ display: 'inline-block', pointerEvents: 'none' }}>{opt.l}</span>}
                      </td>
                      <td style={{ fontSize: '.84rem', color: '#475569' }}>{comments[c.id] || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
