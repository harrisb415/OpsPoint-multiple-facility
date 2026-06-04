// Shared print-window helper for log reports.
// Opens a styled new tab with a print-ready table and auto-triggers window.print().
//
// Usage:
//   openPrintWindow({
//     title: 'Activity Log',
//     facility: 'Hello Facility',
//     subtitle: 'Swing Shift — Tue, Nov 12, 2024',
//     summary: [['Entries', 42], ['Wellness checks', 5]],
//     columns: [
//       { key: 'time',     label: 'Time',     width: '80px',  mono: true },
//       { key: 'type',     label: 'Type',     width: '120px' },
//       { key: 'text',     label: 'Entry' },
//     ],
//     rows: [...],
//     rowStyle: (row) => row.flagged ? 'background:#fee2e2;' : '',
//   })

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Allowed badge classes. Any caller-supplied class outside this list is dropped,
// so untrusted data can never become arbitrary HTML.
const BADGE_CLASSES = new Set(['pos','neg','pending','approved','delivered'])

// Render a cell value safely. Values may be:
//   - a string/number  → escaped and emitted
//   - { badge: 'pos'|'neg'|'pending'|'approved'|'delivered', label?: '...' }
//   - { value: '...' } (alias for plain text)
// Anything else is coerced to its string form and escaped. No raw HTML accepted.
function renderCell(v) {
  if (v && typeof v === 'object') {
    if (typeof v.badge === 'string' && BADGE_CLASSES.has(v.badge)) {
      const label = v.label != null ? esc(v.label) : esc(v.badge.toUpperCase())
      return '<span class="badge-' + v.badge + '">' + label + '</span>'
    }
    if ('value' in v) return esc(v.value)
    return esc(String(v))
  }
  return esc(v)
}

export function openPrintWindow({
  title = 'Report',
  facility = 'OpsPoint',
  subtitle = '',
  summary = [],   // [[label, value], ...]
  columns = [],   // [{ key, label, width?, mono?, align? }]
  rows = [],
  rowStyle = null,
  emptyMessage = 'No entries to display.',
}) {
  const summaryHtml = summary.length
    ? '<div class="summary">' + summary.map(([k, v]) =>
        '<div class="sumbox"><div class="sum-l">' + esc(k) + '</div><div class="sum-v">' + esc(v) + '</div></div>'
      ).join('') + '</div>'
    : ''

  const headHtml = '<thead><tr>' + columns.map(c =>
    '<th' + (c.width ? ' style="width:' + c.width + ';"' : '')
          + (c.align ? ' class="al-' + c.align + '"' : '')
          + '>' + esc(c.label) + '</th>'
  ).join('') + '</tr></thead>'

  let bodyHtml
  if (rows.length === 0) {
    bodyHtml = '<tbody><tr><td colspan="' + columns.length + '" class="empty">' + esc(emptyMessage) + '</td></tr></tbody>'
  } else {
    bodyHtml = '<tbody>' + rows.map((r, i) => {
      const extraStyle = rowStyle ? (rowStyle(r) || '') : ''
      return '<tr' + (i % 2 === 1 ? ' class="alt"' : '')
        + (extraStyle ? ' style="' + extraStyle + '"' : '') + '>'
        + columns.map(c => {
          const v = r[c.key]
          const cls = (c.mono ? 'mono ' : '') + (c.align ? 'al-' + c.align + ' ' : '')
          const cellHtml = renderCell(v)
          return '<td' + (cls.trim() ? ' class="' + cls.trim() + '"' : '') + '>' + cellHtml + '</td>'
        }).join('') + '</tr>'
    }).join('') + '</tbody>'
  }

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Calibri, Arial, sans-serif; font-size: 12px; color: #111; background: #fff; }
    .wrap { max-width: 11in; margin: 0 auto; padding: 16px 20px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .hdr { background: #0f4c5c; color: #fff; padding: 12px 16px; border-radius: 8px 8px 0 0;
           border-bottom: 3px solid #f97316; }
    .hdr h1 { font-size: 1.1rem; font-weight: 800; }
    .hdr .sub { color: #a8c0e8; font-size: .8rem; margin-top: 2px; }
    .hdr .meta { color: #a8c0e8; font-size: .65rem; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 2px; }
    .summary { background: #f1f5f9; padding: 8px 16px; display: flex; gap: 18px; flex-wrap: wrap;
               border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; }
    .sumbox { font-size: .75rem; }
    .sum-l { color: #64748b; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; font-size: .65rem; }
    .sum-v { color: #0f4c5c; font-weight: 800; font-size: .95rem; }
    .tablewrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 0 0 8px 8px;
                 overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #0f4c5c; color: #cce8ef; padding: 7px 10px; text-align: left;
               font-size: .65rem; letter-spacing: .06em; text-transform: uppercase; font-weight: 700; }
    tbody td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; font-size: .82rem;
               vertical-align: top; }
    tbody tr.alt td { background: #f8fafc; }
    .mono { font-family: 'Cascadia Code', Consolas, monospace; font-size: .76rem; color: #475569; }
    .al-center { text-align: center; }
    .al-right  { text-align: right; }
    .empty { color: #94a3b8; font-style: italic; text-align: center; padding: 30px 10px; }
    .footer { color: #64748b; font-size: .68rem; margin-top: 10px; text-align: center;
              padding-top: 6px; border-top: 1px solid #e2e8f0; }
    .badge-pos { background: #fee2e2; color: #991b1b; padding: 1px 6px; border-radius: 4px;
                 font-size: .68rem; font-weight: 700; }
    .badge-neg { background: #dcfce7; color: #15803d; padding: 1px 6px; border-radius: 4px;
                 font-size: .68rem; font-weight: 700; }
    .badge-pending { background: #fef9c3; color: #854d0e; padding: 1px 6px; border-radius: 4px;
                     font-size: .68rem; font-weight: 700; }
    .badge-delivered { background: #dbeafe; color: #1e40af; padding: 1px 6px; border-radius: 4px;
                       font-size: .68rem; font-weight: 700; }
    .no-print { margin-bottom: 8px; }
    .btn-print { background: #0f4c5c; color: #fff; border: none; padding: 7px 14px;
                 border-radius: 6px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .btn-close { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;
                 padding: 7px 14px; border-radius: 6px; font-weight: 700; cursor: pointer;
                 font-family: inherit; margin-left: 6px; }
    @media print {
      .no-print { display: none !important; }
      body { background: #fff; }
      .wrap { padding: 0; max-width: none; }
      @page { size: letter; margin: 0.4in; }
    }
  `

  const printedAt = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })

  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(title) + '</title>' +
    '<style>' + css + '</style></head><body><div class="wrap">' +
    '<div class="no-print">' +
      '<button class="btn-print" id="op-print">🖨 Print / Save PDF</button>' +
      '<button class="btn-close" id="op-close">Close</button>' +
    '</div>' +
    '<div class="hdr">' +
      '<div class="meta">' + esc(facility) + ' · Confidential</div>' +
      '<h1>' + esc(title) + '</h1>' +
      (subtitle ? '<div class="sub">' + esc(subtitle) + '</div>' : '') +
    '</div>' +
    summaryHtml +
    '<div class="tablewrap"><table>' + headHtml + bodyHtml + '</table></div>' +
    '<div class="footer">Printed ' + esc(printedAt) + '</div>' +
    '</div>' +
    '</body></html>'

  const win = window.open('', '_blank')
  if (!win) {
    alert('Popup blocked — please allow popups for this site to print reports.')
    return false
  }
  win.document.write(html)
  win.document.close()
  // Wire up buttons + initial print from parent context — keeps script-src CSP
  // free of 'unsafe-inline' (no inline <script> or onclick= in the popup).
  setTimeout(() => {
    try {
      const printBtn = win.document.getElementById('op-print')
      const closeBtn = win.document.getElementById('op-close')
      if (printBtn) printBtn.addEventListener('click', () => win.print())
      if (closeBtn) closeBtn.addEventListener('click', () => win.close())
      win.focus(); win.print()
    } catch { /* empty */ }
  }, 250)
  return true
}

// Helper: format a yyyy-mm-dd date as a friendly string
export function fmtDateFriendly(ymd) {
  if (!ymd) return ''
  try {
    const d = new Date(ymd + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return ymd }
}

// Helper: classify an Activity Log entry by keyword (for the Type column).
export function classifyLogEntry(text) {
  const t = String(text || '').toLowerCase()
  if (t.includes('wellness check'))         return 'Wellness'
  if (t.includes('walkthrough'))            return 'Walkthrough'
  if (t.includes('lunch break'))            return 'Lunch'
  if (t.includes(' — ua:') || t.match(/\bua:/i)) return 'UA'
  if (t.includes('room search'))            return 'Room Search'
  if (t.includes('mail logged') || t.includes('mail delivered') || t.startsWith('mail received')) return 'Mail'
  if (t.includes('violation') || t.includes('infraction')) return 'Infraction'
  if (t.startsWith('group:'))               return 'Group'
  if (t.includes('intake'))                 return 'Intake'
  if (t.includes('discharge'))              return 'Discharge'
  return 'Note'
}
