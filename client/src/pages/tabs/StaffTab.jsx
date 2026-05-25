import { useState, useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'

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
  const categories = data?.staff_categories || ['Director', 'Case Manager', 'Monitor', 'Other']

  const [filterCat, setFilterCat] = useState('All')
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

  const catCounts = useMemo(() => {
    const m = { All: staff.length }
    categories.forEach(c => { m[c] = staff.filter(s => s.category === c).length })
    return m
  }, [staff, categories])

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div className="sh-left"><span className="sh-dot" /><span>Staff Directory</span></div>
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={openAdd}>+  Add Staff Member</button>
          )}
        </div>

        {/* Category filter */}
        <div style={{ display: 'flex', gap: 7, padding: '10px 14px', flexWrap: 'wrap', borderBottom: '1px solid var(--line)' }}>
          {['All', ...categories].map(cat => (
            <button key={cat} onClick={() => setFilterCat(cat)}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: '.76rem', fontWeight: 700,
                border: '1.5px solid', cursor: 'pointer', transition: 'all .15s',
                borderColor: filterCat === cat ? 'var(--crimson)' : 'var(--line)',
                background: filterCat === cat ? 'var(--crimson)' : 'transparent',
                color: filterCat === cat ? '#fff' : 'var(--steel)',
              }}>
              {cat} {catCounts[cat] != null ? `(${catCounts[cat]})` : ''}
            </button>
          ))}
        </div>

        <div className="section-body" style={{ padding: 0 }}>
          {filtered.length === 0 ? (
            <div className="empty-state">No staff members in this category.</div>
          ) : (
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Phone</th>
                    <th>Alt Phone</th>
                    <th>Notes</th>
                    {canEdit && <th className="tc">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => (
                    <tr key={s.id}>
                      <td className="name-cell">{s.name}</td>
                      <td>
                        <span style={{
                          fontSize: '.73rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                          background: '#e2e8f0', color: '#475569'
                        }}>{s.category || '—'}</span>
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '.8rem' }}>{formatPhone(s.phone) || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '.8rem' }}>{formatPhone(s.phone2) || '—'}</td>
                      <td style={{ fontSize: '.84rem', color: '#475569', maxWidth: 280 }}>{s.notes || ''}</td>
                      {canEdit && (
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)', marginRight: 5 }}
                            onClick={() => openEdit(s)}>✎ Edit</button>
                          <button className="btn-danger-sm" onClick={() => del(s)}>Remove</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
