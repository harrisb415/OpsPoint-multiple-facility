// ════════════════════════════════════════════════════════════════════════
// Shared helpers for the Structured Clinical Lite section.
// Reuses the app's existing modal / field / button CSS classes for visual
// consistency with the rest of OpsPoint.
// ════════════════════════════════════════════════════════════════════════
import { NotebookPen, Target, Award, ClipboardList, Users, Siren, DoorOpen } from 'lucide-react'
import { Modal as FbModal, ModalHeader, ModalBody, ModalFooter } from 'flowbite-react'

// Navigation entries for the clinical section. `perm` (single) or `perms`
// (any-of) controls visibility. `icon` is a lucide-react component.
// `key` is the ui_visibility.tabs key for the page — the same key the Admin
// Features panel writes and the rail reads, so the two can't drift apart.
export const CLINICAL_NAV = [
  { key: 'clinical_notes',      path: '/clinical/notes',           label: 'Clinical Notes',      perm: 'clinical.notes',       icon: NotebookPen },
  { key: 'clinical_treatment',  path: '/clinical/treatment-plans', label: 'Treatment Plans',     perm: 'clinical.treatment',   icon: Target },
  { key: 'clinical_milestones', path: '/clinical/milestones',      label: 'Milestones',          perms: ['milestones.edit', 'milestones.signoff'], icon: Award },
  { key: 'clinical_assessments',path: '/clinical/assessments',     label: 'Assessments',         perm: 'clinical.assessments', icon: ClipboardList },
  { key: 'clinical_groups',     path: '/clinical/group-notes',     label: 'Group Notes',         perm: 'clinical.groups',      icon: Users },
  { key: 'clinical_incidents',  path: '/clinical/incidents',       label: 'Incident Reports',    perms: ['incidents.log', 'incidents.review', 'incidents.delete'], icon: Siren },
  { key: 'clinical_discharge',  path: '/clinical/discharge',       label: 'Discharge Summaries', perm: 'clinical.discharge',   icon: DoorOpen },
]

// ui_visibility gate. Everything defaults to visible, so a facility that has
// never opened the Features panel — and any key added in a later version —
// keeps working unchanged. `clinical` is the master switch for the section.
export function isFeatureVisible(vis, key) {
  return vis?.tabs?.[key] !== false
}
export function clinicalSectionEnabled(vis) {
  return isFeatureVisible(vis, 'clinical')
}

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
const STATUS_BADGE = {
  draft: 'warning', final: 'success', amended: 'info',
  active: 'success', completed: 'info', discontinued: 'gray',
  signed: 'success', pending: 'warning', reviewed: 'info',
}
const _SB_CLS = { success:'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', warning:'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300', info:'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', gray:'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' }
export function StatusBadge({ status }) {
  const label = String(status || '')
  return <span className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap ${_SB_CLS[STATUS_BADGE[status]] || _SB_CLS.gray}`}>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
}

// ── Generic chip badge ─────────────────────────────────────────────────────
export function Chip({ children, className = 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300' }) {
  return (
    <span className={`text-[.68rem] font-bold px-2.5 py-0.5 rounded-full capitalize whitespace-nowrap ${className}`}>{children}</span>
  )
}

// ── Modal (flowbite Modal; dark-aware) ─────────────────────────────────────
// Parents conditionally mount this (`{open && <Modal .../>}`), so `show` is true
// whenever it's rendered. maxWidth maps to the closest flowbite size token.
function sizeFor(maxWidth) {
  if (maxWidth <= 440) return 'md'
  if (maxWidth <= 520) return 'lg'
  if (maxWidth <= 640) return 'xl'
  return '2xl'
}
export function Modal({ title, onClose, children, footer, maxWidth = 580 }) {
  return (
    <FbModal show size={sizeFor(maxWidth)} onClose={onClose}>
      <ModalHeader>{title}</ModalHeader>
      <ModalBody>{children}</ModalBody>
      {footer && <ModalFooter className="justify-end">{footer}</ModalFooter>}
    </FbModal>
  )
}

// ── Shared Tailwind class strings for form controls ────────────────────────
export const inp = 'w-full px-2.5 py-[7px] text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500 outline-none'
export const lbl = 'block text-[.72rem] font-bold tracking-[.04em] uppercase text-gray-500 dark:text-gray-400 mb-1'
export const field = 'mb-3.5'

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
    <span className="text-[.72rem] font-semibold text-green-700 dark:text-green-400">
      Signed {fmtDate(row.signed_at)}
    </span>
  )
}
