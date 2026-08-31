import { useState, useMemo } from 'react'
import { CARD_HEAD_TITLE } from '../../utils/ui.js'
import { useOutletContext } from 'react-router-dom'
import { Archive, CheckCircle, FileText, ChevronLeft, Printer, Trash2 } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, Pagination, Select,
} from 'flowbite-react'
import { FilterChip } from '../../components/ui.jsx'
import { Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from '../../components/table'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { StatusBadge, useConfirm } from '../../components/ui.jsx'

const CARD = 'p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 sm:p-5 dark:bg-gray-800'

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

const STATUS_BADGE_CLS = {
  building: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  work:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pass:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  out:      'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  bhc:      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  efc:      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  hospital: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  vacant:   'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
}

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
  const [sort, setSort] = useState('newest')
  const [shiftFilter, setShiftFilter] = useState('')
  const canDelete = hasPerm('reports.delete')
  const { globalSearch = '' } = useOutletContext() || {}
  const confirm = useConfirm()

  const shiftOptions = useMemo(() => {
    const names = new Set((data?.reports || []).filter(r => r.id !== data?.active_report_id).map(r => r.shift).filter(Boolean))
    return [...names].sort()
  }, [data?.reports, data?.active_report_id])

  const sorted = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    const rows = [...(data?.reports || [])]
      .filter(r => r.id !== data?.active_report_id)
      .filter(r => !shiftFilter || r.shift === shiftFilter)
      .filter(r => !q || `${r.shift} ${r.mod_name} ${r.report_date}`.toLowerCase().includes(q))
    if (sort === 'oldest') rows.sort((a, b) => (a.report_date || '').localeCompare(b.report_date || '') || (a.updated_at || '').localeCompare(b.updated_at || ''))
    else rows.sort((a, b) => (b.report_date || '').localeCompare(a.report_date || '') || (b.updated_at || '').localeCompare(a.updated_at || ''))
    return rows
  }, [data?.reports, data?.active_report_id, globalSearch, sort, shiftFilter])

  const closedCount = sorted.filter(r => r.is_closed).length
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  async function deleteReport(r, e) {
    e.stopPropagation()
    if (!await confirm({ title: `Delete report #${r.id}?`, body: `${r.shift}, ${r.report_date} — this cannot be undone.`, confirmText: 'Delete', color: 'red' })) return
    await fetch(`/api/reports/${r.id}`, { method: 'DELETE', credentials: 'include' })
  }

  if (selected) {
    return <ReportDetail report={selected} data={data} onBack={() => setSelected(null)} />
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <Breadcrumb className="mb-1">
          <BreadcrumbItem>Records</BreadcrumbItem>
          <BreadcrumbItem>Archive</BreadcrumbItem>
        </Breadcrumb>
        <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-gray-900 dark:text-white">Archive</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Past shift reports — read-only snapshots</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { label: 'Total Reports', value: sorted.length, sub: 'archived', Icon: Archive, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
          { label: 'Closed', value: closedCount, sub: 'signed off', Icon: CheckCircle, tint: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300' },
          { label: 'Open', value: sorted.length - closedCount, sub: 'not yet closed', Icon: FileText, tint: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-300' },
        ].map(k => (
          <div key={k.label} className={CARD}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">{k.label}</h3>
                <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{k.value}</p>
                <p className="mt-2 text-xs text-gray-400">{k.sub}</p>
              </div>
              <div className={`flex items-center justify-center rounded-lg w-11 h-11 ${k.tint}`}><k.Icon className="w-5 h-5" /></div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[['newest','Newest First'],['oldest','Oldest First']].map(([v, l]) => (
          <FilterChip key={v} active={sort === v} onClick={() => { setSort(v); setPage(0) }}>{l}</FilterChip>
        ))}
        {shiftOptions.length > 0 && (
          <Select sizing="sm" value={shiftFilter} onChange={e => { setShiftFilter(e.target.value); setPage(0) }} className="w-48">
            <option value="">All Shifts</option>
            {shiftOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}
        <span className="ml-auto text-sm text-gray-400">{sorted.length} reports</span>
      </div>

      {sorted.length === 0 ? (
        <div className={`${CARD} text-sm text-center text-gray-400`}>No archived reports yet.</div>
      ) : (
        <>
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell>Shift</TableHeadCell>
                <TableHeadCell>MOD</TableHeadCell>
                <TableHeadCell>Residents</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y">
              {paged.map(r => {
                const snapshotCount = (r.roster_snapshot || []).filter(c => c.is_active && !c.is_special && c.name !== 'VACANT').length
                const censusCount   = r.census ? Object.values(r.census).reduce((a, b) => a + b, 0) : 0
                const tot = snapshotCount || censusCount || '—'
                return (
                  <TableRow key={r.id} className="bg-white cursor-pointer dark:border-gray-700 dark:bg-gray-800" onClick={() => setSelected(r)}>
                    <TableCell className="font-mono">{fmtDateShort(r.report_date)}</TableCell>
                    <TableCell className="font-semibold text-gray-900 dark:text-white">{r.shift || '—'}</TableCell>
                    <TableCell className="text-gray-500 dark:text-gray-400">{r.mod_name || '—'}</TableCell>
                    <TableCell>{tot}{tot !== '—' ? ' residents' : ''}</TableCell>
                    <TableCell><StatusBadge color={r.is_closed ? 'success' : 'warning'}>{r.is_closed ? 'Closed' : 'Open'}</StatusBadge></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button size="xs" color="light" onClick={e => { e.stopPropagation(); setSelected(r) }}>View</Button>
                        {canDelete && (
                          <Button size="xs" color="light" className="text-red-600" onClick={e => deleteReport(r, e)} title="Delete report"><Trash2 className="w-4 h-4" /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex justify-center mt-3">
              <Pagination currentPage={page + 1} totalPages={totalPages} onPageChange={pg => setPage(pg - 1)} />
            </div>
          )}
        </>
      )}
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

function Panel({ title, count, children }) {
  return (
    <div className={`${CARD} mb-4`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={CARD_HEAD_TITLE}>{title}</h3>
        {count != null && <span className="font-mono text-xs text-gray-400">{count}</span>}
      </div>
      {children}
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
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Records</BreadcrumbItem>
            <BreadcrumbItem>Archive</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-gray-900 dark:text-white">Report #{r.id}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{fmtDate(r.report_date)} · {r.shift || '—'}{r.mod_name ? ' · MOD: ' + r.mod_name : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button color="light" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-2" /> Back</Button>
          <Button color="light" onClick={() => printArchivedReport(r, data)}><Printer className="w-4 h-4 mr-2" /> Print</Button>
        </div>
      </div>

      {/* Meta */}
      <Panel title="Report Details">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div><div className="text-xs font-medium tracking-wide text-gray-400 uppercase">Date</div><div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{fmtDate(r.report_date)}</div></div>
          <div><div className="text-xs font-medium tracking-wide text-gray-400 uppercase">Shift</div><div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{r.shift || '—'}</div></div>
          <div><div className="text-xs font-medium tracking-wide text-gray-400 uppercase">MOD</div><div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{r.mod_name || '—'}</div></div>
          <div><div className="text-xs font-medium tracking-wide text-gray-400 uppercase">Status</div><div className="mt-1"><StatusBadge color={r.is_closed ? 'success' : 'warning'}>{r.is_closed ? 'Closed' : 'Open'}</StatusBadge></div></div>
        </div>
      </Panel>

      {/* Census */}
      {Object.keys(census).length > 0 && (
        <Panel title="Census">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {[['building','In Building'],['work','Work'],['pass','Pass'],['bhc','BHC'],['efc','EFC'],['hospital','Hospital'],['out','Out/Other']].map(([k, l]) => {
              const n = census[k] || 0
              return (
                <div key={k} className={`flex flex-col items-center p-3 border rounded-xl ${n > 0 ? 'bg-white border-teal-200 dark:bg-gray-700 dark:border-teal-700' : 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'}`}>
                  <div className={`text-xl font-bold font-mono ${n > 0 ? 'text-teal-700 dark:text-teal-400' : 'text-gray-400 dark:text-gray-600'}`}>{n}</div>
                  <div className="mt-1 text-[10px] text-center font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 leading-tight">{l}</div>
                </div>
              )
            })}
            <div className="flex flex-col items-center p-3 bg-teal-700 border border-teal-800 rounded-xl dark:bg-teal-900">
              <div className="text-xl font-bold font-mono text-amber-300">{Object.values(census).reduce((a, b) => a + b, 0)}</div>
              <div className="mt-1 text-[10px] text-center font-semibold uppercase tracking-wide text-teal-100 leading-tight">Total</div>
            </div>
          </div>
        </Panel>
      )}

      {/* Log */}
      {logEntries.length > 0 && (
        <Panel title="Activity Log" count={`${logEntries.length} entries`}>
          <div className="overflow-x-auto -mx-4 sm:-mx-5">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {logEntries.map((e, i) => {
                  const isPos = e.text && /POS:/.test(e.text)
                  return (
                    <tr key={i} className={isPos ? 'bg-red-50 dark:bg-red-950/20' : 'bg-white dark:bg-gray-800'}>
                      <td className={`px-4 py-2 font-mono text-xs whitespace-nowrap text-blue-600 dark:text-blue-400${isPos ? ' border-l-2 border-red-500' : ''}`}>{e.time}</td>
                      <td className="px-4 py-2 text-gray-800 dark:text-gray-200">{e.text}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Issues */}
      {(r.issues || []).length > 0 && (
        <Panel title="Issues & Concerns">
          <div className="space-y-1.5">
            {r.issues.map((v, i) => (
              <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 rounded-md border border-gray-200 bg-gray-50 dark:bg-gray-700/40 dark:border-gray-600">
                <span className="text-sm text-gray-800 dark:text-gray-200">{v}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Med Notes */}
      {(r.med_notes || []).length > 0 && (
        <Panel title="Medical Notes">
          <div className="space-y-1.5">
            {r.med_notes.map((v, i) => (
              <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800">
                <span className="text-sm text-gray-800 dark:text-gray-200">{v}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Roster */}
      <Panel title="Roster">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeadCell className="w-14">Rm</TableHeadCell>
              <TableHeadCell>Name</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell>Comment</TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y">
            {clients.filter(c => c.is_active).map(c => {
              const cur = statuses[c.id] || (c.name === 'VACANT' ? 'vacant' : 'building')
              const opt = stOpt(cur)
              const badgeCls = STATUS_BADGE_CLS[cur] || STATUS_BADGE_CLS.out
              return (
                <TableRow key={c.id} className={c.is_special ? 'italic' : ''}>
                  <TableCell className="font-mono text-xs text-center text-gray-500 dark:text-gray-400">{c.room}</TableCell>
                  <TableCell className={`font-semibold ${c.is_special ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>{c.name}</TableCell>
                  <TableCell>
                    {c.is_special
                      ? <span className="text-gray-300 dark:text-gray-600">—</span>
                      : <span className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap ${badgeCls}`}>{opt.l}</span>}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-300">{comments[c.id] || ''}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Panel>
    </div>
  )
}

