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
  const { data, saveData } = useData()
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

function ReportDetail({ report: r, data, onBack }) {
  const clients = r.roster_snapshot || data?.clients || []
  const logEntries = [...(r.log_entries || [])].sort((a, b) => parseTimeMins(a.time) - parseTimeMins(b.time))
  const census = r.census || {}
  const statuses = r.statuses || {}
  const comments = r.comments || {}

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }}
          onClick={onBack}>← Back to Archive</button>
      </div>

      {/* Meta */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left">
            <span className="sh-dot" />
            <span>Report #{r.id}</span>
          </div>
          {r.is_closed && <span style={{ fontSize: '.72rem', color: '#86efac', fontWeight: 700 }}>CLOSED</span>}
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
    </div>
  )
}
