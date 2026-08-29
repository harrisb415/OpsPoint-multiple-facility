import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Settings, ArrowLeft, Users, UserPlus, KeyRound, ShieldCheck,
  Tag, DoorOpen, MonitorCog, Map, FlaskConical, ClipboardList,
  AlertTriangle, ScrollText, Tags} from 'lucide-react'
import {
  Alert, Badge, Button, Checkbox, Label, Modal, ModalHeader, ModalBody, ModalFooter,
  Select, Textarea, TextInput,
} from 'flowbite-react'
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from '../components/table.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { usePermission } from '../hooks/usePermission.js'
import { useConfirm } from '../components/ui.jsx'
import { CLINICAL_NAV } from './clinical/clinicalShared.jsx'
import { STATUS_TONES, TONE_BADGE, TONE_DOT, DEFAULT_STATUSES, isSystemStatus } from '../utils/statuses.js'

// ── Shared card section wrapper ───────────────────────────────────
function Section({ title, right, noPad = false, className = '', children }) {
  return (
    <div className={`mb-5 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden transition-shadow duration-200 hover:shadow-lg dark:bg-gray-800 dark:border-gray-700 ${className}`}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary-100 bg-gradient-to-r from-primary-50 to-transparent dark:border-gray-700 dark:from-gray-700/40">
        <div className="flex items-center gap-2.5 font-display text-[.95rem] font-semibold tracking-tight text-gray-900 dark:text-white">
          <span className="w-2 h-2 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 shrink-0" />
          {title}
        </div>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
      <div className={noPad ? '' : 'p-5'}>
        {children}
      </div>
    </div>
  )
}

function SaveMsg({ ok }) {
  return ok ? <span className="text-sm font-semibold text-green-600 dark:text-green-400">✓ Saved</span> : null
}

// Group badge Tailwind classes keyed by group key
const GROUP_BADGE_CLS = {
  admin:        'bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  supervisor:   'bg-violet-100 text-violet-700 border border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800',
  pa:           'bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
  case_manager: 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800',
}
const GROUP_BADGE_DEFAULT = 'bg-gray-100 text-gray-600 border border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'

// Audit action badge Tailwind classes keyed by action prefix
const ACT_CLS = {
  auth:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  report:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  log:      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  status:   'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  client:   'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  passes:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  mail:     'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  staff:    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  ua:       'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  facility: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  user:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  group:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  server:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const ACT_CLS_DEFAULT = 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
function actionBadgeCls(action) {
  return ACT_CLS[(action || '').split('.')[0]] || ACT_CLS_DEFAULT
}

// ── Admin sections (clinical-style left rail) ─────────────────────
// Each item maps to a single content panel — no nested sub-tabs. Grouped and
// permission-filtered exactly like the Clinical section's rail. `icon` is a
// lucide-react component.
const ADMIN_NAV = [
  { group: 'Accounts', items: [
    { key: 'users:staff',   label: 'Staff & Users',     icon: Users,       perm: 'admin.users' },
    { key: 'users:add',     label: 'Add User',          icon: UserPlus,    perm: 'admin.users' },
    { key: 'users:reset',   label: 'Reset Password',    icon: KeyRound,    perm: 'admin.users' },
    { key: 'users:groups',  label: 'Permission Groups', icon: ShieldCheck, perm: 'admin.users' },
  ] },
  { group: 'Facility', items: [
    { key: 'fac:general',   label: 'General',          icon: Tag,           perm: 'admin.settings' },
    { key: 'fac:rooms',     label: 'Rooms',            icon: DoorOpen,      perm: 'facility.manage' },
    { key: 'fac:statuses',  label: 'Statuses',         icon: Tags,          perm: 'admin.settings' },
    { key: 'fac:display',   label: 'Features',         icon: MonitorCog,    perm: 'admin.settings' },
    { key: 'fac:walk',      label: 'Walk Areas',       icon: Map,           perm: 'admin.settings' },
    { key: 'fac:ua',        label: 'UA Panel',         icon: FlaskConical,  perm: 'admin.settings' },
    { key: 'fac:ehr',       label: 'EHR / Compliance', icon: ClipboardList, perm: 'admin.settings' },
    { key: 'fac:resetfac',  label: 'Reset Facility',   icon: AlertTriangle, perm: 'facility.manage', danger: true },
  ] },
  { group: 'Records', items: [
    { key: 'audit', label: 'Audit Log', icon: ScrollText, perm: 'admin.audit' },
  ] },
  { group: 'System', items: [
    { key: 'system', label: 'System', icon: Settings, perm: 'admin.system' },
  ] },
]

export default function Admin() {
  const { hasPerm } = usePermission()

  // Permission-filter the rail; drop empty groups.
  const groups = ADMIN_NAV
    .map(g => ({ ...g, items: g.items.filter(i => hasPerm(i.perm)) }))
    .filter(g => g.items.length > 0)
  const [active, setActive] = useState(groups[0]?.items[0]?.key || 'users:staff')

  function renderPanel() {
    if (active.startsWith('users:')) return <UserManagementTab panel={active.slice(6)} />
    if (active.startsWith('fac:'))   return <FacilitySetupTab panel={active.slice(4)} />
    if (active === 'audit')          return <AuditLogTab />
    if (active === 'system')         return <SystemTab />
    return null
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      {/* Rail */}
      <aside className="fixed top-0 left-0 z-40 flex flex-col h-screen w-60 bg-gradient-to-b from-primary-950 via-[#241f52] to-[#2d1b4e] border-r border-primary-950/60 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 dark:border-gray-700">
        <div className="flex items-center gap-2.5 h-16 px-4 border-b shrink-0 border-white/10 dark:border-gray-700">
          <span className="flex items-center justify-center rounded-lg w-9 h-9 bg-gradient-to-br from-primary-400 to-accent-500 text-white dark:from-primary-600 dark:to-accent-600">
            <Settings className="w-5 h-5" />
          </span>
          <div className="leading-tight">
            <p className="font-display text-lg font-semibold tracking-tight text-white">Administration</p>
            <p className="text-[11px] text-indigo-200/60">System configuration</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-3 overflow-y-auto [scrollbar-color:theme(colors.slate.600)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600 hover:[&::-webkit-scrollbar-thumb]:bg-slate-500">
          {groups.map(g => (
            <div key={g.group} className="mb-1">
              <p className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-indigo-300/70 uppercase dark:text-gray-500">{g.group}</p>
              <div className="space-y-1">
                {g.items.map(it => {
                  const isActive = active === it.key
                  const Icon = it.icon
                  const cls = isActive
                    ? 'bg-gradient-to-r from-primary-500 to-accent-500 text-white shadow-lg shadow-primary-900/40 dark:from-primary-600 dark:to-accent-600'
                    : it.danger
                      ? 'text-red-400 hover:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/30'
                      : 'text-indigo-200/80 hover:bg-white/10 hover:text-white dark:text-gray-300 dark:hover:bg-gray-700'
                  const iconCls = isActive
                    ? 'text-white'
                    : it.danger ? 'text-red-400' : 'text-indigo-300/70 group-hover:text-white'
                  return (
                    <button key={it.key} onClick={() => setActive(it.key)}
                      className={`flex items-center w-full gap-3 px-3 py-2 text-sm font-medium text-left rounded-lg group ${cls}`}>
                      <Icon className={`w-5 h-5 ${iconCls}`} />
                      <span className="flex-1">{it.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t shrink-0 border-white/10 dark:border-gray-700">
          <Link to="/" className="flex items-center justify-center w-full gap-2 px-3 py-2 text-sm font-semibold text-indigo-100 bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 hover:text-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700">
            <ArrowLeft className="w-4 h-4" /> Return to shift
          </Link>
        </div>
      </aside>

      {/* Content */}
      <div className="h-full ml-60 min-w-0 px-6 py-5 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        {renderPanel()}
      </div>
    </div>
  )
}

// ── Shared helpers ────────────────────────────────────────────────

function apiFetch(url, opts = {}) {
  return fetch(url, { credentials: 'include', ...opts })
}

const PERM_CATEGORIES = [
  { label: 'Shift Reports',    perms: ['reports.create','reports.close','reports.delete'] },
  { label: 'Log Entries',      perms: ['log.add','log.delete','issues.edit'] },
  { label: 'Residents',        perms: ['status.edit','residents.edit'] },
  { label: 'Staff Directory',  perms: ['staff.edit'] },
  { label: 'Chores',           perms: ['chores.assign', 'chores.log'] },
  { label: 'Weekend Passes',   perms: ['passes.edit','passes.status'] },
  { label: 'Reminders',        perms: ['reminders.view'] },
  { label: 'UA',               perms: ['ua.request','ua.acknowledge','ua.delete','ua.record','ua.draw'] },
  { label: 'Mail Management',  perms: ['mail.log','mail.approve','mail.deliver','mail.delete'] },
  { label: 'Violations',      perms: ['violations.log','violations.review','violations.complete','violations.delete','violations.notify_review','violations.notify_consequence'] },
  { label: 'Announcements',    perms: ['broadcast.send','broadcast.receive'] },
  { label: 'Milestones',       perms: ['milestones.edit','milestones.signoff'] },
  { label: 'Incidents',        perms: ['incidents.log','incidents.review','incidents.delete'] },
  { label: '42 CFR Part 2',    perms: ['consent.manage','disclosures.view'] },
  { label: 'Groups',           perms: ['groups.view','groups.log'] },
  { label: 'Clinical Charting', perms: ['clinical.notes','clinical.treatment','clinical.assessments','clinical.groups','clinical.discharge'] },
  { label: 'Records Unlock',   perms: ['records.unlock'] },
  { label: 'Facility Manage',  perms: ['facility.manage'] },
  { label: 'Administration',   perms: ['admin.users','admin.settings','admin.audit','admin.system'] },
  { label: 'Mobile Access',    perms: ['mobile.access'] },
]

const PERM_LABELS = {
  'reports.create':'Create / save reports','reports.close':'Close a shift','reports.delete':'Delete reports',
  'log.add':'Add log entries','log.delete':'Delete log entries','issues.edit':'Issues & medical notes',
  'status.edit':'Change resident statuses','residents.edit':'Edit resident info','staff.edit':'Manage staff',
  'chores.assign':'Assign chores to residents',
  'chores.log':'Log chore completions','passes.edit':'Create / edit passes & notice','passes.status':'Check pass in / out',
  'reminders.view':'Wellness & walkthrough reminders','ua.request':'Flag resident for UA','ua.acknowledge':'Acknowledge UA alert',
  'ua.delete':'Delete UA entries','mail.log':'Log incoming mail','mail.approve':'Approve mail for delivery',
  'mail.deliver':'Mark mail as delivered to resident','mail.delete':'Delete mail records','violations.log':'Log violation','violations.review':'Review / assign consequence',
  'violations.complete':'Mark consequence completed','violations.delete':'Delete violation records',
  'violations.notify_review':'Banner — pending review','violations.notify_consequence':'Banner — consequence assigned',
  'facility.manage':'Room & roster management','admin.users':'User management','admin.settings':'Facility settings',
  'admin.audit':'View audit log','admin.system':'Server controls','mobile.access':'Use mobile shift app',
  'ua.record':'Create / edit UA records',
  'milestones.edit':'Create / edit milestones','milestones.signoff':'Sign off completed milestones (counselor)',
  'incidents.log':'Log a behavioral incident','incidents.review':'Supervisor review of incident','incidents.delete':'Delete incident reports',
  'consent.manage':'Manage 42 CFR Part 2 consent records','disclosures.view':'View disclosure audit',
  'records.unlock':'Supervisor override — unlock sealed records past 24h',
  'groups.view':'View group sessions and attendance',
  'groups.log':'Log group sessions and mark attendance',
  'clinical.notes':'Create / edit clinical notes','clinical.treatment':'Create / edit treatment plans',
  'clinical.assessments':'Create / edit assessments','clinical.groups':'Create / edit group notes',
  'clinical.discharge':'Create / edit discharge summaries',
  'ua.draw':'Run the random UA draw','broadcast.send':'Send announcements to all staff',
  'broadcast.receive':'Receive announcements in the bell',
}

// Higher-level domains that group the fine-grained categories above into
// collapsible sections in the permission editor.
const PERM_DOMAINS = [
  { label: 'Daily Operations',        cats: ['Shift Reports', 'Log Entries', 'Reminders', 'Chores', 'Weekend Passes', 'Mail Management'] },
  { label: 'People',                  cats: ['Residents', 'Staff Directory'] },
  { label: 'Health & UA',             cats: ['UA', 'Med Witnessing'] },
  { label: 'Clinical & Compliance',   cats: ['Clinical Charting', 'Milestones', 'Incidents', 'Groups', '42 CFR Part 2', 'Records Unlock'] },
  { label: 'Conduct & Communication', cats: ['Violations', 'Announcements'] },
  { label: 'Administration & Access', cats: ['Facility Manage', 'Administration', 'Mobile Access'] },
]
const _CAT_BY_LABEL = Object.fromEntries(PERM_CATEGORIES.map(c => [c.label, c]))

// Tri-state checkbox — checked / indeterminate (some) / empty.
function TriCheck({ checked, indeterminate, disabled, onChange }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = !checked && indeterminate }, [checked, indeterminate])
  return (
    <input ref={ref} type="checkbox" checked={checked} disabled={disabled}
      onClick={e => e.stopPropagation()} onChange={onChange}
      className={`w-3.5 h-3.5 shrink-0 rounded border-gray-300 text-primary-600 dark:border-gray-600 dark:bg-gray-700 ${disabled ? 'cursor-default' : 'cursor-pointer'}`} />
  )
}

function PermEditor({ value, onChange, disabled }) {
  const [search, setSearch] = useState('')
  const [openDomains, setOpenDomains] = useState(() => new Set())
  const q = search.trim().toLowerCase()
  const searching = q.length > 0

  const matches = p => !q || p.includes(q) || (PERM_LABELS[p] || '').toLowerCase().includes(q)
  const domainPerms = d => d.cats.flatMap(cl => (_CAT_BY_LABEL[cl]?.perms) || [])

  function toggle(p) {
    if (disabled) return
    onChange(value.includes(p) ? value.filter(x => x !== p) : [...value, p])
  }
  function setMany(perms, grant) {
    if (disabled) return
    const set = new Set(value)
    perms.forEach(p => grant ? set.add(p) : set.delete(p))
    onChange([...set])
  }
  const allOpen = openDomains.size >= PERM_DOMAINS.length
  function toggleDomain(label) {
    setOpenDomains(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n })
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden dark:border-gray-600">
      <div className="flex gap-2 items-center px-2.5 py-2 bg-gray-100 border-b border-gray-200 dark:bg-gray-700 dark:border-gray-600">
        <TextInput sizing="sm" type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search permissions…" className="flex-1" />
        <Button size="xs" color="light" type="button"
          onClick={() => setOpenDomains(allOpen ? new Set() : new Set(PERM_DOMAINS.map(d => d.label)))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>

      {PERM_DOMAINS.map(d => {
        const all = domainPerms(d)
        const visiblePerms = all.filter(matches)
        if (searching && visiblePerms.length === 0) return null
        const granted = all.filter(p => value.includes(p)).length
        const allGranted = all.length > 0 && granted === all.length
        const isOpen = searching || openDomains.has(d.label)

        return (
          <div key={d.label} className="border-b border-gray-200 last:border-0 dark:border-gray-600">
            <div onClick={() => !searching && toggleDomain(d.label)}
              className={`flex items-center gap-2.5 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 ${!searching ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : 'cursor-default'}`}>
              <span className="text-gray-400 text-xs w-3 shrink-0">{isOpen ? '▾' : '▸'}</span>
              <span className="font-bold text-xs flex-1 text-gray-700 dark:text-gray-200">{d.label}</span>
              <span className={`text-[10px] font-bold px-2 py-px rounded-full border bg-white dark:bg-gray-800 dark:border-gray-600 ${granted ? 'text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-700' : 'text-gray-400 border-gray-200'}`}>
                {granted} / {all.length}
              </span>
              <TriCheck checked={allGranted} indeterminate={granted > 0 && !allGranted} disabled={disabled}
                onChange={() => setMany(all, !allGranted)} />
            </div>

            {isOpen && d.cats.map(cl => {
              const cat = _CAT_BY_LABEL[cl]; if (!cat) return null
              const vp = cat.perms.filter(matches)
              if (vp.length === 0) return null
              return (
                <div key={cl}>
                  <div className="px-3 py-1 pl-7 bg-gray-50/60 text-[10px] font-bold text-gray-400 uppercase tracking-wide dark:bg-gray-700/30 dark:text-gray-500">{cl}</div>
                  {vp.map(p => (
                    <label key={p}
                      className={`flex items-center gap-2.5 px-3 py-1.5 pl-8 border-t border-gray-100 dark:border-gray-700 transition-colors
                        ${disabled ? 'opacity-60 cursor-default' : 'cursor-pointer'}
                        ${value.includes(p) ? 'bg-blue-50 dark:bg-blue-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                      <input type="checkbox" checked={value.includes(p)} disabled={disabled}
                        onChange={() => toggle(p)} className="w-3 h-3 shrink-0 rounded border-gray-300 text-primary-600 dark:border-gray-600 dark:bg-gray-700" />
                      <span className="font-mono text-[11px] text-gray-500 min-w-[190px] dark:text-gray-400">{p}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{PERM_LABELS[p] || ''}</span>
                    </label>
                  ))}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// USER MANAGEMENT TAB
// ══════════════════════════════════════════════════════════════════

function UserManagementTab({ panel }) {
  const sub = panel || 'staff'   // driven by the Admin rail
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])

  const load = useCallback(async () => {
    const [ur, gr] = await Promise.all([apiFetch('/api/users'), apiFetch('/api/groups')])
    if (ur.ok) setUsers(await ur.json())
    if (gr.ok) setGroups(await gr.json())
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      {sub === 'staff'  && <CurrentStaff users={users} groups={groups} reload={load} />}
      {sub === 'add'    && <AddStaff groups={groups} reload={load} />}
      {sub === 'reset'  && <ResetPassword users={users} />}
      {sub === 'groups' && <GroupsManager groups={groups} reload={load} />}
    </div>
  )
}

// ── Current Staff ─────────────────────────────────────────────────

function CurrentStaff({ users, groups, reload }) {
  const { session } = useAuth()
  const confirm = useConfirm()
  const [groupModal, setGroupModal] = useState(null)
  const [memberOf, setMemberOf] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function fmtDate(s) {
    if (!s) return '—'
    try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
    catch { return s }
  }

  function openGroups(u) {
    setMemberOf((u.groups || []).map(g => g.id))
    setError('')
    setGroupModal(u)
  }

  async function saveGroups() {
    setSaving(true); setError('')
    try {
      const r = await apiFetch(`/api/users/${groupModal.id}/groups`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: memberOf }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Save failed'); return }
      setGroupModal(null); reload()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  async function toggleProtect(u) {
    await apiFetch(`/api/users/${u.id}/protect`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    reload()
  }

  async function del(u) {
    if (!await confirm({ title: `Remove ${u.displayName || u.display_name || u.username}?`, confirmText: 'Remove', color: 'red' })) return
    const r = await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' })
    if (!r.ok) { const j = await r.json(); alert(j.error || 'Delete failed') }
    else reload()
  }

  return (
    <div>
      <Section title="Current Staff" noPad
        right={<span className="font-mono text-xs text-gray-400">{users.length} account{users.length !== 1 ? 's' : ''}</span>}>
        <Table hoverable flush>
            <TableHead>
              <TableHeadCell>Username</TableHeadCell>
              <TableHeadCell>Display Name</TableHeadCell>
              <TableHeadCell>Member Of</TableHeadCell>
              <TableHeadCell>Created</TableHeadCell>
              <TableHeadCell className="text-center">Actions</TableHeadCell>
            </TableHead>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {u.username}
                    {u.is_protected && <span title="Protected" className="ml-1.5 text-amber-500">🔒</span>}
                    {u.must_change_pw && <span className="ml-1.5 text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-px rounded-full dark:bg-red-900/30 dark:text-red-400">pw reset</span>}
                  </TableCell>
                  <TableCell className="font-semibold text-gray-800 dark:text-white">{u.displayName || u.display_name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(u.groups || []).map(g => (
                        <span key={g.id} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${GROUP_BADGE_CLS[g.key] || GROUP_BADGE_DEFAULT}`}>
                          {g.label}
                        </span>
                      ))}
                      {(!u.groups || !u.groups.length) && <span className="text-xs text-gray-400">No groups</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 whitespace-nowrap dark:text-gray-400">{fmtDate(u.createdAt)}</TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1.5">
                      <Button size="xs" color="light" onClick={() => openGroups(u)}>Groups</Button>
                      {u.id !== session?.id && (
                        <Button size="xs" color="light" onClick={() => toggleProtect(u)}>
                          {u.is_protected ? 'Unprotect' : 'Protect'}
                        </Button>
                      )}
                      {u.id !== session?.id && !u.is_protected && (
                        <Button size="xs" color="failure" onClick={() => del(u)}>Remove</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </Section>

      {groupModal && (
        <Modal show size="md" onClose={() => setGroupModal(null)}>
          <ModalHeader>Groups — {groupModal.displayName || groupModal.display_name}</ModalHeader>
          <ModalBody>
            <div className="space-y-3">
              {error && <Alert color="failure">{error}</Alert>}
              <p className="text-sm text-gray-500 dark:text-gray-400">Effective permissions = union of all assigned groups.</p>
              <div className="overflow-hidden border border-gray-200 rounded-lg dark:border-gray-700">
                {groups.map(g => {
                  const isMember = memberOf.includes(g.id)
                  return (
                    <label key={g.id} className={`flex items-center gap-3 px-3.5 py-2.5 cursor-pointer border-b border-gray-100 last:border-0 dark:border-gray-700 ${isMember ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
                      <Checkbox checked={isMember}
                        onChange={() => setMemberOf(prev => prev.includes(g.id) ? prev.filter(x => x !== g.id) : [...prev, g.id])} />
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                          {g.label}
                          {g.is_protected && <span className="text-amber-500">🔒</span>}
                          {isMember && <span className="text-[10px] font-bold text-primary-700 bg-primary-100 px-1.5 py-px rounded-full dark:bg-primary-900/40 dark:text-primary-300">Member</span>}
                        </div>
                        <div className="text-xs text-gray-400">{(g.permissions || []).length} permissions · {g.memberCount ?? 0} member{g.memberCount !== 1 ? 's' : ''}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setGroupModal(null)}>Cancel</Button>
            <Button onClick={saveGroups} isProcessing={saving} disabled={saving}>Save Groups</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}

// ── Add Staff ─────────────────────────────────────────────────────

function AddStaff({ groups, reload }) {
  const [form, setForm] = useState({ username: '', displayName: '', password: '', confirm: '', groupIds: [] })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!form.username.trim()) { setError('Username required.'); return }
    if (!form.password) { setError('Password required.'); return }
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
    setSaving(true); setError(''); setSuccess('')
    try {
      const r = await apiFetch('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.trim(), displayName: form.displayName.trim() || form.username.trim(), password: form.password, role: 'pa', groupIds: form.groupIds }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Save failed'); return }
      setSuccess(`Account "${form.username}" created. They must set a new password on first login.`)
      setForm({ username: '', displayName: '', password: '', confirm: '', groupIds: [] })
      reload()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div>
      <Section title="Add Staff Member">
        {error && <Alert color="failure" className="mb-3">{error}</Alert>}
        {success && <Alert color="success" className="mb-3">{success}</Alert>}
        <form onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <Label htmlFor="as-username" className="mb-1 block">Username</Label>
              <TextInput id="as-username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="e.g. jsmith" />
            </div>
            <div>
              <Label htmlFor="as-display" className="mb-1 block">Display Name</Label>
              <TextInput id="as-display" value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} placeholder="e.g. Jane Smith" />
            </div>
            <div>
              <Label htmlFor="as-pw" className="mb-1 block">Password</Label>
              <TextInput id="as-pw" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 chars" />
            </div>
            <div>
              <Label htmlFor="as-pw2" className="mb-1 block">Confirm Password</Label>
              <TextInput id="as-pw2" type="password" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} placeholder="Repeat password" />
            </div>
          </div>
          {groups.length > 0 && (
            <div className="mb-3">
              <Label className="mb-1 block">Group Membership</Label>
              <div className="border border-gray-200 rounded-lg overflow-hidden dark:border-gray-700">
                {groups.map(g => {
                  const isMember = form.groupIds.includes(g.id)
                  return (
                    <label key={g.id}
                      className={`flex items-center gap-3 px-3.5 py-2.5 cursor-pointer border-b border-gray-100 last:border-0 dark:border-gray-700 ${isMember ? 'bg-blue-50 dark:bg-blue-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                      <Checkbox checked={isMember}
                        onChange={() => setForm(f => ({ ...f, groupIds: f.groupIds.includes(g.id) ? f.groupIds.filter(x => x !== g.id) : [...f.groupIds, g.id] }))} />
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
                          {g.label}
                          {isMember && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-px rounded-full dark:bg-blue-900/40 dark:text-blue-300">Selected</span>}
                        </div>
                        <div className="text-xs text-gray-400">{(g.permissions || []).length} permissions</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5 mb-3 dark:bg-gray-700/50 dark:border-gray-600 dark:text-gray-400">
            <strong>Password requirements:</strong> 8+ characters · Uppercase · Lowercase · Number · Symbol (!@#$%^&amp;*)
          </p>
          <Button type="submit" className="w-full max-w-xs" isProcessing={saving} disabled={saving}>
            {saving ? 'Creating…' : 'Create Account'}
          </Button>
        </form>
      </Section>
    </div>
  )
}

// ── Reset Password ────────────────────────────────────────────────

function ResetPassword({ users }) {
  const { session, refreshSession } = useAuth()
  const [targetId, setTargetId] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSelf, setShowSelf] = useState(false)
  const [selfCur, setSelfCur] = useState('')
  const [selfPw, setSelfPw] = useState('')
  const [selfPw2, setSelfPw2] = useState('')
  const [selfErr, setSelfErr] = useState('')
  const [selfOk, setSelfOk] = useState('')

  async function resetOther(e) {
    e.preventDefault()
    if (!targetId) { setError('Select a staff member.'); return }
    if (!pw) { setError('Password required.'); return }
    if (pw !== pw2) { setError('Passwords do not match.'); return }
    setSaving(true); setError(''); setSuccess('')
    try {
      const r = await apiFetch(`/api/users/${targetId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Failed'); return }
      const u = users.find(x => String(x.id) === String(targetId))
      setSuccess(`Password reset for ${u?.displayName || u?.display_name || u?.username || 'user'}. They must set a new password on next login.`)
      setTargetId(''); setPw(''); setPw2('')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  async function changeSelf(e) {
    e.preventDefault()
    if (!selfPw) { setSelfErr('Password required.'); return }
    if (selfPw !== selfPw2) { setSelfErr('Passwords do not match.'); return }
    setSelfErr(''); setSelfOk('')
    const r = await apiFetch('/api/users/me/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: selfCur, newPassword: selfPw }),
    })
    const j = await r.json()
    if (!r.ok) { setSelfErr(j.error || 'Failed'); return }
    setSelfOk('Password changed successfully.'); setSelfCur(''); setSelfPw(''); setSelfPw2('')
    refreshSession()
  }

  return (
    <div>
      <Section title="Reset Staff Password">
        {error && <Alert color="failure" className="mb-3">{error}</Alert>}
        {success && <Alert color="success" className="mb-3">{success}</Alert>}
        <form onSubmit={resetOther}>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <Label htmlFor="rp-target" className="mb-1 block">Select Staff Member</Label>
              <Select id="rp-target" value={targetId} onChange={e => setTargetId(e.target.value)}>
                <option value="">— Select staff member —</option>
                {users.filter(u => u.id !== session?.id).map(u => (
                  <option key={u.id} value={u.id}>{u.displayName || u.display_name} ({u.username})</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rp-pw" className="mb-1 block">New Password</Label>
              <TextInput id="rp-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Min 8 chars" />
            </div>
            <div>
              <Label htmlFor="rp-pw2" className="mb-1 block">Confirm Password</Label>
              <TextInput id="rp-pw2" type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Repeat password" />
            </div>
          </div>
          <Button type="submit" className="w-full max-w-xs" isProcessing={saving} disabled={saving}>
            {saving ? 'Saving…' : 'Set New Password'}
          </Button>
        </form>
        <Button color="light" size="xs" className="mt-4" onClick={() => setShowSelf(s => !s)}>
          {showSelf ? '▲ Hide' : '▼ Change My Own Password'}
        </Button>
      </Section>

      {showSelf && (
        <Section title="Change My Password">
          {selfErr && <Alert color="failure" className="mb-3">{selfErr}</Alert>}
          {selfOk && <Alert color="success" className="mb-3">{selfOk}</Alert>}
          <form onSubmit={changeSelf} className="max-w-xs space-y-3">
            <div>
              <Label htmlFor="sp-cur" className="mb-1 block">Current Password</Label>
              <TextInput id="sp-cur" type="password" value={selfCur} onChange={e => setSelfCur(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sp-new" className="mb-1 block">New Password</Label>
              <TextInput id="sp-new" type="password" value={selfPw} onChange={e => setSelfPw(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sp-new2" className="mb-1 block">Confirm New Password</Label>
              <TextInput id="sp-new2" type="password" value={selfPw2} onChange={e => setSelfPw2(e.target.value)} />
            </div>
            <Button type="submit" className="w-full">Change My Password</Button>
          </form>
        </Section>
      )}
    </div>
  )
}

// ── Groups Manager ────────────────────────────────────────────────

function GroupCard({ g, onSave, onDelete }) {
  const [open, setOpen] = useState(false)
  const [perms, setPerms] = useState([...(g.permissions || [])])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function save() {
    setSaving(true); setMsg('')
    const r = await apiFetch(`/api/groups/${g.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: g.label, permissions: perms }),
    })
    const j = await r.json()
    setSaving(false)
    if (!r.ok) { setMsg(j.error || 'Save failed'); return }
    setMsg('Saved ✓'); onSave()
    setTimeout(() => setMsg(''), 2000)
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden mb-2 dark:border-gray-700">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center w-full gap-2.5 px-3.5 py-2.5 text-left bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/50 transition-colors">
        <span className="text-gray-400 text-xs w-3.5 shrink-0">{open ? '▾' : '▸'}</span>
        <span className="font-bold text-sm flex-1 text-gray-900 dark:text-white">{g.label}</span>
        {g.is_protected && <span title="Protected" className="text-amber-500">🔒</span>}
        <code className="font-mono text-xs text-gray-400 bg-gray-100 px-1.5 py-px rounded dark:bg-gray-700 dark:text-gray-500">{g.key}</code>
        <span className="text-xs text-gray-500 dark:text-gray-400">{(g.permissions || []).length} perms · {g.memberCount ?? 0} member{g.memberCount !== 1 ? 's' : ''}</span>
        {!g.is_protected && (
          <Button size="xs" color="failure" onClick={e => { e.stopPropagation(); onDelete(g) }}>Delete</Button>
        )}
      </button>

      {open && (
        <div className="border-t border-gray-200 p-4 dark:border-gray-700">
          {g.is_protected && (
            <Alert color="warning" className="mb-3">
              🔒 This group is protected. Permissions are managed via server ROLE_PRESETS and cannot be edited here.
            </Alert>
          )}
          <PermEditor value={perms} onChange={setPerms} disabled={!!g.is_protected} />
          {!g.is_protected && (
            <div className="flex items-center gap-2.5 mt-3">
              <Button size="sm" onClick={save} isProcessing={saving} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
              {msg && <span className={`text-sm font-medium ${msg.includes('✓') ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{msg}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GroupsManager({ groups, reload }) {
  const confirm = useConfirm()
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')

  async function createGroup() {
    const label = newLabel.trim()
    if (!label) { setCreateErr('Group name required.'); return }
    const key = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 50)
    if (!key) { setCreateErr('Could not derive a valid key.'); return }
    setCreating(true); setCreateErr('')
    const r = await apiFetch('/api/groups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, label, permissions: [] }),
    })
    const j = await r.json()
    setCreating(false)
    if (!r.ok) { setCreateErr(j.error || 'Create failed'); return }
    setNewLabel(''); reload()
  }

  async function deleteGroup(g) {
    if (!await confirm({ title: `Delete group "${g.label}"?`, body: 'Members will lose these permissions.', confirmText: 'Delete', color: 'red' })) return
    const r = await apiFetch(`/api/groups/${g.id}`, { method: 'DELETE' })
    if (!r.ok) { const j = await r.json(); alert(j.error || 'Delete failed') }
    else reload()
  }

  return (
    <div>
      <Section title="Permission Groups">
        {groups.map(g => <GroupCard key={g.id} g={g} onSave={reload} onDelete={deleteGroup} />)}
        <div className="flex gap-2 mt-3 items-center">
          <TextInput value={newLabel} onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createGroup()}
            placeholder="Group Name (e.g. Night Staff)" sizing="sm" className="flex-1 max-w-xs" />
          <Button size="sm" onClick={createGroup} disabled={creating}>+ Create</Button>
          {createErr && <span className="text-sm text-red-600 dark:text-red-400">{createErr}</span>}
        </div>
      </Section>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// FACILITY SETUP TAB
// ══════════════════════════════════════════════════════════════════

function FacilitySetupTab({ panel }) {
  const { hasPerm } = usePermission()
  const sub = panel || 'general'   // driven by the Admin rail
  const [settings, setSettings] = useState(null)
  const [settingSaving, setSettingSaving] = useState(false)
  const [settingError, setSettingError] = useState('')

  const loadSettings = useCallback(async () => {
    const r = await apiFetch('/api/facility/settings')
    if (r.ok) setSettings(await r.json())
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  async function saveSettings(patch) {
    const body = { ...settings, ...patch }
    setSettingSaving(true)
    const r = await apiFetch('/api/facility/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    setSettingSaving(false)
    if (r.ok) { setSettings(body); setSettingError('') }
    else {
      const d = await r.json().catch(() => ({}))
      setSettingError(d.error || 'Save failed')
    }
    return r.ok
  }

  if (!settings) return <p className="text-sm text-gray-400 py-12 text-center dark:text-gray-500">Loading…</p>

  return (
    <div>
      {sub === 'general'  && hasPerm('admin.settings')  && <>
        <FacilityName settings={settings} onSave={saveSettings} saving={settingSaving} />
        <ShiftTimes settings={settings} onSave={saveSettings} saving={settingSaving} />
        <RemindersSettings settings={settings} onSave={saveSettings} saving={settingSaving} />
      </>}
      {sub === 'rooms'    && hasPerm('facility.manage') && <RoomsManager />}
      {sub === 'statuses' && hasPerm('admin.settings')  && <StatusSettings settings={settings} onSave={saveSettings} saving={settingSaving} error={settingError} />}
      {sub === 'display'  && hasPerm('admin.settings')  && <DisplaySettings settings={settings} onSave={saveSettings} saving={settingSaving} />}
      {sub === 'walk'     && hasPerm('admin.settings')  && <WalkAreas settings={settings} onSave={saveSettings} saving={settingSaving} />}
      {sub === 'ua'       && hasPerm('admin.settings')  && <UAPanelSettings settings={settings} onSave={saveSettings} saving={settingSaving} />}
      {sub === 'ehr'      && hasPerm('admin.settings')  && <EHRConfigSettings />}
      {sub === 'resetfac' && hasPerm('facility.manage') && <FacilityReset />}
    </div>
  )
}


// ── Resident Statuses ─────────────────────────────────────────────────
// `key` is what lives in reports.statuses, so it is fixed once a status
// exists — renaming the label is safe, changing the key would orphan every
// saved shift that references it. New rows derive their key from the label.
// The server independently re-validates and refuses to drop a key still in
// use, so a stale browser tab can't corrupt historical data.
function slugifyKey(label) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '').replace(/^([0-9])/, 's$1').slice(0, 24)
}

function StatusSettings({ settings, onSave, saving, error }) {
  const initial = (Array.isArray(settings.client_statuses) && settings.client_statuses.length
    ? settings.client_statuses : DEFAULT_STATUSES)
  const [rows, setRows] = useState(() => initial.filter(r => !r.archived).map(r => ({ ...r, _existing: true })))
  // Retired statuses: hidden from the shift-report picker, but their labels
  // are kept so closed reports still render 'Weekend Pass', not a raw slug.
  const [archived, setArchived] = useState(() => initial.filter(r => r.archived))

  const restore = (key) => {
    const row = archived.find(a => a.key === key)
    if (!row) return
    setArchived(as => as.filter(a => a.key !== key))
    setRows(rs => [...rs, { ...row, archived: undefined, _existing: true }])
  }
  const [saved, setSaved] = useState(false)

  const set = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i, d) => setRows(rs => {
    const j = i + d
    if (j < 0 || j >= rs.length) return rs
    const n = [...rs]; [n[i], n[j]] = [n[j], n[i]]; return n
  })
  const add = () => setRows(rs => [...rs, { key: '', label: '', tone: 'gray', _existing: false }])
  const remove = (i) => setRows(rs => rs.filter((_, j) => j !== i))

  async function save() {
    const payload = rows.map(r => ({
      key: r._existing ? r.key : (r.key || slugifyKey(r.label)),
      label: r.label, tone: r.tone,
    }))
    const ok = await onSave({ client_statuses: payload })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <Section
      title="Resident Statuses"
      right={<><SaveMsg ok={saved} /><Button size="xs" onClick={save} isProcessing={saving} disabled={saving}>{saving ? 'Saving…' : 'Save Statuses'}</Button></>}
    >
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        These are the statuses staff can assign on the shift report. Renaming a label updates it
        everywhere, including on past shifts. Removing one retires it — it disappears from the
        picker, but past shifts keep showing its label. A status in use on the currently open
        shift can't be removed until that shift is closed.
      </p>

      {error && (
        <div className="p-3 mb-4 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800">
          {error}
        </div>
      )}

      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2.5 p-2.5 border border-gray-200 rounded-xl bg-gray-50/60 dark:bg-gray-700/30 dark:border-gray-700">
            <div className="flex flex-col shrink-0">
              <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}
                className="px-1 text-gray-400 hover:text-primary-600 disabled:opacity-30">▲</button>
              <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                className="px-1 text-gray-400 hover:text-primary-600 disabled:opacity-30">▼</button>
            </div>

            <TextInput sizing="sm" className="flex-1 min-w-[10rem]" value={r.label} placeholder="Status name"
              onChange={e => set(i, { label: e.target.value })} />

            <div className="flex items-center gap-1">
              {STATUS_TONES.map(t => (
                <button key={t} type="button" onClick={() => set(i, { tone: t })}
                  aria-label={`Colour ${t}`} title={t}
                  className={`w-6 h-6 rounded-full ${TONE_DOT[t]} transition-transform ${r.tone === t ? 'ring-2 ring-offset-2 ring-primary-500 scale-110 dark:ring-offset-gray-800' : 'opacity-60 hover:opacity-100'}`} />
              ))}
            </div>

            <span className={`px-2.5 py-1 text-xs font-semibold rounded-md whitespace-nowrap ${TONE_BADGE[r.tone] || TONE_BADGE.gray}`}>
              {r.label || 'Preview'}
            </span>

            <code className="px-2 py-1 font-mono text-[11px] text-gray-500 bg-gray-100 rounded dark:bg-gray-700 dark:text-gray-400">
              {r._existing ? r.key : (slugifyKey(r.label) || '…')}
            </code>

            {(r.system || isSystemStatus(r.key))
              ? <span className="text-[11px] text-gray-400 px-1">required</span>
              : <button type="button" onClick={() => remove(i)}
                  className="px-2 py-1 text-xs font-medium text-red-600 rounded hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30">Remove</button>}
          </div>
        ))}
      </div>

      <Button size="xs" color="light" className="mt-3" onClick={add}>+ Add status</Button>

      {archived.length > 0 && (
        <div className="pt-4 mt-5 border-t border-gray-200 dark:border-gray-700">
          <p className="mb-1 text-[11px] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400">Retired</p>
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            No longer offered on the shift report. Kept so past shifts still show the right label.
          </p>
          <div className="flex flex-wrap gap-2">
            {archived.map(a => (
              <span key={a.key} className="inline-flex items-center gap-2 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 dark:bg-gray-700/40 dark:border-gray-700">
                <span className={`px-2 py-0.5 rounded-md font-semibold ${TONE_BADGE[a.tone] || TONE_BADGE.gray}`}>{a.label}</span>
                <code className="font-mono text-[11px] text-gray-400">{a.key}</code>
                <button type="button" onClick={() => restore(a.key)}
                  className="font-medium text-primary-600 hover:underline dark:text-primary-400">Restore</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

// ── EHR / Compliance Config ──────────────────────────────────────────
function EHRConfigSettings() {
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const r = await apiFetch('/api/facility/ehr-config')
    if (r.ok) setCfg(await r.json())
  }, [])
  useEffect(() => { load() }, [load])

  if (!cfg) return <p className="text-sm text-gray-400 py-12 text-center dark:text-gray-500">Loading…</p>

  function setTrack(idx, val) {
    const next = [...(cfg.program_tracks||[])]; next[idx] = val
    setCfg({ ...cfg, program_tracks: next })
  }
  function removeTrack(idx) {
    const next = [...(cfg.program_tracks||[])]; next.splice(idx,1)
    setCfg({ ...cfg, program_tracks: next })
  }
  function addTrack() { setCfg({ ...cfg, program_tracks: [...(cfg.program_tracks||[]), ''] }) }

  function setPhaseField(idx, key, val) {
    const next = [...(cfg.program_phases||[])]
    next[idx] = { ...next[idx], [key]: val }
    setCfg({ ...cfg, program_phases: next })
  }
  function setPhaseObjectives(idx, text) {
    const objectives = text.split('\n').map(s => s.trim()).filter(Boolean)
    setPhaseField(idx, 'objectives', objectives)
  }
  function removePhase(idx) {
    const next = [...(cfg.program_phases||[])]; next.splice(idx,1)
    setCfg({ ...cfg, program_phases: next })
  }
  function addPhase() {
    setCfg({ ...cfg, program_phases: [...(cfg.program_phases||[]), { key:'', label:'', objectives:[] }] })
  }

  function toggleNotif(sev, key) {
    const policy = { ...(cfg.incident_notifications||{}) }
    const list = Array.isArray(policy[sev]) ? policy[sev] : []
    policy[sev] = list.includes(key) ? list.filter(k => k !== key) : [...list, key]
    setCfg({ ...cfg, incident_notifications: policy })
  }

  async function save() {
    setSaving(true); setErr('')
    try {
      const r = await apiFetch('/api/facility/ehr-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program_tracks:         (cfg.program_tracks||[]).filter(s => s && s.trim()),
          program_phases:         (cfg.program_phases||[]).filter(p => p.label && p.label.trim()),
          incident_notifications: cfg.incident_notifications || {},
          session_idle_mins:      parseInt(cfg.session_idle_mins||30)||30,
        }),
      })
      if (!r.ok) { const j = await r.json().catch(()=>({})); setErr(j.error||'Save failed'); return }
      setSaved(true); setTimeout(()=>setSaved(false), 2500)
      load()
    } finally { setSaving(false) }
  }

  const NOTIFIERS = ['supervisor','case_manager','licensing','guardian','doh','insurance','law_enforcement']
  const SEVS = ['low','medium','high','critical']

  return (
    <div>
      {err && <Alert color="failure" className="mb-3">{err}</Alert>}

      {/* Program tracks */}
      <Section title="Program Tracks">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Tracks shown in the resident profile dropdown.</p>
        <div className="space-y-2 mb-3">
          {(cfg.program_tracks||[]).map((t, idx) => (
            <div key={idx} className="flex gap-2">
              <TextInput sizing="sm" value={t} onChange={e=>setTrack(idx, e.target.value)} className="flex-1" />
              <Button size="xs" color="failure" onClick={()=>removeTrack(idx)}>×</Button>
            </div>
          ))}
        </div>
        <Button size="xs" color="light" onClick={addTrack}>+ Add track</Button>
      </Section>

      {/* Program phases */}
      <Section title="Program Phases &amp; Objectives">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Used by the Milestones tab to seed objectives per phase. One objective per line.</p>
        <div className="space-y-3 mb-3">
          {(cfg.program_phases||[]).map((p, idx) => (
            <div key={idx} className="border border-gray-200 rounded-lg p-3 dark:border-gray-700">
              <div className="flex gap-2 mb-2">
                <TextInput sizing="sm" placeholder="key (e.g. phase1)" value={p.key||''} onChange={e=>setPhaseField(idx,'key',e.target.value)} className="flex-1" />
                <TextInput sizing="sm" placeholder="Label" value={p.label||''} onChange={e=>setPhaseField(idx,'label',e.target.value)} className="flex-[2]" />
                <Button size="xs" color="failure" onClick={()=>removePhase(idx)}>×</Button>
              </div>
              <Textarea rows={3} placeholder="One objective per line"
                value={(p.objectives||[]).join('\n')} onChange={e=>setPhaseObjectives(idx, e.target.value)} className="text-xs" />
            </div>
          ))}
        </div>
        <Button size="xs" color="light" onClick={addPhase}>+ Add phase</Button>
      </Section>

      {/* Incident notification policy */}
      <Section title="Incident Notification Policy">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Mandatory notification parties per incident severity. The server enforces these minimums when an incident is logged.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Severity</th>
                {NOTIFIERS.map(n => <th key={n} className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 dark:text-gray-400 capitalize">{n.replace(/_/g,' ')}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {SEVS.map(sev => (
                <tr key={sev} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-3 py-2 font-semibold capitalize text-gray-700 dark:text-gray-200">{sev}</td>
                  {NOTIFIERS.map(n => (
                    <td key={n} className="px-2 py-2 text-center">
                      <Checkbox checked={(cfg.incident_notifications?.[sev]||[]).includes(n)} onChange={()=>toggleNotif(sev,n)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* HIPAA idle session timeout */}
      <Section title="HIPAA Idle Session Timeout">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Minutes of inactivity before a session is automatically terminated (HIPAA technical safeguard, 45 CFR §164.312(a)(2)(iii)). Range: 5–240 minutes.
        </p>
        <div className="max-w-[200px]">
          <Label htmlFor="ehr-idle" className="mb-1 block">Idle timeout (minutes)</Label>
          <TextInput id="ehr-idle" type="number" min={5} max={240}
            value={cfg.session_idle_mins} onChange={e => setCfg({ ...cfg, session_idle_mins: e.target.value })} />
        </div>
      </Section>

      <div className="flex gap-2 items-center justify-end mt-2">
        <SaveMsg ok={saved} />
        <Button isProcessing={saving} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save EHR Config'}</Button>
      </div>
    </div>
  )
}


// ── Facility Name ─────────────────────────────────────────────────

function FacilityName({ settings, onSave, saving }) {
  const [name, setName] = useState(settings.facility_name || '')
  const [saved, setSaved] = useState(false)

  async function save() {
    const ok = await onSave({ facility_name: name })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div>
      <Section title="Facility Name" right={<><SaveMsg ok={saved} /><Button size="xs" onClick={save} isProcessing={saving} disabled={saving}>{saving ? 'Saving…' : 'Save Name'}</Button></>}>
        <div className="mb-3">
          <Label htmlFor="fac-name" className="mb-1 block">Facility Name</Label>
          <TextInput id="fac-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. James Baldwin Place" />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">Shown in the app header, mobile app, and DOCX reports.</p>
      </Section>
    </div>
  )
}

// ── Rooms Manager (with drag-to-reorder + bulk import) ────────────

function RoomsManager() {
  const confirm = useConfirm()
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [addForm, setAddForm] = useState({ room: '', type: 'resident', label: '' })
  const [addErr, setAddErr] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [bulkParsed, setBulkParsed] = useState([])
  const [bulkMsg, setBulkMsg] = useState('')
  const dragIdx = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await apiFetch('/api/facility/rooms')
    if (r.ok) setRooms(await r.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Stats
  const total = rooms.length
  const active = rooms.filter(r => r.is_active && !r.is_special && r.name !== 'VACANT').length
  const vacant = rooms.filter(r => r.name === 'VACANT' && !r.is_special).length
  const special = rooms.filter(r => r.is_special).length
  const discharged = rooms.filter(r => !r.is_active && !r.is_special).length

  // Inline edit
  async function patchRoom(id, patch) {
    await apiFetch(`/api/facility/rooms/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    load()
  }

  async function deleteRoom(r) {
    if (!await confirm({ title: `Remove room ${r.room}?`, confirmText: 'Remove', color: 'red' })) return
    await apiFetch(`/api/facility/rooms/${r.id}`, { method: 'DELETE' })
    load()
  }

  // Drag-to-reorder
  function onDragStart(e, idx) { dragIdx.current = idx; e.dataTransfer.effectAllowed = 'move' }
  function onDragOver(e, idx) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    if (dragIdx.current === null || dragIdx.current === idx) return
    const next = [...rooms]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(idx, 0, moved)
    dragIdx.current = idx
    setRooms(next)
  }
  async function onDrop() {
    dragIdx.current = null
    await apiFetch('/api/facility/reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: rooms.map(r => r.id) }),
    })
  }

  // Add room
  async function addRoom(e) {
    e.preventDefault()
    if (!addForm.room.trim()) { setAddErr('Room number required.'); return }
    setAddErr('')
    const body = {
      room: addForm.room.trim(),
      name: addForm.type === 'special' ? (addForm.label.trim() || 'Special') : 'VACANT',
      is_special: addForm.type === 'special' ? 1 : 0,
      special_label: addForm.type === 'special' ? (addForm.label.trim() || '') : '',
    }
    const r = await apiFetch('/api/facility/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) { const j = await r.json(); setAddErr(j.error || 'Failed'); return }
    setAddForm({ room: '', type: 'resident', label: '' }); load()
  }

  // Bulk import parse
  function parseBulk(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    return lines.map(line => {
      const parts = line.split(',').map(p => p.trim())
      const room = parts[0] || ''
      const name = parts[1] || ''
      const type = (parts[2] || 'resident').toLowerCase()
      const isSpecial = type === 'special'
      return { room, name: name || (isSpecial ? 'Special' : 'VACANT'), is_special: isSpecial, special_label: isSpecial ? name : '' }
    }).filter(r => r.room)
  }

  function onBulkInput(text) {
    setBulkText(text); setBulkParsed(parseBulk(text)); setBulkMsg('')
  }

  async function importBulk(replace) {
    const parsed = parseBulk(bulkText)
    if (!parsed.length) { setBulkMsg('No valid rooms to import.'); return }
    if (replace) {
      if (!await confirm({ title: 'Replace the entire roster?', body: `This will REPLACE the entire roster with ${parsed.length} room${parsed.length !== 1 ? 's' : ''}.`, confirmText: 'Replace', color: 'red' })) return
      const r = await apiFetch('/api/facility/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rooms: parsed }) })
      if (!r.ok) { const j = await r.json(); setBulkMsg('Error: ' + (j.error || 'Failed')); return }
      setBulkMsg(`✓ Roster replaced with ${parsed.length} rooms.`); setBulkText(''); setBulkParsed([]); load()
    } else {
      let added = 0, errors = 0
      for (const row of parsed) {
        const r = await apiFetch('/api/facility/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) })
        if (r.ok) added++; else errors++
      }
      setBulkMsg(`✓ Added ${added} room${added !== 1 ? 's' : ''}${errors ? ` (${errors} skipped)` : ''}.`)
      load()
    }
  }

  function rowCls(r) {
    if (r.is_special) return 'bg-violet-50 dark:bg-violet-900/10'
    if (!r.is_active) return 'bg-red-50 dark:bg-red-900/10'
    if (r.name === 'VACANT') return 'bg-gray-50 dark:bg-gray-700/20'
    return ''
  }

  return (
    <div>
      {/* Stats */}
      <div className="flex gap-2 flex-wrap mb-4">
        {[['Total', total, 'text-gray-600 dark:text-gray-300'], ['Active', active, 'text-green-600 dark:text-green-400'], ['Vacant', vacant, 'text-gray-400'], ['Special', special, 'text-violet-600 dark:text-violet-400'], ['Discharged', discharged, 'text-red-600 dark:text-red-400']].map(([label, n, cls]) => (
          <div key={label} className="border border-gray-200 rounded-xl px-4 py-2 bg-white text-center min-w-[72px] dark:bg-gray-800 dark:border-gray-700">
            <div className={`text-xl font-bold ${cls}`}>{n}</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      {/* Roster */}
      <Section title="Room Roster" noPad right={<span className="text-xs text-gray-400">Drag 🔀 to reorder</span>}>
        {loading ? <p className="text-sm text-gray-400 py-8 text-center dark:text-gray-500">Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-gray-50 border-b border-gray-200 dark:bg-gray-700 dark:border-gray-600">
                <tr>
                  <th className="px-2 py-3 w-7"></th>
                  <th className="px-3 py-3 text-gray-500 dark:text-gray-400 font-medium">Room #</th>
                  <th className="px-3 py-3 text-gray-500 dark:text-gray-400 font-medium">Name / Label</th>
                  <th className="px-3 py-3 text-gray-500 dark:text-gray-400 font-medium">Type</th>
                  <th className="px-3 py-3 text-gray-500 dark:text-gray-400 font-medium">Status</th>
                  <th className="px-3 py-3 text-gray-500 dark:text-gray-400 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rooms.map((r, idx) => (
                  <tr key={r.id} draggable className={`${rowCls(r)} hover:brightness-95 transition-colors`}
                    onDragStart={e => onDragStart(e, idx)} onDragOver={e => onDragOver(e, idx)} onDrop={onDrop}>
                    <td className="px-2 py-2 text-center cursor-grab text-gray-400">⠿</td>
                    <td className="px-3 py-2">
                      <input type="text" defaultValue={r.room} onBlur={e => e.target.value !== r.room && patchRoom(r.id, { room: e.target.value, name: r.name, is_special: r.is_special ? 1 : 0, special_label: r.special_label || '' })}
                        className="w-16 font-mono text-xs px-1.5 py-0.5 border border-gray-200 rounded dark:border-gray-600 dark:bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-500" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="text" defaultValue={r.name} onBlur={e => e.target.value !== r.name && patchRoom(r.id, { room: r.room, name: e.target.value, is_special: r.is_special ? 1 : 0, special_label: r.special_label || '' })}
                        className="w-44 text-sm px-1.5 py-0.5 border border-gray-200 rounded dark:border-gray-600 dark:bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-500" />
                    </td>
                    <td className="px-3 py-2">
                      {r.is_special
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">Special</span>
                        : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">Resident</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      {r.is_special ? <span className="text-xs text-violet-600 dark:text-violet-400">{r.special_label || '—'}</span>
                        : !r.is_active ? <span className="text-[11px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full dark:bg-red-900/30 dark:text-red-400">Discharged</span>
                        : r.name === 'VACANT' ? <span className="text-xs text-gray-400">Vacant</span>
                        : <span className="text-xs font-semibold text-green-600 dark:text-green-400">Active</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        {!r.is_special && r.name !== 'VACANT' && !!r.is_active && (
                          <Button size="xs" color="light" onClick={() => patchRoom(r.id, { room: r.room, name: r.name, is_special: 1, special_label: r.name })}>→ Special</Button>
                        )}
                        {!!r.is_special && (
                          <Button size="xs" color="light" onClick={() => patchRoom(r.id, { room: r.room, name: 'VACANT', is_special: 0, special_label: '' })}>→ Resident</Button>
                        )}
                        {(!!r.is_special || r.name === 'VACANT' || !r.is_active) && (
                          <Button size="xs" color="failure" onClick={() => deleteRoom(r)}>Remove</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Add Room */}
      <Section title="Add Room">
        {addErr && <Alert color="failure" className="mb-3">{addErr}</Alert>}
        <form onSubmit={addRoom} className="flex gap-3 flex-wrap items-end">
          <div>
            <Label htmlFor="ar-room" className="mb-1 block">Room Number</Label>
            <TextInput id="ar-room" value={addForm.room} onChange={e => setAddForm(f => ({ ...f, room: e.target.value }))} placeholder="e.g. 207" className="w-28" />
          </div>
          <div>
            <Label htmlFor="ar-type" className="mb-1 block">Type</Label>
            <Select id="ar-type" value={addForm.type} onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))}>
              <option value="resident">Resident Room (starts Vacant)</option>
              <option value="special">Special Space (Office, Storage…)</option>
            </Select>
          </div>
          {addForm.type === 'special' && (
            <div>
              <Label htmlFor="ar-label" className="mb-1 block">Space Label</Label>
              <TextInput id="ar-label" value={addForm.label} onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Supply Room" />
            </div>
          )}
          <Button type="submit">Add Room</Button>
        </form>
      </Section>

      {/* Bulk Import */}
      <Section title="Bulk Import">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
          One room per line: <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-px rounded text-xs">room, Name, type</code> — type is <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-px rounded text-xs">resident</code> or <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-px rounded text-xs">special</code>
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Example: <code>101, Frank E., resident</code> &nbsp;or&nbsp; <code>104, Office, special</code></p>
        <Textarea rows={10} value={bulkText} onChange={e => onBulkInput(e.target.value)}
          placeholder={'101, Frank E., resident\n102, Anthony D., resident\n104, Office, special\n# Lines starting with # are ignored'}
          className="font-mono text-xs mb-3" />

        {bulkParsed.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1.5">
              <strong>{bulkParsed.length} rooms parsed:</strong> {bulkParsed.filter(r => !r.is_special).length} resident, {bulkParsed.filter(r => r.is_special).length} special
            </p>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg dark:border-gray-700">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700">
                    <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">Room</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">Name</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkParsed.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-2 py-1 font-mono">{r.room}</td>
                      <td className="px-2 py-1">{r.name}</td>
                      <td className={`px-2 py-1 ${r.is_special ? 'text-violet-600 dark:text-violet-400' : 'text-gray-500'}`}>{r.is_special ? 'special' : 'resident'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {bulkMsg && (
          <Alert color={bulkMsg.startsWith('✓') ? 'success' : 'failure'} className="mb-3">{bulkMsg}</Alert>
        )}

        <div className="flex gap-2">
          <Button onClick={() => importBulk(false)} disabled={!bulkParsed.length}>Append to Roster</Button>
          <Button color="failure" size="sm" onClick={() => importBulk(true)} disabled={!bulkParsed.length}>⚠ Replace Entire Roster</Button>
        </div>
      </Section>
    </div>
  )
}

// ── Reminders ─────────────────────────────────────────────────────

function RemindersSettings({ settings, onSave, saving }) {
  const [ws, setWs] = useState([...(settings.wellness_schedule || [])])
  const [wk, setWk] = useState([...(settings.walk_schedule || [])])
  const [wTime, setWTime] = useState(''); const [wkTime, setWkTime] = useState('')
  const [saved, setSaved] = useState(false)

  async function save() {
    const ok = await onSave({ wellness_schedule: ws, walk_schedule: wk })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div>
      <Section title="Reminder Scheduled Times" right={<><SaveMsg ok={saved} /><Button size="xs" onClick={save} isProcessing={saving} disabled={saving}>{saving ? 'Saving…' : 'Save Reminder Settings'}</Button></>}>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Reminder fires at each time regardless of whether a check has been done.</p>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Wellness Check Times</p>
            <div className="space-y-1.5 mb-2">
              {ws.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-xs flex-1 text-gray-700 dark:text-gray-300">{t}</span>
                  <button onClick={() => setWs(ws.filter((_, j) => j !== i))} className="text-xs bg-red-50 border-0 text-red-600 hover:bg-red-100 rounded px-1.5 py-0.5 cursor-pointer dark:bg-red-900/30 dark:text-red-400">×</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <TextInput type="time" sizing="sm" value={wTime} onChange={e => setWTime(e.target.value)} className="font-mono" />
              <Button size="xs" onClick={() => { if (wTime && !ws.includes(wTime)) { setWs([...ws, wTime].sort()); setWTime('') } }}>+ Add</Button>
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Walkthrough Times</p>
            <div className="space-y-1.5 mb-2">
              {wk.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-xs flex-1 text-gray-700 dark:text-gray-300">{t}</span>
                  <button onClick={() => setWk(wk.filter((_, j) => j !== i))} className="text-xs bg-red-50 border-0 text-red-600 hover:bg-red-100 rounded px-1.5 py-0.5 cursor-pointer dark:bg-red-900/30 dark:text-red-400">×</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <TextInput type="time" sizing="sm" value={wkTime} onChange={e => setWkTime(e.target.value)} className="font-mono" />
              <Button size="xs" onClick={() => { if (wkTime && !wk.includes(wkTime)) { setWk([...wk, wkTime].sort()); setWkTime('') } }}>+ Add</Button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  )
}

// ── Shift Times ───────────────────────────────────────────────────

function ShiftTimes({ settings, onSave, saving }) {
  const [day, setDay] = useState(settings.shift_day_start || '07:00')
  const [swing, setSwing] = useState(settings.shift_swing_start || '15:00')
  const [grave, setGrave] = useState(settings.shift_grave_start || '23:00')
  const [saved, setSaved] = useState(false)

  async function save() {
    const ok = await onSave({ shift_day_start: day, shift_swing_start: swing, shift_grave_start: grave })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div>
      <Section title="Shift Times" right={<><SaveMsg ok={saved} /><Button size="xs" onClick={save} isProcessing={saving} disabled={saving}>{saving ? 'Saving…' : 'Save Shift Times'}</Button></>}>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div><Label htmlFor="sh-day" className="mb-1 block">Day Start</Label><TextInput id="sh-day" type="time" value={day} onChange={e => setDay(e.target.value)} /></div>
          <div><Label htmlFor="sh-swing" className="mb-1 block">Swing Start</Label><TextInput id="sh-swing" type="time" value={swing} onChange={e => setSwing(e.target.value)} /></div>
          <div><Label htmlFor="sh-grave" className="mb-1 block">Grave Start</Label><TextInput id="sh-grave" type="time" value={grave} onChange={e => setGrave(e.target.value)} /></div>
        </div>
        <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5 space-y-1 dark:bg-gray-700/50 dark:border-gray-600 dark:text-gray-300">
          <div><strong>Day:</strong> {day} – end computed 30 min before Swing</div>
          <div><strong>Swing:</strong> {swing} – end computed 30 min before Grave</div>
          <div><strong>Grave:</strong> {grave} – end computed 30 min before Day</div>
        </div>
      </Section>
    </div>
  )
}

// ── Display Settings ──────────────────────────────────────────────

function DisplaySettings({ settings, onSave, saving }) {
  const [vis, setVis] = useState(settings.ui_visibility || { tabs: {}, buttons: {} })
  const [saved, setSaved] = useState(false)

  // Grouped to mirror the sidebar, so what you switch off here maps onto what
  // staff actually see. Core tabs (Clients, Report, Archive) are deliberately
  // absent — the app has no usable state without them.
  const NAV_GROUPS = [
    { group: 'People', items: [
      { key: 'staff',       label: 'Staff',      desc: 'Staff directory and contacts' },
      { key: 'caseloads',   label: 'Caseloads',  desc: 'Residents grouped by case manager' },
    ]},
    { group: 'Daily Ops', items: [
      { key: 'chores',      label: 'Chores',     desc: 'Chore assignments and completion log' },
      { key: 'groups',      label: 'Groups',     desc: 'Group session scheduling and attendance' },
      { key: 'passes',      label: 'Passes',     desc: 'Weekend and day pass tracking' },
      { key: 'mail',        label: 'Mail',       desc: 'Incoming mail approve/deliver workflow' },
    ]},
    { group: 'Health & Compliance', items: [
      { key: 'ua',          label: 'UA',         desc: 'UA requests, results and chain of custody' },
      { key: 'ua_draw',     label: 'UA Draw',    desc: 'Random draw button in the sidebar' },
    ]},
    { group: 'Records', items: [
      { key: 'violations',  label: 'Infractions', desc: 'Rule violations and consequences' },
      { key: 'consent',     label: 'Consents',    desc: '42 CFR Part 2 consents and disclosures' },
    ]},
  ]

  const BTN_OPTS = [
    { key: 'wellness',    label: 'Wellness Check', desc: 'Quick-action button on the shift report' },
    { key: 'walkthrough', label: 'Walkthrough',    desc: 'Quick-action button on the shift report' },
  ]

  const clinicalOn = vis.tabs?.clinical !== false

  function setTab(key, val) { setVis(v => ({ ...v, tabs: { ...v.tabs, [key]: val } })) }
  function setBtn(key, val) { setVis(v => ({ ...v, buttons: { ...v.buttons, [key]: val } })) }

  async function save() {
    const ok = await onSave({ ui_visibility: vis })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div>
      <Section title="Feature Visibility" right={<><SaveMsg ok={saved} /><Button size="xs" onClick={save} isProcessing={saving} disabled={saving}>{saving ? 'Saving…' : 'Save Feature Settings'}</Button></>}>
        <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">
          Turn off anything your facility does not use — it disappears from the sidebar for everyone,
          regardless of their permissions. Clients, Report and Archive are always on; the app depends on them.
        </p>

        {NAV_GROUPS.map(g => (
          <div key={g.group} className="mb-5">
            <p className="mb-2 text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">{g.group}</p>
            <div className="space-y-2.5">
              {g.items.map(t => (
                <div key={t.key} className="flex items-start gap-2.5">
                  <Checkbox id={`tab-${t.key}`} className="mt-0.5" checked={vis.tabs?.[t.key] !== false} onChange={e => setTab(t.key, e.target.checked)} />
                  <div className="leading-tight">
                    <Label htmlFor={`tab-${t.key}`} className="cursor-pointer">{t.label}</Label>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">{t.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Clinical — master switch plus the individual charting pages. */}
        <div className="mb-5">
          <p className="mb-2 text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">Clinical</p>
          <div className="flex items-start gap-2.5">
            <Checkbox id="tab-clinical" className="mt-0.5" checked={clinicalOn} onChange={e => setTab('clinical', e.target.checked)} />
            <div className="leading-tight">
              <Label htmlFor="tab-clinical" className="cursor-pointer">Clinical section</Label>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Charting rail — notes, treatment plans, assessments, group notes, milestones, incidents and discharge.
                Turning this off hides the whole section.
              </p>
            </div>
          </div>

          <div className={`mt-3 ml-6 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-2.5 ${clinicalOn ? '' : 'opacity-40'}`}>
            {CLINICAL_NAV.map(n => (
              <div key={n.key} className="flex items-center gap-2.5">
                <Checkbox
                  id={`tab-${n.key}`}
                  disabled={!clinicalOn}
                  checked={clinicalOn && vis.tabs?.[n.key] !== false}
                  onChange={e => setTab(n.key, e.target.checked)}
                />
                <Label htmlFor={`tab-${n.key}`} className={clinicalOn ? 'cursor-pointer' : 'cursor-not-allowed'}>{n.label}</Label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">Shift Report Quick Actions</p>
          <div className="space-y-2.5">
            {BTN_OPTS.map(b => (
              <div key={b.key} className="flex items-start gap-2.5">
                <Checkbox id={`btn-${b.key}`} className="mt-0.5" checked={vis.buttons?.[b.key] !== false} onChange={e => setBtn(b.key, e.target.checked)} />
                <div className="leading-tight">
                  <Label htmlFor={`btn-${b.key}`} className="cursor-pointer">{b.label}</Label>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  )
}

// ── Walk Areas ────────────────────────────────────────────────────

function WalkAreas({ settings, onSave, saving }) {
  const [areas, setAreas] = useState([...(settings.walk_areas || [])])
  const [newArea, setNewArea] = useState('')
  const [saved, setSaved] = useState(false)
  const dragIdx = useRef(null)

  function onDragStart(e, i) { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move' }
  function onDragOver(e, i) {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const next = [...areas]; const [m] = next.splice(dragIdx.current, 1); next.splice(i, 0, m)
    dragIdx.current = i; setAreas(next)
  }
  function onDrop() { dragIdx.current = null }

  function addArea() {
    const t = newArea.trim(); if (!t) return
    setAreas([...areas, t]); setNewArea('')
  }

  async function save() {
    const ok = await onSave({ walk_areas: areas })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div>
      <Section title="Walkthrough Areas" right={<><SaveMsg ok={saved} /><Button size="xs" onClick={save} isProcessing={saving} disabled={saving}>{saving ? 'Saving…' : 'Save Locations'}</Button></>}>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Drag ⠿ to reorder</p>
        <div className="mb-3">
          {areas.map((a, i) => (
            <div key={i} draggable
              onDragStart={e => onDragStart(e, i)} onDragOver={e => onDragOver(e, i)} onDrop={onDrop}
              className="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0 dark:border-gray-700">
              <span className="cursor-grab text-gray-400">⠿</span>
              <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{a}</span>
              <button onClick={() => setAreas(areas.filter((_, j) => j !== i))}
                className="text-xs bg-red-50 border-0 text-red-600 hover:bg-red-100 rounded px-2 py-0.5 cursor-pointer dark:bg-red-900/30 dark:text-red-400">×</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <TextInput value={newArea} onChange={e => setNewArea(e.target.value)} onKeyDown={e => e.key === 'Enter' && addArea()}
            placeholder="New location (e.g. Rooftop Deck)" sizing="sm" className="flex-1" />
          <Button size="sm" onClick={addArea}>+ Add</Button>
        </div>
      </Section>
    </div>
  )
}

// ── UA Panel ──────────────────────────────────────────────────────

function UAPanelSettings({ settings, onSave, saving }) {
  const [panel, setPanel] = useState([...(settings.ua_panel || [])])
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const dragIdx = useRef(null)

  function onDragStart(e, i) { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move' }
  function onDragOver(e, i) {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const next = [...panel]; const [m] = next.splice(dragIdx.current, 1); next.splice(i, 0, m)
    dragIdx.current = i; setPanel(next)
  }
  function onDrop() { dragIdx.current = null }

  function addItem() {
    const c = code.trim().toUpperCase(); if (!c || panel.includes(c)) return
    setPanel([...panel, c]); setCode('')
  }

  async function save() {
    const ok = await onSave({ ua_panel: panel })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div>
      <Section title="UA Panel" right={<><SaveMsg ok={saved} /><Button size="xs" onClick={save} isProcessing={saving} disabled={saving}>{saving ? 'Saving…' : 'Save Panel'}</Button></>}>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Substances shown in the UA modal. Drag ⠿ to reorder.</p>
        <div className="mb-3">
          {panel.map((item, i) => (
            <div key={i} draggable
              onDragStart={e => onDragStart(e, i)} onDragOver={e => onDragOver(e, i)} onDrop={onDrop}
              className="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0 dark:border-gray-700">
              <span className="cursor-grab text-gray-400">⠿</span>
              <span className="font-mono font-bold text-sm flex-1 text-gray-700 dark:text-gray-300">{item}</span>
              <button onClick={() => setPanel(panel.filter((_, j) => j !== i))}
                className="text-xs bg-red-50 border-0 text-red-600 hover:bg-red-100 rounded px-2 py-0.5 cursor-pointer dark:bg-red-900/30 dark:text-red-400">×</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <TextInput value={code} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder="Code (e.g. ETG)" sizing="sm" className="w-28 font-mono" />
          <Button size="sm" onClick={addItem}>+ Add</Button>
        </div>
      </Section>
    </div>
  )
}

// ── Facility Reset ────────────────────────────────────────────────

function FacilityReset() {
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function doReset() {
    if (confirm !== 'RESET') { setMsg('Type RESET to confirm.'); return }
    setBusy(true); setMsg('')
    const r = await apiFetch('/api/facility/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rooms: [] }),
    })
    setBusy(false)
    if (r.ok) { setMsg('✓ Roster wiped.'); setConfirm('') }
    else { const j = await r.json(); setMsg(j.error || 'Failed') }
  }

  return (
    <div>
      <div className="mb-5 border-2 border-red-600 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-red-600">
          <span className="w-2 h-2 rounded-full bg-white/80 shrink-0" />
          <span className="text-sm font-semibold text-white">Reset Roster</span>
        </div>
        <div className="p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            This permanently wipes all residents and rooms. Shift reports are preserved. Use Bulk Import to reconfigure after reset.
          </p>
          {msg && <Alert color={msg.startsWith('✓') ? 'success' : 'failure'} className="mb-3">{msg}</Alert>}
          <div className="flex gap-3 items-center">
            <TextInput value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Type RESET to confirm" maxLength={10} className="w-48 font-mono" />
            <Button color="failure" size="sm" onClick={doReset} disabled={busy || confirm !== 'RESET'}>
              ⚠ Wipe Roster &amp; Reset
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// AUDIT LOG TAB
// ══════════════════════════════════════════════════════════════════

const AUDIT_CATS = [
  { value: '', label: 'All' },
  { value: 'auth', label: 'Auth' },
  { value: 'report,log', label: 'Reports & Logs' },
  { value: 'client,status', label: 'Residents' },
  { value: 'passes', label: 'Passes' },
  { value: 'mail', label: 'Mail' },
  { value: 'staff', label: 'Staff' },
  { value: 'ua', label: 'UA' },
  { value: 'facility', label: 'Facility' },
  { value: 'user,group', label: 'Admin' },
  { value: 'server', label: 'Server' },
]

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}

function AuditLogTab() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [users, setUsers] = useState([])
  const [page, setPage] = useState(0)
  const [cat, setCat] = useState('')
  const [actorId, setActorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(false)
  const LIMIT = 50

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: LIMIT, offset: page * LIMIT })
    if (cat) params.set('action', cat)
    if (actorId) params.set('actorId', actorId)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (search.trim()) params.set('search', search.trim())
    try {
      const r = await apiFetch(`/api/audit-log?${params}`)
      if (r.ok) { const j = await r.json(); setRows(j.rows || []); setTotal(j.total || 0) }
    } finally { setLoading(false) }
  }, [page, cat, actorId, from, to, search])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    apiFetch('/api/users').then(r => r.ok ? r.json() : []).then(setUsers)
  }, [])

  function exportCSV() {
    const header = ['Time', 'User', 'IP', 'Action', 'Target Type', 'Target', 'Detail']
    const csvRows = [header, ...rows.map(r => [
      r.ts, r.actor_name || '', r.ip || '',
      r.action, r.target_type || '', r.target_label || r.target_id || '',
      r.detail || '',
    ])]
    const csv = csvRows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `opspoint_audit_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  function fmtDetail(s) {
    if (!s) return ''
    try { return Object.entries(JSON.parse(s)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n') }
    catch { return s }
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div>
      <Section title="Audit Log" noPad
        right={<><span className="font-mono text-xs text-gray-400">{total} entries</span><Button size="xs" color="light" onClick={exportCSV}>⬇ Export CSV</Button></>}>

        {/* Category chips */}
        <div className="flex gap-1.5 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex-wrap">
          {AUDIT_CATS.map(c => (
            <button key={c.value} onClick={() => { setCat(c.value); setPage(0) }}
              className={`px-3 py-1 rounded-full text-xs font-bold border cursor-pointer transition-colors ${
                cat === c.value
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-transparent text-gray-600 border-gray-300 hover:bg-gray-100 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700'
              }`}>{c.label}</button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex-wrap items-center">
          <Select sizing="sm" value={actorId} onChange={e => { setActorId(e.target.value); setPage(0) }}>
            <option value="">All Users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.display_name} ({u.username})</option>)}
          </Select>
          <TextInput sizing="sm" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(0) }} />
          <span className="text-xs text-gray-400">to</span>
          <TextInput sizing="sm" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(0) }} />
          <TextInput sizing="sm" placeholder="🔍 Search user, action, target…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }} className="flex-1 min-w-44" />
          <Button size="xs" color="light" onClick={() => { setCat(''); setActorId(''); setFrom(''); setTo(''); setSearch(''); setPage(0) }}>Clear</Button>
        </div>

        {loading ? <p className="text-sm text-gray-400 py-8 text-center dark:text-gray-500">Loading…</p>
          : rows.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center dark:text-gray-500">No audit entries found.</p>
          : (
            <Table hoverable flush>
                <TableHead>
                  <TableHeadCell className="w-36">Time</TableHeadCell>
                  <TableHeadCell className="w-28">User</TableHeadCell>
                  <TableHeadCell className="w-28">IP</TableHeadCell>
                  <TableHeadCell className="w-40">Action</TableHeadCell>
                  <TableHeadCell className="w-44">Target</TableHeadCell>
                  <TableHeadCell>Detail</TableHeadCell>
                </TableHead>
                <TableBody>
                  {rows.map(row => (
                    <>
                      <TableRow key={row.id} className="cursor-pointer" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                        <TableCell className="text-xs text-gray-500 whitespace-nowrap dark:text-gray-400">{fmtDT(row.ts)}</TableCell>
                        <TableCell className="text-sm font-semibold text-gray-800 dark:text-white">{row.actor_name || '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-gray-400">{row.ip || '—'}</TableCell>
                        <TableCell>
                          <span className={`font-mono text-[11px] px-1.5 py-0.5 rounded font-bold ${actionBadgeCls(row.action)}`}>{row.action}</span>
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 dark:text-gray-400">{row.target_label || row.target_type || '—'}</TableCell>
                        <TableCell className="text-xs text-gray-500 max-w-[200px]">
                          {row.detail ? <span className="text-blue-600 underline decoration-dotted dark:text-blue-400">View detail…</span> : ''}
                        </TableCell>
                      </TableRow>
                      {expanded === row.id && row.detail && (
                        <TableRow key={`${row.id}-exp`}>
                          <TableCell colSpan={6} className="bg-gray-50 dark:bg-gray-700/50 py-2 px-4">
                            <pre className="font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap m-0">{fmtDetail(row.detail)}</pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
          )
        }

        {totalPages > 1 && (
          <div className="flex items-center gap-3 px-4 py-2.5 text-sm border-t border-gray-200 dark:border-gray-700">
            <Button size="xs" color="light" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</Button>
            <span className="text-gray-500 dark:text-gray-400">{page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total} entries</span>
            <Button size="xs" color="light" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</Button>
          </div>
        )}
        {rows.length > 0 && <p className="text-[11px] text-gray-400 px-4 py-1.5 border-t border-gray-100 dark:border-gray-700">Click a row to expand detail</p>}
      </Section>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// SYSTEM TAB
// ══════════════════════════════════════════════════════════════════

function SystemTab() {
  const confirm = useConfirm()
  const [restarting, setRestarting] = useState(false)
  const [msg, setMsg] = useState('')

  // ── Software updates ──────────────────────────────────────────────
  const [upd, setUpd] = useState(null)            // /api/update/status payload
  const [checking, setChecking] = useState(false)
  const [checkErr, setCheckErr] = useState('')
  const [progress, setProgress] = useState(null)  // {phase,pct,message,error,applying}
  const [confirming, setConfirming] = useState(false)
  const pollRef = useRef(null)
  const targetRef = useRef(null)

  // ── Central / HQ connection ───────────────────────────────────────
  const [central, setCentral] = useState(null)         // /api/central/status payload
  const [cForm, setCForm] = useState({ url: '', facility_id: '', api_key: '', insecure: false })
  const [cWindow, setCWindow] = useState('')           // maintenance window 'HH:MM-HH:MM'
  const [cBusy, setCBusy] = useState(false)
  const [cErr, setCErr] = useState('')
  const [cMsg, setCMsg] = useState('')
  const loadCentral = useCallback(async () => {
    try { const r = await apiFetch('/api/central/status'); if (r.ok) { const j = await r.json(); setCentral(j); setCWindow(j.update_window || '') } } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadCentral() }, [loadCentral])

  async function centralConnect() {
    setCBusy(true); setCErr(''); setCMsg('')
    try {
      const r = await apiFetch('/api/central/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cForm) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setCErr(j.error || 'Connection failed'); return }
      setCMsg('✓ Connected to ' + (j.central?.name || 'HQ'))
      setCForm(f => ({ ...f, api_key: '' }))
      loadCentral()
    } catch { setCErr('Network error reaching HQ.') }
    finally { setCBusy(false) }
  }
  async function centralCheckin() {
    setCBusy(true); setCErr(''); setCMsg('')
    try {
      const r = await apiFetch('/api/central/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setCErr(j.error || 'Check-in failed'); loadCentral(); return }
      setCMsg('✓ Checked in with ' + (j.central?.name || 'HQ'))
      loadCentral()
    } catch { setCErr('Network error reaching HQ.') }
    finally { setCBusy(false) }
  }
  async function centralSyncNow() {
    setCBusy(true); setCErr(''); setCMsg('')
    try {
      const r = await apiFetch('/api/central/sync-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setCErr(j.error || 'Sync failed'); loadCentral(); return }
      setCMsg(j.pending > 0 ? ('Synced — ' + j.pending + ' change(s) still pending') : '✓ All changes backed up to HQ')
      loadCentral()
    } catch { setCErr('Network error reaching HQ.') }
    finally { setCBusy(false) }
  }
  async function centralToggleUsers(enabled) {
    setCBusy(true); setCErr(''); setCMsg('')
    try {
      const r = await apiFetch('/api/central/manage-users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setCErr(j.error || 'Failed'); loadCentral(); return }
      setCMsg(enabled ? ('✓ HQ user management ON — ' + (j.count || 0) + ' account(s) provisioned') : 'HQ user management turned off')
      loadCentral()
    } catch { setCErr('Network error reaching HQ.') } finally { setCBusy(false) }
  }
  async function centralPullUsers() {
    setCBusy(true); setCErr(''); setCMsg('')
    try {
      const r = await apiFetch('/api/central/pull-users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setCErr(j.error || 'Failed'); return }
      setCMsg('✓ Pulled HQ users — ' + (j.count || 0) + ' provisioned')
      loadCentral()
    } catch { setCErr('Network error reaching HQ.') } finally { setCBusy(false) }
  }
  async function centralSetAuto(auto_update, window) {
    setCBusy(true); setCErr(''); setCMsg('')
    try {
      const r = await apiFetch('/api/central/auto-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto_update, window }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setCErr(j.error || 'Failed'); return }
      setCMsg(auto_update ? '✓ Auto-update ON' + (j.update_window ? (' (window ' + j.update_window + ')') : ' (anytime)') : 'Auto-update turned off')
      loadCentral()
    } catch { setCErr('Network error reaching HQ.') } finally { setCBusy(false) }
  }
  async function centralDisconnect() {
    if (!await confirm({ title: 'Disconnect this facility from HQ?', body: 'It will stop syncing until reconnected.', confirmText: 'Disconnect', color: 'red' })) return
    setCBusy(true); setCErr(''); setCMsg('')
    try {
      const r = await apiFetch('/api/central/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setCErr(j.error || 'Failed'); return }
      setCMsg('Disconnected from HQ.'); loadCentral()
    } catch { setCErr('Network error.') }
    finally { setCBusy(false) }
  }

  const loadStatus = useCallback(async () => {
    try {
      const r = await apiFetch('/api/update/status')
      if (r.ok) { const j = await r.json(); setUpd(j); if (j.progress && j.progress.phase !== 'idle') setProgress(j.progress) }
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadStatus(); return () => { if (pollRef.current) clearInterval(pollRef.current) } }, [loadStatus])

  async function check() {
    setChecking(true); setCheckErr('')
    try {
      const r = await apiFetch('/api/update/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json()
      if (!r.ok) { setCheckErr(j.error || 'Check failed'); return }
      setUpd(u => ({ ...(u || {}), ...j }))
    } catch { setCheckErr('Could not reach the update server.') }
    finally { setChecking(false) }
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/update/status', { credentials: 'include' })
        if (!r.ok) return
        const j = await r.json()
        if (j.progress) setProgress(j.progress)
        // Success: the respawned server is now serving the target version
        if (targetRef.current && j.current && cmpVer(j.current, targetRef.current) >= 0 && (!j.progress || !j.progress.applying)) {
          clearInterval(pollRef.current); pollRef.current = null
          setProgress({ phase: 'done', pct: 100, message: 'Updated to v' + j.current + '. Reloading…', applying: false })
          setTimeout(() => window.location.reload(), 1500)
        } else if (j.progress && j.progress.phase === 'error') {
          clearInterval(pollRef.current); pollRef.current = null
        }
      } catch { /* server restarting — keep polling */ }
    }, 1500)
  }

  async function install() {
    setConfirming(false)
    targetRef.current = upd?.latest || null
    setProgress({ phase: 'preflight', pct: 1, message: 'Starting…', applying: true })
    try {
      const r = await apiFetch('/api/update/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setProgress({ phase: 'error', error: j.error || 'Failed to start update', applying: false }); return }
      startPolling()
    } catch { setProgress({ phase: 'error', error: 'Network error', applying: false }) }
  }

  async function restart() {
    if (!await confirm({ title: 'Restart the server?', body: 'All active sessions will briefly disconnect.', confirmText: 'Restart', color: 'red' })) return
    setRestarting(true); setMsg('⏱ Restarting…')
    await apiFetch('/api/admin/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    // Poll until back online
    const poll = setInterval(async () => {
      try {
        const r = await fetch('/api/facility/settings', { credentials: 'include' })
        if (r.ok) { clearInterval(poll); setRestarting(false); setMsg('✓ Server restarted. Page will reload.'); setTimeout(() => window.location.reload(), 1000) }
      } catch { /* still down */ }
    }, 2000)
  }

  const cur = upd?.current || '—'
  const available = !!upd?.available
  const busy = !!(progress && progress.applying)

  return (
    <div>
      {/* Central / HQ Connection */}
      <Section title="Central / HQ Connection"
        right={central?.connected && !cBusy ? <Button size="xs" color="light" onClick={centralCheckin}>Check in now</Button> : null}>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Link this facility to your central OpsPoint (HQ) server for off-site backup and org-wide reporting. The facility keeps running normally if HQ is unreachable.
        </p>
        {cErr && <Alert color="failure" className="mb-3">{cErr}</Alert>}
        {cMsg && <Alert color="success" className="mb-3">{cMsg}</Alert>}

        {central?.connected ? (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-bold text-emerald-900 dark:text-emerald-300">Connected to HQ</span>
              <Badge color={central.last_status === 'connected' ? 'success' : 'failure'}>{central.last_status || 'unknown'}</Badge>
            </div>
            <div className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
              <div><strong>HQ URL:</strong> <code className="font-mono">{central.url}</code></div>
              <div><strong>Facility ID:</strong> <code className="font-mono">{central.facility_id}</code></div>
              <div><strong>Key:</strong> <code className="font-mono">{central.key_prefix}…</code></div>
              <div><strong>Last check-in:</strong> {central.last_checkin || 'never'}</div>
              <div><strong>Backup:</strong> {central.pending > 0 ? `${central.pending} change(s) pending` : 'up to date'}{central.last_sync ? ` · last synced ${central.last_sync}` : ''}</div>
              {central.target_version && (
                <div><strong>HQ target version:</strong> v{central.target_version}
                  {central.update_available
                    ? <span className="text-amber-600 dark:text-amber-400"> — you're on v{central.current_version}; use Software Updates above</span>
                    : <span className="text-emerald-600 dark:text-emerald-400"> ✓ up to date</span>}
                </div>
              )}
              {central.sync_error && <div className="text-red-700 dark:text-red-400">Sync error: {central.sync_error}</div>}
              {central.insecure && <div className="text-amber-600 dark:text-amber-400">⚠ TLS verification disabled for HQ</div>}
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="xs" color="light" onClick={centralCheckin} disabled={cBusy}>Check in now</Button>
              <Button size="xs" onClick={centralSyncNow} disabled={cBusy}>Sync now</Button>
              <Button size="xs" color="failure" onClick={centralDisconnect} disabled={cBusy}>Disconnect</Button>
            </div>
            <div className="mt-4 pt-4 border-t border-emerald-200 dark:border-emerald-800">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer">
                <Checkbox checked={!!central.manages_users} disabled={cBusy} onChange={e => centralToggleUsers(e.target.checked)} />
                Let HQ manage user accounts for this facility
              </label>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 ml-6">
                {central.manages_users
                  ? <>HQ-provisioned accounts: <strong>{central.users_count || 0}</strong>{central.users_last_pull ? ` · last pulled ${central.users_last_pull}` : ''}
                      <div className="mt-2"><Button size="xs" color="light" onClick={centralPullUsers} disabled={cBusy}>Pull users now</Button></div></>
                  : 'Off — this facility manages its own accounts. Your local admin always stays in control.'}
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-emerald-200 dark:border-emerald-800">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer">
                <Checkbox checked={!!central.auto_update} disabled={cBusy} onChange={e => centralSetAuto(e.target.checked, cWindow)} />
                Auto-apply HQ rollout updates
              </label>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 ml-6">
                {central.auto_update
                  ? <>This facility installs HQ-staged updates automatically (verified + signed), then auto-rolls-back a failed boot.
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        <span>Maintenance window:</span>
                        <TextInput sizing="xs" value={cWindow} onChange={e => setCWindow(e.target.value)} placeholder="HH:MM-HH:MM (empty = anytime)" className="w-52" />
                        <Button size="xs" color="light" onClick={() => centralSetAuto(true, cWindow)} disabled={cBusy}>Save window</Button>
                      </div>
                      <div className="mt-1">{central.update_window ? `Applies only between ${central.update_window}` : 'Applies anytime HQ releases to this facility.'}</div>
                    </>
                  : 'Off — updates wait for an admin to click Install above. Turn on for hands-off HQ rollouts.'}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-md space-y-3">
            <div><Label htmlFor="hq-url" className="mb-1 block">HQ server URL</Label>
              <TextInput id="hq-url" placeholder="https://hq.example.org:4000" value={cForm.url} onChange={e => setCForm(f => ({ ...f, url: e.target.value }))} /></div>
            <div><Label htmlFor="hq-fid" className="mb-1 block">Facility ID</Label>
              <TextInput id="hq-fid" placeholder="from the HQ console" value={cForm.facility_id} onChange={e => setCForm(f => ({ ...f, facility_id: e.target.value }))} /></div>
            <div><Label htmlFor="hq-key" className="mb-1 block">Enrollment key</Label>
              <TextInput id="hq-key" type="password" placeholder="one-time key from HQ" value={cForm.api_key} onChange={e => setCForm(f => ({ ...f, api_key: e.target.value }))} /></div>
            <div className="flex items-center gap-2">
              <Checkbox id="hq-insecure" checked={cForm.insecure} onChange={e => setCForm(f => ({ ...f, insecure: e.target.checked }))} />
              <Label htmlFor="hq-insecure" className="cursor-pointer text-sm">Allow self-signed TLS cert on HQ (trusted networks only)</Label>
            </div>
            <Button size="sm" onClick={centralConnect} isProcessing={cBusy} disabled={cBusy}>{cBusy ? 'Connecting…' : 'Connect to HQ'}</Button>
          </div>
        )}
      </Section>

      {/* Software Updates */}
      <Section title="Software Updates"
        right={!busy ? <Button size="xs" color="light" onClick={check} isProcessing={checking} disabled={checking}>{checking ? 'Checking…' : 'Check for Updates'}</Button> : null}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-sm text-gray-500 dark:text-gray-400">Current version</span>
          <span className="font-mono font-bold text-gray-800 dark:text-white">v{cur}</span>
          {upd?.lastChecked && <span className="text-xs text-gray-400">· checked {new Date(upd.lastChecked).toLocaleString()}</span>}
        </div>

        {checkErr && <Alert color="failure" className="mb-3">{checkErr}</Alert>}

        {progress && progress.phase !== 'idle' ? (
          <div className="mb-3">
            {progress.phase === 'error' ? (
              <Alert color="failure">
                <p className="font-semibold">Update failed.</p>
                <p className="text-sm mt-1">{progress.error}</p>
                <Button size="xs" color="light" className="mt-2" onClick={() => setProgress(null)}>Dismiss</Button>
              </Alert>
            ) : (
              <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 dark:bg-sky-900/10 dark:border-sky-800">
                <div className="flex justify-between text-sm text-sky-700 dark:text-sky-300 mb-2">
                  <span>{progress.message || progress.phase}</span>
                  <span>{progress.pct || 0}%</span>
                </div>
                <div className="h-1.5 bg-sky-100 rounded-full overflow-hidden dark:bg-sky-900/30">
                  <div style={{ width: `${progress.pct || 0}%` }} className="h-full bg-sky-500 transition-[width] duration-300" />
                </div>
                {busy && <p className="text-xs text-gray-400 mt-2">Do not close this window. The server will restart automatically.</p>}
              </div>
            )}
          </div>
        ) : available ? (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-bold text-emerald-900 dark:text-emerald-300">Update available — v{upd.latest}</span>
              {upd.mandatory && <Badge color="failure">Required</Badge>}
            </div>
            {Array.isArray(upd.changelog) && upd.changelog.length > 0 && (
              <ul className="list-disc pl-4 text-sm text-gray-700 dark:text-gray-300 mb-3 space-y-0.5">
                {upd.changelog.slice(0, 8).map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}
            {!confirming
              ? <Button size="sm" onClick={() => setConfirming(true)}>Download &amp; Install</Button>
              : (
                <div className="bg-white border border-gray-200 rounded-xl p-3 dark:bg-gray-800 dark:border-gray-700">
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                    This downloads and verifies v{upd.latest}, backs up the database, then <strong>restarts the server</strong> — everyone is disconnected for ~30&nbsp;seconds. Make sure no one is mid-report. Continue?
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={install}>Yes, install v{upd.latest}</Button>
                    <Button size="sm" color="light" onClick={() => setConfirming(false)}>Cancel</Button>
                  </div>
                </div>
              )
            }
          </div>
        ) : (
          upd && <p className="text-sm text-green-600 dark:text-green-400">✓ You're on the latest version.</p>
        )}
      </Section>

      {/* Server Control */}
      <Section title="Server Control">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Restart the OpsPoint server process. The server will shut down, respawn automatically, and all connected clients will reconnect within a few seconds.
        </p>
        {msg && <Alert color={msg.startsWith('✓') ? 'success' : 'warning'} className="mb-3">{msg}</Alert>}
        <Button color="failure" size="sm" onClick={restart} disabled={restarting || busy}>⚠ Restart Server</Button>
      </Section>

      {/* Version Info */}
      <Section title="Version Info">
        <div className="space-y-2 text-sm">
          {[['App', 'OpsPoint'], ['Version', 'v' + cur], ['Server', window.location.host], ['Protocol', window.location.protocol === 'https:' ? 'HTTPS (TLS)' : 'HTTP']].map(([k, v]) => (
            <div key={k} className="flex gap-4">
              <span className="font-semibold text-gray-600 w-20 shrink-0 dark:text-gray-400">{k}</span>
              <span className="font-mono text-xs text-gray-800 dark:text-gray-200">{v}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

// Tiny semver compare for the updater UI (numeric core only).
function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return 1; if ((pa[i] || 0) < (pb[i] || 0)) return -1 }
  return 0
}
