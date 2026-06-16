/**
 * ClientReportModal — configurable client report builder that generates
 * a print-ready HTML window with per-client card layout.
 *
 * Props:
 *   data    — full DataContext snapshot
 *   onClose — callback to close the modal
 */

import { useState } from 'react'
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, TextInput } from 'flowbite-react'
import { Field } from './ui.jsx'
import { classifyLogEntry } from '../utils/printLog.js'

// ── Pure helpers (no React) ───────────────────────────────────────────────

function fmtPhone(raw) {
  if (!raw) return '—'
  const d = String(raw).replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fd(d) {
  if (!d) return '—'
  try {
    return new Date(String(d).slice(0, 10) + 'T12:00:00')
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return String(d) }
}

// ── Timeline badge styles (inline CSS strings for print window) ───────────
const TL_TYPE_STYLE = {
  Wellness:      'background:#ccfbf1;color:#0f766e',
  Walkthrough:   'background:#ccfbf1;color:#0f766e',
  UA:            'background:#fef3c7;color:#92400e',
  Lunch:         'background:#f0fdf9;color:#6b7280',
  'Room Search': 'background:#ede9fe;color:#6d28d9',
  Mail:          'background:#dbeafe;color:#1d4ed8',
  Infraction:    'background:#fee2e2;color:#991b1b',
  Intake:        'background:#dcfce7;color:#15803d',
  Discharge:     'background:#f0fdf9;color:#6b7280',
  Group:         'background:#ede9fe;color:#6d28d9',
  Note:          'background:#f1f5f9;color:#475569',
}

const DISCHARGE_LABELS = {
  graduate:       'Graduate / Successful Completion',
  ama:            'AMA (Against Medical Advice)',
  therapeutic:    'Therapeutic Discharge',
  administrative: 'Administrative Discharge',
}

// Builds the HTML for a single client card
function buildCard(c, data, sections, limit) {
  const today = new Date().toLocaleDateString('en-CA')
  const days = c.intake_date
    ? Math.max(0, Math.floor((Date.now() - new Date(c.intake_date + 'T00:00:00')) / 86400000))
    : null

  let h = `<div class="cc">`

  // ── Card header ──
  const metaParts = [
    c.case_manager ? `CM: ${esc(c.case_manager)}` : null,
    days != null ? `Day ${days}` : null,
    !c.is_active ? `<span class="dis-badge">Discharged</span>` : null,
  ].filter(Boolean)
  h += `<div class="cc-hdr">
    <span class="cc-name">Rm. ${esc(c.room)} — ${esc(c.name)}</span>
    <span class="cc-meta">${metaParts.join(' · ')}</span>
  </div>`

  // ── Basic Info ──
  if (sections.basic) {
    h += `<div class="sec">
      <div class="slbl">Basic Information</div>
      <table class="kv">
        <tr>
          <td class="k">Room</td><td>${esc(c.room)}</td>
          <td class="k">Phone</td><td>${esc(fmtPhone(c.phone))}</td>
        </tr><tr>
          <td class="k">Intake Date</td><td>${fd(c.intake_date)}</td>
          <td class="k">Days in Program</td><td>${days ?? '—'}</td>
        </tr>
        ${c.program_track   ? `<tr><td class="k">Program Track</td><td colspan="3">${esc(c.program_track)}</td></tr>` : ''}
        ${c.referral_source ? `<tr><td class="k">Referral Source</td><td colspan="3">${esc(c.referral_source)}</td></tr>` : ''}
      </table>
    </div>`
  }

  // ── Emergency Contacts ──
  if (sections.contacts) {
    let ecs = []
    try { ecs = JSON.parse(c.emergency_contacts || '[]') } catch { /* empty */ }
    if (!Array.isArray(ecs)) ecs = []
    h += `<div class="sec"><div class="slbl">Emergency Contacts</div>`
    h += ecs.length === 0
      ? `<div class="empty">None on record</div>`
      : `<table class="dt"><thead><tr><th>Name</th><th>Relationship</th><th>Phone</th></tr></thead><tbody>
          ${ecs.map(ec => `<tr><td>${esc(ec.name||'—')}</td><td>${esc(ec.relationship||'—')}</td><td>${esc(ec.phone||'—')}</td></tr>`).join('')}
        </tbody></table>`
    h += `</div>`
  }

  // ── UA Records ──
  if (sections.ua) {
    const recs = (data?.ua_records || [])
      .filter(r => r.client_id === c.id)
      .sort((a, b) => (b.tested_at||'').localeCompare(a.tested_at||''))
      .slice(0, limit)
    h += `<div class="sec"><div class="slbl">UA Records${recs.length ? ` <span class="sub">(${recs.length} most recent)</span>` : ''}</div>`
    h += recs.length === 0
      ? `<div class="empty">No UA records</div>`
      : `<table class="dt"><thead><tr><th>Date</th><th>Type</th><th>Result</th><th>Witnessed By</th><th>Notes</th></tr></thead><tbody>
          ${recs.map(r => `<tr>
            <td class="mo">${esc(fd(r.tested_at))}</td>
            <td>${esc(r.test_type||'—')}</td>
            <td class="${r.result==='POS'?'pos':r.result==='NEG'?'neg':''}">${esc(r.result||'—')}</td>
            <td>${esc(r.witnessed_by_name||'—')}</td>
            <td>${esc(r.notes||'')}</td>
          </tr>`).join('')}
        </tbody></table>`
    h += `</div>`
  }

  // ── Medication Log ──
  if (sections.meds) {
    const recs = (data?.med_log || [])
      .filter(r => r.client_id === c.id)
      .sort((a, b) => (b.administered_at||b.logged_at||'').localeCompare(a.administered_at||a.logged_at||''))
      .slice(0, limit)
    h += `<div class="sec"><div class="slbl">Medication Log${recs.length ? ` <span class="sub">(${recs.length} most recent)</span>` : ''}</div>`
    h += recs.length === 0
      ? `<div class="empty">No medication records</div>`
      : `<table class="dt"><thead><tr><th>Date/Time</th><th>Medication</th><th>Dose</th><th>Witnessed By</th><th>Notes</th></tr></thead><tbody>
          ${recs.map(r => `<tr>
            <td class="mo">${esc(fd(r.administered_at||r.logged_at))}</td>
            <td>${esc(r.medication||r.medication_name||'—')}</td>
            <td>${esc(r.dose||r.dosage||'—')}</td>
            <td>${esc(r.witnessed_by_name||'—')}</td>
            <td>${esc(r.notes||'')}</td>
          </tr>`).join('')}
        </tbody></table>`
    h += `</div>`
  }

  // ── Milestones ──
  if (sections.milestones) {
    const recs = (data?.milestones || [])
      .filter(m => m.client_id === c.id)
      .sort((a, b) => (a.due_date||'9999').localeCompare(b.due_date||'9999'))
    h += `<div class="sec"><div class="slbl">Milestones</div>`
    h += recs.length === 0
      ? `<div class="empty">No milestones</div>`
      : `<table class="dt"><thead><tr><th>Title</th><th>Due Date</th><th>Status</th><th>Completed</th></tr></thead><tbody>
          ${recs.map(m => {
            const done    = !!m.completed_at
            const overdue = !done && m.due_date && m.due_date < today
            return `<tr>
              <td>${esc(m.title||'—')}</td>
              <td class="mo">${fd(m.due_date)}</td>
              <td class="${done?'neg':overdue?'pos':''}">${done ? 'Complete' : overdue ? 'Overdue' : 'Pending'}</td>
              <td>${done ? fd(m.completed_at) + (m.signed_off_by ? ` · ${esc(m.signed_off_by)}` : '') : '—'}</td>
            </tr>`
          }).join('')}
        </tbody></table>`
    h += `</div>`
  }

  // ── Incidents ──
  if (sections.incidents) {
    const recs = (data?.incidents || [])
      .filter(i => i.client_id === c.id)
      .sort((a, b) => (b.logged_at||'').localeCompare(a.logged_at||''))
      .slice(0, limit)
    h += `<div class="sec"><div class="slbl">Incident Reports${recs.length ? ` <span class="sub">(${recs.length} most recent)</span>` : ''}</div>`
    h += recs.length === 0
      ? `<div class="empty">No incidents</div>`
      : `<table class="dt"><thead><tr><th>Date</th><th>Type</th><th>Severity</th><th>Status</th><th>Narrative</th></tr></thead><tbody>
          ${recs.map(i => `<tr>
            <td class="mo">${esc(fd(i.logged_at))}</td>
            <td>${esc(i.incident_type||'—')}</td>
            <td>${esc(i.severity||'—')}</td>
            <td>${esc(i.status||'—')}</td>
            <td>${esc(i.narrative||'')}</td>
          </tr>`).join('')}
        </tbody></table>`
    h += `</div>`
  }

  // ── Passes ──
  if (sections.passes) {
    const recs = (data?.passes || [])
      .filter(p => p.client_id === c.id)
      .sort((a, b) => (b.created_at||'').localeCompare(a.created_at||''))
      .slice(0, limit)
    h += `<div class="sec"><div class="slbl">Passes${recs.length ? ` <span class="sub">(${recs.length} most recent)</span>` : ''}</div>`
    h += recs.length === 0
      ? `<div class="empty">No pass records</div>`
      : `<table class="dt"><thead><tr><th>Departure</th><th>Return Date</th><th>Status</th><th>Notes</th></tr></thead><tbody>
          ${recs.map(p => `<tr>
            <td class="mo">${esc(fd(p.departure))}</td>
            <td class="mo">${fd(p.return_date)}</td>
            <td>${esc(p.status||'—')}</td>
            <td>${esc(p.notes||'')}</td>
          </tr>`).join('')}
        </tbody></table>`
    h += `</div>`
  }

  // ── Discharge Record ──
  if (sections.discharge) {
    const recs = (data?.discharge_records || [])
      .filter(r => r.client_id === c.id)
      .sort((a, b) => (b.discharge_date||'').localeCompare(a.discharge_date||''))
    if (recs.length === 0) {
      h += `<div class="sec"><div class="slbl">Discharge Record</div><div class="empty">No discharge records</div></div>`
    } else {
      recs.forEach(r => {
        let refs = []
        try { refs = JSON.parse(r.referrals_made || '[]') } catch { /* empty */ }
        if (!Array.isArray(refs)) refs = []
        h += `<div class="sec">
          <div class="slbl">Discharge Record — ${esc(fd(r.discharge_date))}</div>
          <table class="kv">
            <tr><td class="k">Reason</td><td colspan="3">${esc(DISCHARGE_LABELS[r.reason]||r.reason||'—')}</td></tr>
            <tr>
              <td class="k">Days in Program</td><td>${r.days_in_program ?? '—'}</td>
              <td class="k">Filed By</td><td>${esc(r.created_by_name||'—')}</td>
            </tr>
          </table>
          ${r.narrative     ? `<div class="narr">${esc(r.narrative)}</div>` : ''}
          ${r.aftercare_plan ? `<div class="narr green"><strong>Aftercare Plan:</strong> ${esc(r.aftercare_plan)}</div>` : ''}
          ${refs.length > 0 ? `
            <div class="sub-lbl" style="margin-top:8px">Referrals Made</div>
            <table class="dt"><thead><tr><th>Agency</th><th>Contact</th><th>Type</th><th>Date</th></tr></thead><tbody>
              ${refs.map(rf => `<tr>
                <td>${esc(rf.agency||'—')}</td>
                <td>${esc(rf.contact||'—')}</td>
                <td>${esc(rf.type||'—')}</td>
                <td class="mo">${fd(rf.date)}</td>
              </tr>`).join('')}
            </tbody></table>` : ''}
        </div>`
      })
    }
  }

  // ── Activity Timeline ──
  if (sections.timeline) {
    const cName = c.name.toLowerCase()
    const rm    = String(c.room)
    const tlEntries = []
    for (const report of (data?.reports || [])) {
      for (const entry of (report.log_entries || [])) {
        const t = (entry.text || '').toLowerCase()
        if (
          t.includes(cName) ||
          t.includes(`rm. ${rm}`) ||
          t.includes(`rm.${rm}`) ||
          t.includes(`room ${rm}`)
        ) {
          tlEntries.push({ ...entry, report_date: report.report_date, shift: report.shift })
        }
      }
    }
    tlEntries.sort((a, b) => {
      const rd = (b.report_date || '').localeCompare(a.report_date || '')
      if (rd !== 0) return rd
      return (b.created_at || '').localeCompare(a.created_at || '')
    })

    h += `<div class="sec"><div class="slbl">Activity Timeline <span class="sub">(${tlEntries.length} entr${tlEntries.length !== 1 ? 'ies' : 'y'})</span></div>`
    if (tlEntries.length === 0) {
      h += `<div class="empty">No activity log entries found for this resident.</div>`
    } else {
      tlEntries.forEach(e => {
        const type   = classifyLogEntry(e.text)
        const tStyle = TL_TYPE_STYLE[type] || TL_TYPE_STYLE.Note
        const isPos  = e.text && /POS:/.test(e.text)
        // Escape each text segment individually; wrap POS segments in <strong>
        const textHtml = isPos
          ? (e.text || '').split(/(POS:[^|<\n]+)/).map(part =>
              /^POS:/.test(part)
                ? `<strong style="color:#DC2626">${esc(part)}</strong>`
                : esc(part)
            ).join('')
          : esc(e.text || '')
        h += `<div class="tl-row${isPos ? ' tl-pos' : ''}">
          <div class="tl-meta">
            <div class="tl-time">${esc(e.time || '')}</div>
            <div class="tl-date">${esc(fd(e.report_date))}</div>
          </div>
          <div class="tl-body">
            <span class="tl-badge" style="${tStyle}">${esc(type)}</span>
            <div class="tl-text">${textHtml}</div>
          </div>
        </div>`
      })
    }
    h += `</div>`
  }

  h += `</div>` // close .cc
  return h
}

// Wraps all client cards in a full HTML document
function buildDoc(title, facility, printedAt, body, count) {
  const css = `
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:Calibri,Arial,sans-serif; font-size:11px; color:#111; background:#fff; }
    .wrap { max-width:10.5in; margin:0 auto; padding:16px 20px; }
    .rpt-hdr { background:#0f4c5c; color:#fff; padding:12px 16px; border-radius:8px 8px 0 0;
               border-bottom:3px solid #f97316; margin-bottom:16px; }
    .rpt-hdr h1 { font-size:1.1rem; font-weight:800; }
    .rpt-hdr .sub { color:#a8c0e8; font-size:.75rem; margin-top:3px; }
    .rpt-hdr .meta { color:#a8c0e8; font-size:.63rem; letter-spacing:.1em; text-transform:uppercase; margin-bottom:2px; }
    .cc { border:1px solid #e2e8f0; border-radius:8px; margin-bottom:16px;
          break-inside:avoid; page-break-inside:avoid; }
    .cc-hdr { background:#0f4c5c; color:#fff; padding:8px 14px; border-radius:7px 7px 0 0;
              display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px; }
    .cc-name { font-size:.95rem; font-weight:800; }
    .cc-meta { font-size:.7rem; color:#a8d0db; }
    .dis-badge { background:#fca5a5; color:#7f1d1d; padding:1px 6px; border-radius:8px;
                 font-size:.63rem; font-weight:700; }
    .sec { padding:8px 14px; border-top:1px solid #f1f5f9; }
    .slbl { font-size:.61rem; font-weight:700; color:#64748b; text-transform:uppercase;
            letter-spacing:.06em; margin-bottom:5px; }
    .sub { font-weight:400; color:#94a3b8; }
    .sub-lbl { font-size:.61rem; font-weight:700; color:#475569; margin-bottom:3px; }
    .empty { font-size:.76rem; color:#94a3b8; font-style:italic; }
    .kv { width:100%; border-collapse:collapse; font-size:.78rem; }
    .kv td { padding:2px 6px 2px 0; }
    .kv td.k { color:#64748b; font-weight:700; font-size:.61rem; text-transform:uppercase;
               letter-spacing:.04em; width:100px; }
    .dt { width:100%; border-collapse:collapse; font-size:.73rem; }
    .dt thead th { background:#f1f5f9; color:#475569; padding:3px 8px; text-align:left;
                   font-size:.6rem; letter-spacing:.05em; text-transform:uppercase; font-weight:700; }
    .dt tbody td { padding:4px 8px; border-bottom:1px solid #f8fafc; vertical-align:top; }
    .dt tbody tr:last-child td { border-bottom:none; }
    .mo { font-family:Consolas,monospace; font-size:.7rem; white-space:nowrap; }
    .pos { color:#991b1b; font-weight:800; }
    .neg { color:#15803d; font-weight:700; }
    .narr { font-size:.76rem; color:#334155; line-height:1.5; background:#f8fafc;
            border-radius:4px; padding:5px 10px; border:1px solid #e2e8f0; margin-top:5px; }
    .narr.green { background:#f0fdf4; border-color:#bbf7d0; }
    .footer { color:#64748b; font-size:.62rem; margin-top:10px; text-align:center;
              padding-top:6px; border-top:1px solid #e2e8f0; }
    .tl-row { display:flex; gap:12px; padding:6px 8px; border-bottom:1px solid #f1f5f9; }
    .tl-pos { background:#fff5f5 !important; border-left:3px solid #DC2626; }
    .tl-meta { flex-shrink:0; width:62px; text-align:right; }
    .tl-time { font-family:Consolas,monospace; font-size:.66rem; color:#0a4655; font-weight:700; }
    .tl-date { font-size:.58rem; color:#94a3b8; margin-top:1px; }
    .tl-body { flex:1; min-width:0; }
    .tl-badge { display:inline-block; margin-bottom:3px; font-size:.6rem; font-weight:700;
                padding:1px 7px; border-radius:8px; }
    .tl-text { font-size:.73rem; color:#0f172a; line-height:1.45; word-break:break-word; }
    .no-print { margin-bottom:10px; }
    .btn-p { background:#0f4c5c; color:#fff; border:none; padding:7px 14px;
             border-radius:6px; font-weight:700; cursor:pointer; font-family:inherit; }
    .btn-c { background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; padding:7px 14px;
             border-radius:6px; font-weight:700; cursor:pointer; font-family:inherit; margin-left:6px; }
    @media print {
      .no-print { display:none !important; }
      .wrap { padding:0; max-width:none; }
      @page { size:letter; margin:.4in; }
    }
  `
  const t = esc(title)
  const f = esc(facility)
  const p = esc(printedAt)
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${t}</title><style>${css}</style></head>
<body><div class="wrap">
<div class="no-print">
  <button class="btn-p" id="op-print">🖨 Print / Save PDF</button>
  <button class="btn-c" id="op-close">Close</button>
</div>
<div class="rpt-hdr">
  <div class="meta">${f} · Confidential</div>
  <h1>${t}</h1>
  <div class="sub">${count} resident${count !== 1 ? 's' : ''} · ${p}</div>
</div>
${body}
<div class="footer">OpsPoint · ${p} · Confidential — handle per HIPAA policy</div>
</div></body></html>`
}

// ── Section options ───────────────────────────────────────────────────────

const SECTION_OPTS = [
  { key: 'basic',      label: 'Basic Info',         desc: 'Room, phone, intake date, program track' },
  { key: 'contacts',   label: 'Emergency Contacts',  desc: 'Names & phones on file' },
  { key: 'ua',         label: 'UA Records',          desc: 'Urinalysis results' },
  { key: 'meds',       label: 'Med Log',             desc: 'Witnessed self-administrations' },
  { key: 'milestones', label: 'Milestones',          desc: 'Program milestone status' },
  { key: 'incidents',  label: 'Incident Reports',     desc: 'Behavioral incident reports' },
  { key: 'passes',     label: 'Passes',              desc: 'Pass history' },
  { key: 'discharge',  label: 'Discharge Info',      desc: 'Discharge record & aftercare plan' },
  { key: 'timeline',   label: 'Activity Timeline',   desc: 'Log entries mentioning this resident' },
]
const LIMIT_SECTIONS = new Set(['ua', 'meds', 'incidents', 'passes'])

// ── Modal component ───────────────────────────────────────────────────────

export default function ClientReportModal({ data, onClose }) {
  const [title,        setTitle]        = useState('Client Report')
  const [clientFilter, setClientFilter] = useState('active')
  const [selectedIds,  setSelectedIds]  = useState([])
  const [sections,     setSections]     = useState({
    basic: true, contacts: false, ua: false, meds: false,
    milestones: false, incidents: false, passes: false, discharge: false,
    timeline: false,
  })
  const [limit, setLimit] = useState(5)

  const allClients = data?.clients || []
  const residents = allClients
    .filter(c => !c.is_special && c.name !== 'VACANT')
    .sort((a, b) => (parseInt(a.room)||0) - (parseInt(b.room)||0))
  const activeResidents = residents.filter(c => c.is_active)

  function toggleSection(k) { setSections(s => ({ ...s, [k]: !s[k] })) }
  function toggleId(id) { setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]) }

  function getTargets() {
    if (clientFilter === 'active') return activeResidents
    if (clientFilter === 'all')    return residents
    return residents.filter(c => selectedIds.includes(c.id))
  }

  function generate() {
    const targets = getTargets()
    if (targets.length === 0) { alert('No clients selected.'); return }
    const facilityName = data?.settings?.facility_name || 'OpsPoint'
    const printedAt = new Date().toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
    const body = targets.map(c => buildCard(c, data, sections, limit)).join('')
    const html = buildDoc(title, facilityName, printedAt, body, targets.length)

    const win = window.open('', '_blank')
    if (!win) { alert('Popup blocked — allow popups for this site.'); return }
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

  const showLimit = SECTION_OPTS.some(s => LIMIT_SECTIONS.has(s.key) && sections[s.key])

  return (
    <Modal show size="lg" onClose={onClose}>
      <ModalHeader>📊 Build Client Report</ModalHeader>
      <ModalBody>

          {/* Report title */}
          <Field label="Report Title" className="mb-3">
            <TextInput value={title} onChange={e => setTitle(e.target.value)} />
          </Field>

          {/* Client selection */}
          <div className="field">
            <label>Include Clients</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {[
                { val: 'active', lbl: `Active residents only (${activeResidents.length})` },
                { val: 'all',    lbl: `All residents including discharged (${residents.length})` },
                { val: 'select', lbl: 'Select specific residents…' },
              ].map(opt => (
                <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '.83rem', cursor: 'pointer' }}>
                  <input type="radio" name="rpt-filter" value={opt.val}
                    checked={clientFilter === opt.val}
                    onChange={() => { setClientFilter(opt.val); setSelectedIds([]) }} />
                  {opt.lbl}
                </label>
              ))}
            </div>

            {/* Resident checklist when "select" chosen */}
            {clientFilter === 'select' && (
              <div style={{
                marginTop: 8, border: '1px solid var(--border-light)', borderRadius: 6,
                maxHeight: 160, overflowY: 'auto', background: '#fff',
              }}>
                {residents.map(c => (
                  <label key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                    fontSize: '.81rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                    background: selectedIds.includes(c.id) ? '#f0f9ff' : 'transparent',
                  }}>
                    <input type="checkbox" checked={selectedIds.includes(c.id)}
                      onChange={() => toggleId(c.id)} />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.74rem', color: '#64748b', minWidth: 28 }}>
                      {c.room}
                    </span>
                    {c.name}
                    {!c.is_active && (
                      <span style={{
                        fontSize: '.62rem', fontWeight: 700, background: '#fee2e2',
                        color: '#991b1b', padding: '1px 5px', borderRadius: 8, marginLeft: 4,
                      }}>Discharged</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Section toggles */}
          <div className="field">
            <label>Sections to Include</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', marginTop: 6 }}>
              {SECTION_OPTS.map(s => (
                <label key={s.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: '.81rem', cursor: 'pointer',
                  padding: '6px 8px', borderRadius: 5, border: '1px solid',
                  borderColor: sections[s.key] ? '#c9780c' : 'var(--border-light)',
                  background:  sections[s.key] ? '#fff8ed' : 'transparent',
                  transition: 'border-color .1s, background .1s',
                }}>
                  <input type="checkbox" checked={sections[s.key]}
                    onChange={() => toggleSection(s.key)} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.label}</div>
                    <div style={{ fontSize: '.7rem', color: '#94a3b8', marginTop: 1 }}>{s.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Max records per timed section */}
          {showLimit && (
            <div className="field">
              <label>
                Max records per section
                <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 4 }}>(UA, Meds, Incident Reports, Passes)</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <TextInput type="number" min={1} max={50} value={limit} className="w-20"
                  onChange={e => setLimit(Math.max(1, Math.min(50, parseInt(e.target.value) || 5)))} />
                <span style={{ fontSize: '.78rem', color: '#64748b' }}>most recent per resident</span>
              </div>
            </div>
          )}

      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={generate}>🖨 Generate &amp; Print</Button>
      </ModalFooter>
    </Modal>
  )
}
