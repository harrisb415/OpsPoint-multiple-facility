import { useState, useMemo } from 'react'
import { UserPlus, MoreHorizontal, Users, UserCog, ClipboardList } from 'lucide-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { Header, Kpi, KpiRow, Toolbar, Table, NameCell, TextCell, MonoCell, MutedCell, ActionsCell, rowCls } from '../../components/console.jsx'

function formatPhone(raw) {
  if (!raw) return ''
  const d = String(raw).replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

const BLANK = { category: '', name: '', phone: '', phone2: '', notes: '' }

export default function StaffTab() {
  const { data } = useData()
  const { hasPerm } = usePermission()
  const canEdit = hasPerm('staff.edit')

  const staff = data?.staff || []
  const categories = data?.staff_categories || ['Director', 'Case Manager', 'Program Assistant', 'Other']

  const [filterCat, setFilterCat] = useState('All')
  const [menuId, setMenuId] = useState(null)
  const [modal, setModal] = useState(null) // null | 'add' | staffObject
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() =>
    staff.filter(s => filterCat === 'All' || s.category === filterCat)
      .slice().sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name)),
    [staff, filterCat]
  )

  function openAdd() {
    setForm({ ...BLANK, category: filterCat !== 'All' ? filterCat : (categories[0] || '') })
    setError('')
    setModal('add')
  }
  function openEdit(s) {
    setForm({ category: s.category || '', name: s.name || '', phone: s.phone || '', phone2: s.phone2 || '', notes: s.notes || '' })
    setError('')
    setModal(s)
  }

  async function submit() {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      const isNew = modal === 'add'
      const url = isNew ? '/api/staff' : `/api/staff/${modal.id}`
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ category: form.category, name: form.name.trim(), phone: form.phone, phone2: form.phone2, notes: form.notes }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Save failed'); return }
      setModal(null)
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  async function del(s) {
    if (!window.confirm(`Remove ${s.name} from the directory?`)) return
    await fetch(`/api/staff/${s.id}`, { method: 'DELETE', credentials: 'include' })
  }

  const filters = ['All', ...categories]
  const caseMgrs = staff.filter(s => s.category === 'Case Manager').length
  const pas      = staff.filter(s => s.category === 'Program Assistant').length

  return (
    <div>
      <Header
        crumb={['People', 'Staff']}
        title="Staff"
        sub={`${staff.length} team member${staff.length === 1 ? '' : 's'}`}
        actions={canEdit ? [{ Icon: UserPlus, label: 'Add Staff', primary: true, onClick: openAdd }] : []}
      />

      <KpiRow>
        <Kpi label="Team Members" value={staff.length} sub={`across ${categories.length} categories`} Icon={Users} accent="primary" />
        <Kpi label="Case Managers" value={caseMgrs} sub="active" Icon={UserCog} accent="sky" />
        <Kpi label="Program Assistants" value={pas} sub="active" Icon={ClipboardList} accent="green" />
      </KpiRow>

      <Toolbar
        filters={filters}
        active={Math.max(0, filters.indexOf(filterCat))}
        onFilter={i => setFilterCat(filters[i])}
        count={filtered.length}
      />

      <Table headers={[{ label: 'Name' }, { label: 'Role' }, { label: 'Phone' }, { label: 'Alt Phone' }, { label: 'Notes' }, { label: '', right: true }]}>
        {filtered.length === 0 ? (
          <tr><td colSpan={6} className="p-8 text-sm text-center text-gray-400">No staff members in this category.</td></tr>
        ) : filtered.map((s, i) => (
          <tr key={s.id} className={rowCls(i)}>
            <NameCell name={s.name} />
            <TextCell>{s.category || '—'}</TextCell>
            <MonoCell>{formatPhone(s.phone) || '—'}</MonoCell>
            <MonoCell>{formatPhone(s.phone2) || '—'}</MonoCell>
            <MutedCell>{s.notes || '—'}</MutedCell>
            <ActionsCell>
              {canEdit && (
                <div className="relative inline-block text-left">
                  <button onClick={() => setMenuId(menuId === s.id ? null : s.id)} className="p-1.5 text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {menuId === s.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuId(null)} />
                      <div className="absolute right-0 z-50 w-36 p-1 mt-1 text-left bg-white border border-gray-200 shadow-lg rounded-lg dark:bg-gray-800 dark:border-gray-700">
                        <button onClick={() => { setMenuId(null); openEdit(s) }} className="block w-full px-3 py-2 text-sm text-left text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">Edit</button>
                        <button onClick={() => { setMenuId(null); del(s) }} className="block w-full px-3 py-2 text-sm text-left text-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30">Remove</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </ActionsCell>
          </tr>
        ))}
      </Table>

      {/* Add/Edit Modal */}
      {modal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-head">
              <h2>{modal === 'add' ? 'Add Staff Member' : `Edit — ${modal.name}`}</h2>
              <button className="xbtn" onClick={() => setModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              {error && <div className="auth-error">{error}</div>}
              <div className="field"><label>Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>Name</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" /></div>
              <div className="field"><label>Phone</label>
                <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 555-5555" /></div>
              <div className="field"><label>Alt Phone</label>
                <input type="text" value={form.phone2} onChange={e => setForm(f => ({ ...f, phone2: e.target.value }))} placeholder="Optional" /></div>
              <div className="field"><label>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} style={{ resize: 'vertical' }} placeholder="Optional notes…" /></div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
