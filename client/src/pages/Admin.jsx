import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { usePermission } from '../hooks/usePermission.js'

// ── Admin sections (clinical-style left rail) ─────────────────────
// Each item maps to a single content panel — no nested sub-tabs. Grouped and
// permission-filtered exactly like the Clinical section's rail.
const ADMIN_NAV = [
  { group: 'Accounts', items: [
    { key: 'users:staff',   label: 'Staff & Users',     icon: '👥', perm: 'admin.users' },
    { key: 'users:add',     label: 'Add User',          icon: '➕', perm: 'admin.users' },
    { key: 'users:reset',   label: 'Reset Password',    icon: '🔑', perm: 'admin.users' },
    { key: 'users:groups',  label: 'Permission Groups', icon: '🛡️', perm: 'admin.users' },
  ] },
  { group: 'Facility', items: [
    { key: 'fac:general',   label: 'General',          icon: '🏷️', perm: 'admin.settings' },
    { key: 'fac:rooms',     label: 'Rooms',            icon: '🚪', perm: 'facility.manage' },
    { key: 'fac:display',   label: 'Features',         icon: '🖥️', perm: 'admin.settings' },
    { key: 'fac:walk',      label: 'Walk Areas',       icon: '🗺️', perm: 'admin.settings' },
    { key: 'fac:ua',        label: 'UA Panel',         icon: '🧪', perm: 'admin.settings' },
    { key: 'fac:ehr',       label: 'EHR / Compliance', icon: '📋', perm: 'admin.settings' },
    { key: 'fac:resetfac',  label: 'Reset Facility',   icon: '⚠️', perm: 'facility.manage', danger: true },
  ] },
  { group: 'Records', items: [
    { key: 'audit', label: 'Audit Log', icon: '📜', perm: 'admin.audit' },
  ] },
  { group: 'System', items: [
    { key: 'system', label: 'System', icon: '⚙️', perm: 'admin.system' },
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
    <div style={{ display: 'flex', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Rail */}
      <aside style={{ width: 220, flexShrink: 0, background: '#fff', borderRight: '1px solid var(--line, #e2e8f0)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 16px 10px' }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sidebar-bg, #0a4655)', letterSpacing: '-.01em' }}>⚙️ Administration</div>
          <div style={{ fontSize: '.72rem', color: '#94a3b8', marginTop: 2 }}>System configuration</div>
        </div>
        <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
          {groups.map(g => (
            <div key={g.group}>
              <div style={{ fontSize: '.62rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#94a3b8', padding: '10px 12px 4px' }}>{g.group}</div>
              {g.items.map(it => {
                const isActive = active === it.key
                return (
                  <button key={it.key} onClick={() => setActive(it.key)} style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                    padding: '9px 12px', marginBottom: 2, borderRadius: 7, border: 'none', cursor: 'pointer',
                    fontSize: '.85rem', fontWeight: 600, fontFamily: 'var(--sans)',
                    color: isActive ? '#fff' : (it.danger ? 'var(--danger, #dc2626)' : '#334155'),
                    background: isActive ? 'var(--teal-600, #106f88)' : 'transparent',
                  }}>
                    <span style={{ fontSize: '1rem' }}>{it.icon}</span>
                    {it.label}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--line, #e2e8f0)' }}>
          <Link to="/" style={{ display: 'block', width: '100%', textAlign: 'center', padding: '8px 0', borderRadius: 6, border: '1px solid var(--line, #cbd5e1)', background: '#f8fafc', fontSize: '.8rem', fontWeight: 700, color: '#475569', textDecoration: 'none' }}>
            ← Back to Shift
          </Link>
        </div>
      </aside>

      {/* Content */}
      <div className="admin-shell" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px', background: 'var(--bg, #f1f5f9)' }}>
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
  { label: 'Med Witnessing',   perms: ['med.witness','med.delete'] },
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
  'ua.record':'Create / edit UA records','med.witness':'Witness self-administration','med.delete':'Delete med admin entries',
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
      style={{ width: 14, height: 14, flexShrink: 0, cursor: disabled ? 'default' : 'pointer' }} />
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
    <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', background: '#f1f5f9', borderBottom: '1px solid var(--line)' }}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search permissions…"
          style={{ flex: 1, padding: '4px 8px', fontSize: '.78rem', border: '1px solid var(--line)', borderRadius: 4, fontFamily: 'var(--sans)' }} />
        <button type="button" onClick={() => setOpenDomains(allOpen ? new Set() : new Set(PERM_DOMAINS.map(d => d.label)))}
          style={{ fontSize: '.72rem', fontWeight: 700, color: '#475569', background: '#fff', border: '1px solid var(--line)', borderRadius: 4, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {PERM_DOMAINS.map(d => {
        const all = domainPerms(d)
        const visiblePerms = all.filter(matches)
        if (searching && visiblePerms.length === 0) return null
        const granted = all.filter(p => value.includes(p)).length
        const allGranted = all.length > 0 && granted === all.length
        const isOpen = searching || openDomains.has(d.label)

        return (
          <div key={d.label} style={{ borderBottom: '1px solid var(--line)' }}>
            <div onClick={() => !searching && toggleDomain(d.label)}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', background: '#eef2f6', cursor: searching ? 'default' : 'pointer' }}>
              <span style={{ color: '#94a3b8', fontSize: '.8rem', width: 12, flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
              <span style={{ fontWeight: 800, fontSize: '.8rem', flex: 1, color: '#334155' }}>{d.label}</span>
              <span style={{ fontSize: '.7rem', fontWeight: 700, color: granted ? '#0f766e' : '#94a3b8', background: '#fff', border: '1px solid var(--line)', borderRadius: 20, padding: '1px 8px' }}>
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
                  <div style={{ padding: '4px 12px 4px 30px', background: '#f8fafc', fontSize: '.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>{cl}</div>
                  {vp.map(p => (
                    <label key={p} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '5px 12px 5px 34px',
                      borderTop: '1px solid #f1f5f9', cursor: disabled ? 'default' : 'pointer',
                      background: value.includes(p) ? '#eff6ff' : 'transparent', opacity: disabled ? .6 : 1,
                    }}>
                      <input type="checkbox" checked={value.includes(p)} disabled={disabled}
                        onChange={() => toggle(p)} style={{ width: 13, height: 13, flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '.71rem', color: '#475569', minWidth: 190 }}>{p}</span>
                      <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>{PERM_LABELS[p] || ''}</span>
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
    if (!window.confirm(`Remove ${u.displayName || u.display_name || u.username}?`)) return
    const r = await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' })
    if (!r.ok) { const j = await r.json(); alert(j.error || 'Delete failed') }
    else reload()
  }

  const GROUP_COLORS = { admin: '#dc2626', supervisor: '#7c3aed', pa: '#2563eb', case_manager: '#059669' }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Current Staff</span></div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>{users.length} account{users.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="section-body" style={{ padding: 0 }}>
          <div className="roster-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th><th>Display Name</th><th>Member Of</th><th>Created</th><th className="tc">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '.82rem' }}>
                      {u.username}
                      {u.is_protected && <span title="Protected" style={{ marginLeft: 5, color: '#f59e0b' }}>🔒</span>}
                      {u.must_change_pw && <span style={{ marginLeft: 4, fontSize: '.7rem', background: '#fee2e2', color: '#991b1b', padding: '1px 5px', borderRadius: 8 }}>pw reset</span>}
                    </td>
                    <td style={{ fontWeight: 600 }}>{u.displayName || u.display_name}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {(u.groups || []).map(g => (
                          <span key={g.id} style={{
                            fontSize: '.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                            background: GROUP_COLORS[g.key] ? GROUP_COLORS[g.key] + '22' : '#e2e8f0',
                            color: GROUP_COLORS[g.key] || '#475569',
                            border: `1px solid ${GROUP_COLORS[g.key] ? GROUP_COLORS[g.key] + '55' : '#cbd5e1'}`,
                          }}>{g.label}</span>
                        ))}
                        {(!u.groups || !u.groups.length) && <span style={{ fontSize: '.76rem', color: '#94a3b8' }}>No groups</span>}
                      </div>
                    </td>
                    <td className="date-cell">{fmtDate(u.createdAt)}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)', marginRight: 4 }}
                        onClick={() => openGroups(u)}>Groups</button>
                      {u.id !== session?.id && (
                        <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)', marginRight: 4 }}
                          onClick={() => toggleProtect(u)}>{u.is_protected ? 'Unprotect' : 'Protect'}</button>
                      )}
                      {u.id !== session?.id && !u.is_protected && (
                        <button className="btn-danger-sm" onClick={() => del(u)}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {groupModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setGroupModal(null)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <h2>Groups — {groupModal.displayName || groupModal.display_name}</h2>
              <button className="xbtn" onClick={() => setGroupModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              {error && <div className="auth-error">{error}</div>}
              <p style={{ fontSize: '.82rem', color: '#475569', marginBottom: 12 }}>
                Effective permissions = union of all assigned groups.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, border: '1.5px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
                {groups.map(g => {
                  const isMember = memberOf.includes(g.id)
                  return (
                    <label key={g.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                      cursor: 'pointer', background: isMember ? '#eff6ff' : 'transparent',
                      borderBottom: '1px solid var(--line)',
                    }}>
                      <input type="checkbox" checked={isMember}
                        onChange={() => setMemberOf(prev => prev.includes(g.id) ? prev.filter(x => x !== g.id) : [...prev, g.id])}
                        style={{ width: 15, height: 15, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '.84rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {g.label}
                          {g.is_protected && <span style={{ color: '#f59e0b' }}>🔒</span>}
                          {isMember && <span style={{ fontSize: '.68rem', background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>Member</span>}
                        </div>
                        <div style={{ fontSize: '.72rem', color: '#94a3b8' }}>{(g.permissions || []).length} permissions · {g.memberCount ?? 0} member{g.memberCount !== 1 ? 's' : ''}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setGroupModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveGroups} disabled={saving}>{saving ? 'Saving…' : 'Save Groups'}</button>
            </div>
          </div>
        </div>
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
      <div className="section">
        <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Add Staff Member</span></div></div>
        <div className="section-body">
          {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
          {success && <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', padding: '9px 13px', borderRadius: 8, fontSize: '.84rem', marginBottom: 12 }}>{success}</div>}
          <form onSubmit={submit}>
            <div className="adm-row">
              <div className="field"><label>Username</label>
                <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="e.g. jsmith" />
              </div>
              <div className="field"><label>Display Name</label>
                <input type="text" value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} placeholder="e.g. Jane Smith" />
              </div>
              <div className="field"><label>Password</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 chars" />
              </div>
              <div className="field"><label>Confirm Password</label>
                <input type="password" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} placeholder="Repeat password" />
              </div>
            </div>
            {groups.length > 0 && (
              <div className="field">
                <label>Group Membership</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, border: '1.5px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
                  {groups.map(g => {
                    const isMember = form.groupIds.includes(g.id)
                    return (
                      <label key={g.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                        cursor: 'pointer', background: isMember ? '#eff6ff' : 'transparent',
                        borderBottom: '1px solid var(--line)',
                      }}>
                        <input type="checkbox" checked={isMember}
                          onChange={() => setForm(f => ({ ...f, groupIds: f.groupIds.includes(g.id) ? f.groupIds.filter(x => x !== g.id) : [...f.groupIds, g.id] }))}
                          style={{ width: 15, height: 15, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: '.84rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {g.label}
                            {isMember && <span style={{ fontSize: '.68rem', background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>Selected</span>}
                          </div>
                          <div style={{ fontSize: '.72rem', color: '#94a3b8' }}>{(g.permissions || []).length} permissions</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <div style={{ background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 6, padding: '10px 14px', fontSize: '.78rem', color: '#475569', marginBottom: 14 }}>
              <strong>Password requirements:</strong> 8+ characters · Uppercase · Lowercase · Number · Symbol (!@#$%^&amp;*)
            </div>
            <button type="submit" className="btn btn-primary" style={{ maxWidth: 280, width: '100%' }} disabled={saving}>{saving ? 'Creating…' : 'Create Account'}</button>
          </form>
        </div>
      </div>
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
      <div className="section">
        <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Reset Staff Password</span></div></div>
        <div className="section-body">
          {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
          {success && <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', padding: '9px 13px', borderRadius: 8, fontSize: '.84rem', marginBottom: 12 }}>{success}</div>}
          <form onSubmit={resetOther}>
            <div className="adm-row">
              <div className="field"><label>Select Staff Member</label>
                <select value={targetId} onChange={e => setTargetId(e.target.value)}>
                  <option value="">— Select staff member —</option>
                  {users.filter(u => u.id !== session?.id).map(u => (
                    <option key={u.id} value={u.id}>{u.displayName || u.display_name} ({u.username})</option>
                  ))}
                </select>
              </div>
              <div className="field"><label>New Password</label>
                <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Min 8 chars" />
              </div>
              <div className="field"><label>Confirm Password</label>
                <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Repeat password" />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ maxWidth: 280, width: '100%' }} disabled={saving}>{saving ? 'Saving…' : 'Set New Password'}</button>
          </form>
          <button onClick={() => setShowSelf(s => !s)} className="btn btn-sm"
            style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)', maxWidth: 280, width: '100%', marginTop: 16 }}>
            {showSelf ? '▲ Hide' : '▼ Change My Own Password'}
          </button>
        </div>
      </div>

      {showSelf && (
        <div className="section">
          <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Change My Password</span></div></div>
          <div className="section-body">
            {selfErr && <div className="auth-error" style={{ marginBottom: 12 }}>{selfErr}</div>}
            {selfOk && <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', padding: '9px 13px', borderRadius: 8, fontSize: '.84rem', marginBottom: 12 }}>{selfOk}</div>}
            <form onSubmit={changeSelf}>
              <div className="field"><label>Current Password</label>
                <input type="password" value={selfCur} onChange={e => setSelfCur(e.target.value)} /></div>
              <div className="field"><label>New Password</label>
                <input type="password" value={selfPw} onChange={e => setSelfPw(e.target.value)} /></div>
              <div className="field"><label>Confirm New Password</label>
                <input type="password" value={selfPw2} onChange={e => setSelfPw2(e.target.value)} /></div>
              <button type="submit" className="btn btn-primary" style={{ maxWidth: 280, width: '100%' }}>Change My Password</button>
            </form>
          </div>
        </div>
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
    <div style={{ border: '1.5px solid var(--line)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', background: open ? '#f8fafc' : '#fff' }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ color: '#94a3b8', fontSize: '.8rem', width: 14, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 700, fontSize: '.9rem', flex: 1 }}>{g.label}</span>
        {g.is_protected && <span title="Protected" style={{ color: '#f59e0b' }}>🔒</span>}
        <code style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: '#94a3b8', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>{g.key}</code>
        <span style={{ fontSize: '.76rem', color: '#64748b' }}>{(g.permissions || []).length} perms · {g.memberCount ?? 0} member{g.memberCount !== 1 ? 's' : ''}</span>
        {!g.is_protected && (
          <button className="btn-danger-sm" onClick={e => { e.stopPropagation(); onDelete(g) }}>Delete</button>
        )}
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--line)', padding: 16 }}>
          {g.is_protected && (
            <div style={{ background: '#fef9c3', border: '1px solid #fde047', color: '#854d0e', padding: '8px 12px', borderRadius: 6, fontSize: '.78rem', marginBottom: 12 }}>
              🔒 This group is protected. Permissions are managed via server ROLE_PRESETS and cannot be edited here.
            </div>
          )}
          <PermEditor value={perms} onChange={setPerms} disabled={!!g.is_protected} />
          {!g.is_protected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
              {msg && <span style={{ fontSize: '.8rem', color: msg.includes('✓') ? '#16a34a' : '#dc2626' }}>{msg}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GroupsManager({ groups, reload }) {
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
    if (!window.confirm(`Delete group "${g.label}"? Members will lose these permissions.`)) return
    const r = await apiFetch(`/api/groups/${g.id}`, { method: 'DELETE' })
    if (!r.ok) { const j = await r.json(); alert(j.error || 'Delete failed') }
    else reload()
  }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Permission Groups</span></div>
        </div>
        <div className="section-body">
          {groups.map(g => <GroupCard key={g.id} g={g} onSave={reload} onDelete={deleteGroup} />)}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createGroup()}
              placeholder="Group Name (e.g. Night Staff)"
              style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: '.88rem', padding: '7px 10px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none', maxWidth: 300 }} />
            <button className="btn-add btn-add-b" onClick={createGroup} disabled={creating}>+ Create</button>
            {createErr && <span style={{ fontSize: '.78rem', color: '#dc2626' }}>{createErr}</span>}
          </div>
        </div>
      </div>
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
    if (r.ok) { setSettings(body) }
    return r.ok
  }

  if (!settings) return <div className="empty-state" style={{ paddingTop: 48 }}>Loading…</div>

  return (
    <div>
      {sub === 'general'  && hasPerm('admin.settings')  && <>
        <FacilityName settings={settings} onSave={saveSettings} saving={settingSaving} />
        <ShiftTimes settings={settings} onSave={saveSettings} saving={settingSaving} />
        <RemindersSettings settings={settings} onSave={saveSettings} saving={settingSaving} />
      </>}
      {sub === 'rooms'    && hasPerm('facility.manage') && <RoomsManager />}
      {sub === 'display'  && hasPerm('admin.settings')  && <DisplaySettings settings={settings} onSave={saveSettings} saving={settingSaving} />}
      {sub === 'walk'     && hasPerm('admin.settings')  && <WalkAreas settings={settings} onSave={saveSettings} saving={settingSaving} />}
      {sub === 'ua'       && hasPerm('admin.settings')  && <UAPanelSettings settings={settings} onSave={saveSettings} saving={settingSaving} />}
      {sub === 'ehr'      && hasPerm('admin.settings')  && <EHRConfigSettings />}
      {sub === 'resetfac' && hasPerm('facility.manage') && <FacilityReset />}
    </div>
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

  if (!cfg) return <div className="empty-state" style={{ paddingTop: 48 }}>Loading…</div>

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
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}

      {/* Program tracks */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Program Tracks</span></div>
        </div>
        <div className="section-body">
          <p style={{ fontSize:'.78rem', color:'#64748b' }}>Tracks shown in the resident profile dropdown.</p>
          {(cfg.program_tracks||[]).map((t, idx) => (
            <div key={idx} style={{ display:'flex', gap:6, marginBottom:6 }}>
              <input value={t} onChange={e=>setTrack(idx, e.target.value)} style={{ flex:1 }}/>
              <button className="btn btn-sm btn-danger" onClick={()=>removeTrack(idx)}>×</button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={addTrack}>+ Add track</button>
        </div>
      </div>

      {/* Program phases */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Program Phases &amp; Objectives</span></div>
        </div>
        <div className="section-body">
          <p style={{ fontSize:'.78rem', color:'#64748b' }}>Used by the Milestones tab to seed objectives per phase. One objective per line.</p>
          {(cfg.program_phases||[]).map((p, idx) => (
            <div key={idx} style={{ border:'1px solid var(--line)', borderRadius:6, padding:10, marginBottom:10 }}>
              <div style={{ display:'flex', gap:8, marginBottom:6 }}>
                <input placeholder="key (e.g. phase1)" value={p.key||''}   onChange={e=>setPhaseField(idx, 'key', e.target.value)} style={{ flex:1 }}/>
                <input placeholder="Label"             value={p.label||''} onChange={e=>setPhaseField(idx, 'label', e.target.value)} style={{ flex:2 }}/>
                <button className="btn btn-sm btn-danger" onClick={()=>removePhase(idx)}>×</button>
              </div>
              <textarea rows={3} placeholder="One objective per line"
                value={(p.objectives||[]).join('\n')}
                onChange={e=>setPhaseObjectives(idx, e.target.value)}
                style={{ width:'100%' }}/>
            </div>
          ))}
          <button className="btn btn-sm" onClick={addPhase}>+ Add phase</button>
        </div>
      </div>

      {/* Incident notification policy */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Incident Notification Policy</span></div>
        </div>
        <div className="section-body">
          <p style={{ fontSize:'.78rem', color:'#64748b' }}>
            Mandatory notification parties per incident severity. The server enforces these minimums when an incident is logged.
          </p>
          <table className="table" style={{ marginTop:6 }}>
            <thead><tr>
              <th>Severity</th>
              {NOTIFIERS.map(n => <th key={n} style={{ fontSize:'.7em', textTransform:'capitalize' }}>{n.replace(/_/g,' ')}</th>)}
            </tr></thead>
            <tbody>
              {SEVS.map(sev => (
                <tr key={sev}>
                  <td style={{ fontWeight:700, textTransform:'capitalize' }}>{sev}</td>
                  {NOTIFIERS.map(n => (
                    <td key={n} style={{ textAlign:'center' }}>
                      <input type="checkbox"
                        checked={(cfg.incident_notifications?.[sev]||[]).includes(n)}
                        onChange={()=>toggleNotif(sev, n)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* HIPAA idle session timeout */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>HIPAA Idle Session Timeout</span></div>
        </div>
        <div className="section-body">
          <p style={{ fontSize:'.78rem', color:'#64748b' }}>
            Minutes of inactivity before a session is automatically terminated (HIPAA technical safeguard, 45 CFR §164.312(a)(2)(iii)).
            Range: 5–240 minutes.
          </p>
          <div className="field" style={{ maxWidth: 200 }}>
            <label>Idle timeout (minutes)</label>
            <input type="number" min={5} max={240}
              value={cfg.session_idle_mins}
              onChange={e => setCfg({ ...cfg, session_idle_mins: e.target.value })}/>
          </div>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, alignItems:'center', justifyContent:'flex-end', marginTop:12 }}>
        {saved && <SaveMsg ok />}
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save EHR Config'}</button>
      </div>
    </div>
  )
}

function SaveMsg({ ok }) {
  return ok
    ? <span style={{ fontSize: '.8rem', color: '#16a34a', fontWeight: 600 }}>✓ Saved</span>
    : null
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
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Facility Name</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saved && <SaveMsg ok />}
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Name'}</button>
          </div>
        </div>
        <div className="section-body">
          <div className="field">
            <label>Facility Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. James Baldwin Place" />
          </div>
          <p style={{ fontSize: '.78rem', color: '#64748b' }}>Shown in the app header, mobile app, and DOCX reports.</p>
        </div>
      </div>
    </div>
  )
}

// ── Rooms Manager (with drag-to-reorder + bulk import) ────────────

function RoomsManager() {
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
    if (!window.confirm(`Remove room ${r.room}?`)) return
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
      if (!window.confirm(`⚠ This will REPLACE the entire roster with ${parsed.length} room${parsed.length !== 1 ? 's' : ''}. Are you sure?`)) return
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

  function rowBg(r) {
    if (r.is_special) return '#f5f3ff'
    if (!r.is_active) return '#fff1f2'
    if (r.name === 'VACANT') return '#f8fafc'
    return 'transparent'
  }

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {[['Total', total, '#475569'], ['Active', active, '#16a34a'], ['Vacant', vacant, '#94a3b8'], ['Special', special, '#7c3aed'], ['Discharged', discharged, '#dc2626']].map(([label, n, color]) => (
          <div key={label} style={{ border: '1.5px solid var(--line)', borderRadius: 8, padding: '8px 16px', background: '#fff', minWidth: 80, textAlign: 'center' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color }}>{n}</div>
            <div style={{ fontSize: '.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Roster */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Room Roster</span></div>
          <span style={{ fontSize: '.76rem', color: '#94a3b8' }}>Drag 🔀 to reorder</span>
        </div>
        <div className="section-body" style={{ padding: 0 }}>
          {loading ? <div className="empty-state">Loading…</div> : (
            <div className="roster-wrap">
              <table>
                <thead><tr><th style={{ width: 28 }}></th><th>Room #</th><th>Name / Label</th><th>Type</th><th>Status</th><th className="tc">Actions</th></tr></thead>
                <tbody>
                  {rooms.map((r, idx) => (
                    <tr key={r.id} draggable style={{ background: rowBg(r), cursor: 'default' }}
                      onDragStart={e => onDragStart(e, idx)}
                      onDragOver={e => onDragOver(e, idx)}
                      onDrop={onDrop}>
                      <td style={{ textAlign: 'center', cursor: 'grab', color: '#94a3b8', fontSize: '.9rem' }}>⠿</td>
                      <td className="rm">
                        <input type="text" defaultValue={r.room} onBlur={e => e.target.value !== r.room && patchRoom(r.id, { room: e.target.value, name: r.name, is_special: r.is_special ? 1 : 0, special_label: r.special_label || '' })}
                          style={{ width: 60, fontFamily: 'var(--mono)', fontSize: '.82rem', padding: '2px 5px', border: '1px solid var(--line)', borderRadius: 4 }} />
                      </td>
                      <td>
                        <input type="text" defaultValue={r.name} onBlur={e => e.target.value !== r.name && patchRoom(r.id, { room: r.room, name: e.target.value, is_special: r.is_special ? 1 : 0, special_label: r.special_label || '' })}
                          style={{ width: 160, fontSize: '.84rem', padding: '2px 5px', border: '1px solid var(--line)', borderRadius: 4 }} />
                      </td>
                      <td>
                        {r.is_special
                          ? <span style={{ fontSize: '.72rem', fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#ede9fe', color: '#6d28d9' }}>Special</span>
                          : <span style={{ fontSize: '.72rem', fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#f1f5f9', color: '#475569' }}>Resident</span>
                        }
                      </td>
                      <td>
                        {r.is_special ? <span style={{ fontSize: '.76rem', color: '#7c3aed' }}>{r.special_label || '—'}</span>
                          : !r.is_active ? <span style={{ fontSize: '.72rem', fontWeight: 700, background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 8 }}>Discharged</span>
                          : r.name === 'VACANT' ? <span style={{ fontSize: '.76rem', color: '#94a3b8' }}>Vacant</span>
                          : <span style={{ fontSize: '.76rem', fontWeight: 600, color: '#16a34a' }}>Active</span>
                        }
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {!r.is_special && r.name !== 'VACANT' && !!r.is_active && (
                          <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)', marginRight: 4 }}
                            onClick={() => patchRoom(r.id, { room: r.room, name: r.name, is_special: 1, special_label: r.name })}>→ Special</button>
                        )}
                        {!!r.is_special && (
                          <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)', marginRight: 4 }}
                            onClick={() => patchRoom(r.id, { room: r.room, name: 'VACANT', is_special: 0, special_label: '' })}>→ Resident</button>
                        )}
                        {(!!r.is_special || r.name === 'VACANT' || !r.is_active) && (
                          <button className="btn-danger-sm" onClick={() => deleteRoom(r)}>Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Room */}
      <div className="section">
        <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Add Room</span></div></div>
        <div className="section-body">
          {addErr && <div className="auth-error" style={{ marginBottom: 10 }}>{addErr}</div>}
          <form onSubmit={addRoom} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}><label>Room Number</label>
              <input type="text" value={addForm.room} onChange={e => setAddForm(f => ({ ...f, room: e.target.value }))} placeholder="e.g. 207" style={{ width: 100 }} />
            </div>
            <div className="field" style={{ margin: 0 }}><label>Type</label>
              <select value={addForm.type} onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))}>
                <option value="resident">Resident Room (starts Vacant)</option>
                <option value="special">Special Space (Office, Storage…)</option>
              </select>
            </div>
            {addForm.type === 'special' && (
              <div className="field" style={{ margin: 0 }}><label>Space Label</label>
                <input type="text" value={addForm.label} onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Supply Room" />
              </div>
            )}
            <button type="submit" className="btn btn-primary">Add Room</button>
          </form>
        </div>
      </div>

      {/* Bulk Import */}
      <div className="section">
        <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Bulk Import</span></div></div>
        <div className="section-body">
          <p style={{ fontSize: '.82rem', color: '#475569', marginBottom: 8 }}>
            One room per line: <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>room, Name, type</code> — type is <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>resident</code> or <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>special</code>
          </p>
          <p style={{ fontSize: '.78rem', color: '#94a3b8', marginBottom: 10 }}>
            Example: <code>101, Frank E., resident</code> &nbsp; or &nbsp; <code>104, Office, special</code>
          </p>
          <textarea rows={10} value={bulkText} onChange={e => onBulkInput(e.target.value)}
            placeholder={'101, Frank E., resident\n102, Anthony D., resident\n104, Office, special\n# Lines starting with # are ignored'}
            style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: '.82rem', padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, resize: 'vertical', outline: 'none' }} />

          {bulkParsed.length > 0 && (
            <div style={{ margin: '10px 0', fontSize: '.78rem', color: '#475569' }}>
              <strong>{bulkParsed.length} rooms parsed:</strong> {bulkParsed.filter(r => !r.is_special).length} resident, {bulkParsed.filter(r => r.is_special).length} special
              <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 6, border: '1px solid var(--line)', borderRadius: 6 }}>
                <table style={{ width: '100%', fontSize: '.76rem', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: '#f8fafc' }}><th style={{ padding: '4px 8px', textAlign: 'left' }}>Room</th><th style={{ padding: '4px 8px', textAlign: 'left' }}>Name</th><th style={{ padding: '4px 8px', textAlign: 'left' }}>Type</th></tr></thead>
                  <tbody>
                    {bulkParsed.map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '3px 8px', fontFamily: 'var(--mono)' }}>{r.room}</td>
                        <td style={{ padding: '3px 8px' }}>{r.name}</td>
                        <td style={{ padding: '3px 8px', color: r.is_special ? '#7c3aed' : '#475569' }}>{r.is_special ? 'special' : 'resident'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {bulkMsg && (
            <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: '.82rem', marginBottom: 10, background: bulkMsg.startsWith('✓') ? '#dcfce7' : '#fee2e2', color: bulkMsg.startsWith('✓') ? '#15803d' : '#991b1b', border: `1px solid ${bulkMsg.startsWith('✓') ? '#86efac' : '#fca5a5'}` }}>
              {bulkMsg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => importBulk(false)} disabled={!bulkParsed.length}>Append to Roster</button>
            <button className="btn btn-sm btn-red" onClick={() => importBulk(true)} disabled={!bulkParsed.length}>⚠ Replace Entire Roster</button>
          </div>
        </div>
      </div>
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
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Reminder Scheduled Times</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saved && <SaveMsg ok />}
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Reminder Settings'}</button>
          </div>
        </div>
        <div className="section-body">
          <p style={{ fontSize: '.78rem', color: '#64748b', marginBottom: 16 }}>Reminder fires at each time regardless of whether a check has been done.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.84rem', marginBottom: 8 }}>Wellness Check Times</div>
              {ws.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.82rem', flex: 1 }}>{t}</span>
                  <button onClick={() => setWs(ws.filter((_, j) => j !== i))} style={{ background: '#fee2e2', border: 'none', color: '#dc2626', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', fontSize: '.78rem' }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input type="time" value={wTime} onChange={e => setWTime(e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: '.84rem', padding: '4px 8px', border: '1.5px solid var(--line)', borderRadius: 5, outline: 'none' }} />
                <button className="btn-add btn-add-b" onClick={() => { if (wTime && !ws.includes(wTime)) { setWs([...ws, wTime].sort()); setWTime('') } }}>+ Add</button>
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.84rem', marginBottom: 8 }}>Walkthrough Times</div>
              {wk.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.82rem', flex: 1 }}>{t}</span>
                  <button onClick={() => setWk(wk.filter((_, j) => j !== i))} style={{ background: '#fee2e2', border: 'none', color: '#dc2626', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', fontSize: '.78rem' }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input type="time" value={wkTime} onChange={e => setWkTime(e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: '.84rem', padding: '4px 8px', border: '1.5px solid var(--line)', borderRadius: 5, outline: 'none' }} />
                <button className="btn-add btn-add-b" onClick={() => { if (wkTime && !wk.includes(wkTime)) { setWk([...wk, wkTime].sort()); setWkTime('') } }}>+ Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Shift Times ───────────────────────────────────────────────────

function ShiftTimes({ settings, onSave, saving }) {
  const [day, setDay] = useState(settings.shift_day_start || '07:00')
  const [swing, setSwing] = useState(settings.shift_swing_start || '15:00')
  const [grave, setGrave] = useState(settings.shift_grave_start || '23:00')
  const [saved, setSaved] = useState(false)

  function fmtShift(start, end) {
    const fmt = t => { const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}` }
    const endTime = end.split(':').map((v, i) => i === 1 ? String((parseInt(v) - 30 + 60) % 60).padStart(2, '0') : String((parseInt(v) + (parseInt(end.split(':')[1]) < 30 ? -1 : 0) + 24) % 24).padStart(2, '0')).join(':')
    return `${fmt(start)} – ${fmt(endTime)}`
  }

  async function save() {
    const ok = await onSave({ shift_day_start: day, shift_swing_start: swing, shift_grave_start: grave })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Shift Times</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saved && <SaveMsg ok />}
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Shift Times'}</button>
          </div>
        </div>
        <div className="section-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div className="field"><label>Day Start</label><input type="time" value={day} onChange={e => setDay(e.target.value)} /></div>
            <div className="field"><label>Swing Start</label><input type="time" value={swing} onChange={e => setSwing(e.target.value)} /></div>
            <div className="field"><label>Grave Start</label><input type="time" value={grave} onChange={e => setGrave(e.target.value)} /></div>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 6, padding: '10px 14px', fontSize: '.82rem' }}>
            <div style={{ marginBottom: 4 }}><strong>Day:</strong> {day} – end computed 30 min before Swing</div>
            <div style={{ marginBottom: 4 }}><strong>Swing:</strong> {swing} – end computed 30 min before Grave</div>
            <div><strong>Grave:</strong> {grave} – end computed 30 min before Day</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Display Settings ──────────────────────────────────────────────

function DisplaySettings({ settings, onSave, saving }) {
  const [vis, setVis] = useState(settings.ui_visibility || { tabs: {}, buttons: {} })
  const [saved, setSaved] = useState(false)

  const TAB_OPTS = [
    // People (Clients is core — cannot be hidden)
    { key: 'staff',       label: 'Staff' },
    { key: 'caseloads',   label: 'Caseloads' },
    // Daily Ops (Report is core)
    { key: 'chores',      label: 'Chores' },
    { key: 'groups',      label: 'Groups' },
    { key: 'passes',      label: 'Passes' },
    { key: 'mail',        label: 'Mail' },
    // Health & Compliance
    { key: 'ua',          label: 'UA' },
    { key: 'med_log',     label: 'Med Log' },
    // Records (Archive is core; Incidents + Milestones live in Clinical section)
    { key: 'violations',  label: 'Infractions' },
    { key: 'consent',     label: 'Consents' },
  ]
  const BTN_OPTS = [
    { key: 'wellness', label: 'Wellness Check button' },
    { key: 'walkthrough', label: 'Walkthrough button' },
  ]

  function setTab(key, val) { setVis(v => ({ ...v, tabs: { ...v.tabs, [key]: val } })) }
  function setBtn(key, val) { setVis(v => ({ ...v, buttons: { ...v.buttons, [key]: val } })) }

  async function save() {
    const ok = await onSave({ ui_visibility: vis })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Feature Visibility</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saved && <SaveMsg ok />}
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Feature Settings'}</button>
          </div>
        </div>
        <div className="section-body">
          <p style={{ fontSize: '.76rem', color: '#94a3b8', marginBottom: 12 }}>Uncheck any feature your facility does not use — it will be hidden for all staff. Core tabs (Clients, Report, Archive) and Clinical section features are managed separately via permissions.</p>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: '.84rem', marginBottom: 8 }}>Navigation Tabs</div>
            {TAB_OPTS.map(t => (
              <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer', fontSize: '.84rem' }}>
                <input type="checkbox" checked={vis.tabs?.[t.key] !== false} onChange={e => setTab(t.key, e.target.checked)} />
                {t.label}
              </label>
            ))}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '.84rem', marginBottom: 8 }}>Header Toolbar Buttons</div>
            {BTN_OPTS.map(b => (
              <label key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer', fontSize: '.84rem' }}>
                <input type="checkbox" checked={vis.buttons?.[b.key] !== false} onChange={e => setBtn(b.key, e.target.checked)} />
                {b.label}
              </label>
            ))}
          </div>
        </div>
      </div>
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
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Walkthrough Areas</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saved && <SaveMsg ok />}
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Locations'}</button>
          </div>
        </div>
        <div className="section-body">
          <p style={{ fontSize: '.76rem', color: '#94a3b8', marginBottom: 10 }}>Drag ⠿ to reorder</p>
          {areas.map((a, i) => (
            <div key={i} draggable style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', cursor: 'default' }}
              onDragStart={e => onDragStart(e, i)} onDragOver={e => onDragOver(e, i)} onDrop={onDrop}>
              <span style={{ cursor: 'grab', color: '#94a3b8' }}>⠿</span>
              <span style={{ flex: 1, fontSize: '.84rem' }}>{a}</span>
              <button onClick={() => setAreas(areas.filter((_, j) => j !== i))}
                style={{ background: '#fee2e2', border: 'none', color: '#dc2626', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: '.78rem' }}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
            <input type="text" value={newArea} onChange={e => setNewArea(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addArea()}
              placeholder="New location (e.g. Rooftop Deck)"
              style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: '.88rem', padding: '7px 10px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none' }} />
            <button className="btn-add btn-add-b" onClick={addArea}>+ Add</button>
          </div>
        </div>
      </div>
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
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>UA Panel</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saved && <SaveMsg ok />}
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Panel'}</button>
          </div>
        </div>
        <div className="section-body">
          <p style={{ fontSize: '.76rem', color: '#94a3b8', marginBottom: 10 }}>Substances shown in the UA modal. Drag ⠿ to reorder.</p>
          {panel.map((item, i) => (
            <div key={i} draggable style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', cursor: 'default' }}
              onDragStart={e => onDragStart(e, i)} onDragOver={e => onDragOver(e, i)} onDrop={onDrop}>
              <span style={{ cursor: 'grab', color: '#94a3b8' }}>⠿</span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '.84rem', flex: 1 }}>{item}</span>
              <button onClick={() => setPanel(panel.filter((_, j) => j !== i))}
                style={{ background: '#fee2e2', border: 'none', color: '#dc2626', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: '.78rem' }}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
            <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder="Code (e.g. ETG)"
              style={{ width: 120, fontFamily: 'var(--mono)', fontSize: '.88rem', padding: '7px 10px', border: '1.5px solid var(--line)', borderRadius: 6, outline: 'none' }} />
            <button className="btn-add btn-add-b" onClick={addItem}>+ Add</button>
          </div>
        </div>
      </div>
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
      <div className="section" style={{ border: '2px solid #dc2626' }}>
        <div className="section-head" style={{ background: '#dc2626' }}>
          <div className="sh-left" style={{ color: '#fff' }}><span className="sh-dot" style={{ background: '#fff' }} /><span style={{ color: '#fff' }}>Reset Roster</span></div>
        </div>
        <div className="section-body">
          <p style={{ fontSize: '.84rem', color: '#475569', marginBottom: 12 }}>
            This permanently wipes all residents and rooms. Shift reports are preserved. Use Bulk Import to reconfigure after reset.
          </p>
          {msg && <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: '.82rem', marginBottom: 10, background: msg.startsWith('✓') ? '#dcfce7' : '#fee2e2', color: msg.startsWith('✓') ? '#15803d' : '#991b1b' }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="text" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Type RESET to confirm" maxLength={10}
              style={{ width: 180, padding: '7px 10px', border: '2px solid var(--line)', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: '.88rem', outline: 'none' }} />
            <button className="btn btn-sm btn-red" onClick={doReset} disabled={busy || confirm !== 'RESET'}>
              ⚠ Wipe Roster & Reset
            </button>
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

const ACT_COLORS = {
  'auth': '#2563eb', 'report': '#059669', 'log': '#059669', 'status': '#7c3aed',
  'client': '#c2410c', 'passes': '#b45309', 'mail': '#0891b2', 'staff': '#475569',
  'ua': '#dc2626', 'facility': '#9333ea', 'user': '#16a34a', 'group': '#16a34a',
  'server': '#dc2626',
}

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

  function actionColor(action) {
    const prefix = (action || '').split('.')[0]
    return ACT_COLORS[prefix] || '#64748b'
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Audit Log</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>{total} entries</span>
            <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)' }} onClick={exportCSV}>⬇ Export CSV</button>
          </div>
        </div>

        {/* Category chips */}
        <div style={{ display: 'flex', gap: 5, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          {AUDIT_CATS.map(c => (
            <button key={c.value} onClick={() => { setCat(c.value); setPage(0) }}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: '.74rem', fontWeight: 700,
                border: '1.5px solid', cursor: 'pointer', transition: 'all .15s',
                borderColor: cat === c.value ? 'var(--crimson)' : 'var(--line)',
                background: cat === c.value ? 'var(--crimson)' : 'transparent',
                color: cat === c.value ? '#fff' : 'var(--steel)',
              }}>{c.label}</button>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={actorId} onChange={e => { setActorId(e.target.value); setPage(0) }}
            style={{ fontSize: '.8rem', padding: '5px 10px', border: '1.5px solid var(--line)', borderRadius: 5, outline: 'none', background: '#fff' }}>
            <option value="">All Users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.display_name} ({u.username})</option>)}
          </select>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(0) }}
            style={{ fontSize: '.8rem', padding: '5px 8px', border: '1.5px solid var(--line)', borderRadius: 5, outline: 'none' }} />
          <span style={{ fontSize: '.8rem', color: '#94a3b8' }}>to</span>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(0) }}
            style={{ fontSize: '.8rem', padding: '5px 8px', border: '1.5px solid var(--line)', borderRadius: 5, outline: 'none' }} />
          <input type="text" placeholder="🔍 Search user, action, target…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            style={{ fontSize: '.8rem', padding: '5px 10px', border: '1.5px solid var(--line)', borderRadius: 5, outline: 'none', flex: 1, minWidth: 180 }} />
          <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)' }}
            onClick={() => { setCat(''); setActorId(''); setFrom(''); setTo(''); setSearch(''); setPage(0) }}>Clear</button>
        </div>

        <div className="section-body" style={{ padding: 0 }}>
          {loading ? <div className="empty-state">Loading…</div> : rows.length === 0 ? (
            <div className="empty-state">No audit entries found.</div>
          ) : (
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr><th style={{ width: 140 }}>Time</th><th style={{ width: 120 }}>User</th><th style={{ width: 110 }}>IP</th><th style={{ width: 160 }}>Action</th><th style={{ width: 180 }}>Target</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <>
                      <tr key={row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                        style={{ cursor: 'pointer' }}>
                        <td className="date-cell" style={{ whiteSpace: 'nowrap' }}>{fmtDT(row.ts)}</td>
                        <td style={{ fontSize: '.82rem', fontWeight: 600 }}>{row.actor_name || '—'}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: '#94a3b8' }}>{row.ip || '—'}</td>
                        <td>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', padding: '2px 7px', borderRadius: 6, fontWeight: 700, background: actionColor(row.action) + '22', color: actionColor(row.action) }}>
                            {row.action}
                          </span>
                        </td>
                        <td style={{ fontSize: '.82rem', color: '#475569' }}>{row.target_label || row.target_type || '—'}</td>
                        <td style={{ fontSize: '.78rem', color: '#64748b', maxWidth: 220 }}>
                          {row.detail ? <span style={{ color: '#2563eb', textDecoration: 'underline dotted' }}>View detail…</span> : ''}
                        </td>
                      </tr>
                      {expanded === row.id && row.detail && (
                        <tr key={`${row.id}-exp`}>
                          <td colSpan={6} style={{ background: '#f8fafc', padding: '8px 14px' }}>
                            <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: '.76rem', color: '#334155', whiteSpace: 'pre-wrap' }}>{fmtDetail(row.detail)}</pre>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', fontSize: '.82rem', borderTop: '1px solid var(--line)' }}>
              <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ color: '#475569' }}>{page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total} entries</span>
              <button className="btn btn-sm" style={{ background: 'var(--bg)', color: 'var(--steel)', border: '1px solid var(--line)' }} disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
          {rows.length > 0 && <div style={{ padding: '6px 14px', fontSize: '.72rem', color: '#94a3b8', borderTop: '1px solid var(--line)' }}>Click a detail cell to expand it</div>}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// SYSTEM TAB
// ══════════════════════════════════════════════════════════════════

function SystemTab() {
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
  const [cBusy, setCBusy] = useState(false)
  const [cErr, setCErr] = useState('')
  const [cMsg, setCMsg] = useState('')
  const loadCentral = useCallback(async () => {
    try { const r = await apiFetch('/api/central/status'); if (r.ok) setCentral(await r.json()) } catch { /* ignore */ }
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
  async function centralDisconnect() {
    if (!window.confirm('Disconnect this facility from HQ? It will stop syncing until reconnected.')) return
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
    if (!window.confirm('Restart the server? All active sessions will briefly disconnect.')) return
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
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Central / HQ Connection</span></div>
          {central?.connected && !cBusy && <button className="btn btn-sm" onClick={centralCheckin}>Check in now</button>}
        </div>
        <div className="section-body">
          <p style={{ fontSize: '.84rem', color: '#475569', marginBottom: 14 }}>
            Link this facility to your central OpsPoint (HQ) server for off-site backup and org-wide reporting. The facility keeps running normally if HQ is unreachable.
          </p>
          {cErr && <div className="auth-error" style={{ marginBottom: 12 }}>{cErr}</div>}
          {cMsg && <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: '.82rem', marginBottom: 12, background: '#dcfce7', color: '#15803d' }}>{cMsg}</div>}

          {central?.connected ? (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontWeight: 800, color: '#065f46' }}>Connected to HQ</span>
                <Chip2 bg={central.last_status === 'connected' ? '#dcfce7' : '#fee2e2'} fg={central.last_status === 'connected' ? '#15803d' : '#991b1b'}>{central.last_status || 'unknown'}</Chip2>
              </div>
              <div style={{ fontSize: '.82rem', color: '#334155', lineHeight: 1.9 }}>
                <div><strong>HQ URL:</strong> <span style={{ fontFamily: 'var(--mono)' }}>{central.url}</span></div>
                <div><strong>Facility ID:</strong> <span style={{ fontFamily: 'var(--mono)' }}>{central.facility_id}</span></div>
                <div><strong>Key:</strong> <span style={{ fontFamily: 'var(--mono)' }}>{central.key_prefix}…</span></div>
                <div><strong>Last check-in:</strong> {central.last_checkin || 'never'}</div>
                {central.insecure && <div style={{ color: '#b45309' }}>⚠ TLS verification disabled for HQ</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-sm" onClick={centralCheckin} disabled={cBusy}>Check in now</button>
                <button className="btn btn-sm btn-red" onClick={centralDisconnect} disabled={cBusy}>Disconnect</button>
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 460 }}>
              <div className="field"><label>HQ server URL</label>
                <input placeholder="https://hq.example.org:4000" value={cForm.url} onChange={e => setCForm(f => ({ ...f, url: e.target.value }))} /></div>
              <div className="field"><label>Facility ID</label>
                <input placeholder="from the HQ console" value={cForm.facility_id} onChange={e => setCForm(f => ({ ...f, facility_id: e.target.value }))} /></div>
              <div className="field"><label>Enrollment key</label>
                <input type="password" placeholder="one-time key from HQ" value={cForm.api_key} onChange={e => setCForm(f => ({ ...f, api_key: e.target.value }))} /></div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.82rem', color: '#475569', margin: '4px 0 12px' }}>
                <input type="checkbox" checked={cForm.insecure} onChange={e => setCForm(f => ({ ...f, insecure: e.target.checked }))} style={{ width: 'auto' }} />
                Allow self-signed TLS cert on HQ (trusted networks only)
              </label>
              <button className="btn btn-sm btn-primary" onClick={centralConnect} disabled={cBusy}>{cBusy ? 'Connecting…' : 'Connect to HQ'}</button>
            </div>
          )}
        </div>
      </div>

      {/* Software Updates */}
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Software Updates</span></div>
          {!busy && <button className="btn btn-sm" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check for Updates'}</button>}
        </div>
        <div className="section-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.82rem', color: '#64748b' }}>Current version</span>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>v{cur}</span>
            {upd?.lastChecked && <span style={{ fontSize: '.72rem', color: '#94a3b8' }}>· checked {new Date(upd.lastChecked).toLocaleString()}</span>}
          </div>

          {checkErr && <div className="auth-error" style={{ marginBottom: 12 }}>{checkErr}</div>}

          {progress && progress.phase !== 'idle' ? (
            <div style={{ marginBottom: 4 }}>
              {progress.phase === 'error' ? (
                <div style={{ padding: '10px 13px', borderRadius: 8, background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '.83rem' }}>
                  <strong>Update failed.</strong> {progress.error}
                  <div style={{ marginTop: 8 }}><button className="btn btn-sm" onClick={() => setProgress(null)}>Dismiss</button></div>
                </div>
              ) : (
                <div style={{ padding: '12px 14px', borderRadius: 8, background: '#f0f9ff', border: '1px solid #bae6fd' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', color: '#075985', marginBottom: 7 }}>
                    <span>{progress.message || progress.phase}</span><span>{progress.pct || 0}%</span>
                  </div>
                  <div style={{ height: 7, background: '#e0f2fe', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (progress.pct || 0) + '%', background: '#0ea5e9', transition: 'width .4s' }} />
                  </div>
                  {busy && <div style={{ fontSize: '.72rem', color: '#94a3b8', marginTop: 7 }}>Do not close this window. The server will restart automatically.</div>}
                </div>
              )}
            </div>
          ) : available ? (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 800, color: '#065f46' }}>Update available — v{upd.latest}</span>
                {upd.mandatory && <Chip2 bg="#fee2e2" fg="#991b1b">Required</Chip2>}
              </div>
              {Array.isArray(upd.changelog) && upd.changelog.length > 0 && (
                <ul style={{ margin: '6px 0 10px', paddingLeft: 18, fontSize: '.82rem', color: '#334155' }}>
                  {upd.changelog.slice(0, 8).map((c, i) => <li key={i} style={{ marginBottom: 2 }}>{c}</li>)}
                </ul>
              )}
              {!confirming
                ? <button className="btn btn-sm btn-primary" onClick={() => setConfirming(true)}>Download &amp; Install</button>
                : (
                  <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: '.83rem', color: '#334155', marginBottom: 10 }}>
                      This downloads and verifies v{upd.latest}, backs up the database, then <strong>restarts the server</strong> — everyone is disconnected for ~30&nbsp;seconds. Make sure no one is mid-report. Continue?
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm btn-primary" onClick={install}>Yes, install v{upd.latest}</button>
                      <button className="btn btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
                    </div>
                  </div>
                )}
            </div>
          ) : (
            upd && <div style={{ fontSize: '.84rem', color: '#15803d' }}>✓ You’re on the latest version.</div>
          )}
        </div>
      </div>

      {/* Server Control */}
      <div className="section">
        <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Server Control</span></div></div>
        <div className="section-body">
          <p style={{ fontSize: '.84rem', color: '#475569', marginBottom: 14 }}>
            Restart the OpsPoint server process. The server will shut down, respawn automatically, and all connected clients will reconnect within a few seconds.
          </p>
          {msg && (
            <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: '.82rem', marginBottom: 12, background: msg.startsWith('✓') ? '#dcfce7' : '#fef9c3', color: msg.startsWith('✓') ? '#15803d' : '#854d0e' }}>
              {msg}
            </div>
          )}
          <button className="btn btn-sm btn-red" onClick={restart} disabled={restarting || busy}>⚠ Restart Server</button>
        </div>
      </div>

      {/* Version Info */}
      <div className="section">
        <div className="section-head"><div className="sh-left"><span className="sh-dot" /><span>Version Info</span></div></div>
        <div className="section-body">
          <table style={{ fontSize: '.84rem', borderCollapse: 'collapse' }}>
            <tbody>
              {[['App', 'OpsPoint'], ['Version', 'v' + cur], ['Server', window.location.host], ['Protocol', window.location.protocol === 'https:' ? 'HTTPS (TLS)' : 'HTTP']].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '4px 16px 4px 0', fontWeight: 700, color: '#475569' }}>{k}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '.82rem' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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

function Chip2({ bg, fg, children }) {
  return <span style={{ background: bg, color: fg, fontSize: '.68rem', fontWeight: 800, padding: '1px 7px', borderRadius: 999 }}>{children}</span>
}
