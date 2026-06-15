// ════════════════════════════════════════════════════════════════════════
// Shared helpers for the Structured Clinical Lite section.
// Reuses the app's existing modal / field / button CSS classes for visual
// consistency with the rest of OpsPoint.
// ════════════════════════════════════════════════════════════════════════
import { NotebookPen, Target, Award, ClipboardList, Users, Siren, DoorOpen } from 'lucide-react'
import { Badge } from '../../components/console.jsx'

// Navigation entries for the clinical section. `perm` (single) or `perms`
// (any-of) controls visibility. `icon` is a lucide-react component.
export const CLINICAL_NAV = [
  { path: '/clinical/notes',           label: 'Clinical Notes',      perm: 'clinical.notes',       icon: NotebookPen },
  { path: '/clinical/treatment-plans', label: 'Treatment Plans',     perm: 'clinical.treatment',   icon: Target },
  { path: '/clinical/milestones',      label: 'Milestones',          perms: ['milestones.edit', 'milestones.signoff'], icon: Award },
  { path: '/clinical/assessments',     label: 'Assessments',         perm: 'clinical.assessments', icon: ClipboardList },
  { path: '/clinical/group-notes',     label: 'Group Notes',         perm: 'clinical.groups',      icon: Users },
  { path: '/clinical/incidents',       label: 'Incident Reports',    perms: ['incidents.log', 'incidents.review', 'incidents.delete'], icon: Siren },
  { path: '/clinical/discharge',       label: 'Discharge Summaries', perm: 'clinical.discharge',   icon: DoorOpen },
]

// Every permission that grants access to *something* in the clinical section.
// Drives the sidebar "Clinical" button, the /clinical route guard, and the
// rail nav. A user with any one of these can enter the section.
export const CLINICAL_SECTION_PERMS = [
  'clinical.notes', 'clinical.treatment', 'clinical.assessments', 'clinical.groups', 'clinical.discharge',
  'milestones.edit', 'milestones.signoff',
  'incidents.log', 'incidents.review', 'incidents.delete',
]

// True if a permission-check fn (hasPerm) grants any clinical-section access.
export function navItemVisible(item, hasPerm) {
  return item.perms ? item.perms.some(hasPerm) : hasPerm(item.perm)
}

// ── REST helper for a clinical resource ──────────────────────────────────
export function clinicalApi(seg) {
  const base = `/api/clinical/${seg}`
  const j = async (r) => {
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || 'Request failed')
    return d
  }
  const H = { 'Content-Type': 'application/json' }
  return {
    create: (body)     => fetch(base, { method: 'POST', headers: H, credentials: 'include', body: JSON.stringify(body) }).then(j),
    update: (id, body) => fetch(`${base}/${id}`, { method: 'PUT', headers: H, credentials: 'include', body: JSON.stringify(body) }).then(j),
    sign:   (id)       => fetch(`${base}/${id}/sign`, { method: 'PATCH', headers: H, credentials: 'include', body: '{}' }).then(j),
    remove: (id)       => fetch(`${base}/${id}`, { method: 'DELETE', headers: H, credentials: 'include' }).then(j),
  }
}

// ── Formatting / lookup ──────────────────────────────────────────────────
export function fmtDate(d) {
  if (!d) return '—'
  // Accept 'YYYY-MM-DD' or full timestamps
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00' : d
  const dt = new Date(iso)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function activeClients(clients) {
  return (clients || []).filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
}

export function clientLabel(clients, id) {
  const c = (clients || []).find(x => x.id === id)
  return c ? `${c.name}${c.room ? ` · Rm ${c.room}` : ''}` : `Client #${id}`
}

// Look up a display label from an array of [value, label] pairs, falling back
// to the raw value if not found.
export function labelOf(pairs, val) {
  const hit = (pairs || []).find(p => p[0] === val)
  return hit ? hit[1] : val
}

export function todayStr() {
  const d = new Date(), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ── Status badge ─────────────────────────────────────────────────────────
const STATUS_TONE = {
  draft: 'yellow', final: 'green', amended: 'blue',
  active: 'green', completed: 'blue', discontinued: 'gray',
  signed: 'green', pending: 'yellow', reviewed: 'blue',
}
export function StatusBadge({ status }) {
  const label = String(status || '')
  return <Badge tone={STATUS_TONE[status] || 'gray'}>{label.charAt(0).toUpperCase() + label.slice(1)}</Badge>
}

// ── Generic chip badge ─────────────────────────────────────────────────────
export function Chip({ children, bg = '#f1f5f9', fg = '#475569' }) {
  return (
    <span style={{
      background: bg, color: fg, fontSize: '.68rem', fontWeight: 700,
      padding: '2px 9px', borderRadius: 20, textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

// ── Modal (reuses .modal* classes from index.css) ──────────────────────────
export function Modal({ title, onClose, children, footer, maxWidth = 580 }) {
  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth, width: '100%' }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ── Shared inline styles for form controls ─────────────────────────────────
export const inp = {
  width: '100%', padding: '7px 10px', fontSize: '.85rem',
  border: '1px solid var(--line, #cbd5e1)', borderRadius: 6,
  fontFamily: 'var(--sans)', background: '#fff',
}
export const lbl = {
  display: 'block', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.04em',
  textTransform: 'uppercase', color: '#64748b', marginBottom: 4,
}
export const field = { marginBottom: 14 }

// ── Empty-state row ─────────────────────────────────────────────────────────
export function EmptyState({ children }) {
  return (
    <div className="p-10 text-sm text-center text-gray-400 bg-white border border-gray-200 border-dashed rounded-xl dark:bg-gray-800 dark:border-gray-700">
      {children}
    </div>
  )
}

// Signed-by footer line for finalised records
export function SignedLine({ row }) {
  if (!row?.signed_at) return null
  return (
    <span style={{ fontSize: '.72rem', color: '#15803d', fontWeight: 600 }}>
      🔒 Signed {fmtDate(row.signed_at)}
    </span>
  )
}
