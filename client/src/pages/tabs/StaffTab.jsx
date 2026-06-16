import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { UserPlus, MoreHorizontal, Users, UserCog, ClipboardList } from 'lucide-react'
import {
  Avatar, Badge, Breadcrumb, BreadcrumbItem, Button, Card,
  Dropdown, DropdownItem, Label, Modal, ModalHeader, ModalBody, ModalFooter,
  Select, Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
  TextInput, Textarea, Alert,
} from 'flowbite-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { initials } from '../../utils/ui.js'

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
  const { globalSearch = '' } = useOutletContext() || {}

  const staff = data?.staff || []
  const categories = data?.staff_categories || ['Director', 'Case Manager', 'Program Assistant', 'Other']

  const [filterCat, setFilterCat] = useState('All')
  const [modal, setModal] = useState(null) // null | 'add' | staffObject
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const gq = globalSearch.toLowerCase().trim()
    return staff.filter(s => filterCat === 'All' || s.category === filterCat)
      .filter(s => !gq || s.name.toLowerCase().includes(gq) || (s.category || '').toLowerCase().includes(gq) || (s.phone || '').includes(gq))
      .slice().sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name))
  }, [staff, filterCat, globalSearch])

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
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>People</BreadcrumbItem>
            <BreadcrumbItem>Staff</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Staff</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {staff.length} team member{staff.length === 1 ? '' : 's'}
          </p>
        </div>
        {canEdit && (
          <Button onClick={openAdd}><UserPlus className="w-4 h-4 mr-2" /> Add Staff</Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">Team Members</h3>
              <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{staff.length}</p>
              <p className="mt-2 text-xs text-gray-400">across {categories.length} categories</p>
            </div>
            <div className="flex items-center justify-center rounded-lg w-11 h-11 bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300"><Users className="w-5 h-5" /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">Case Managers</h3>
              <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{caseMgrs}</p>
              <p className="mt-2 text-xs text-gray-400">active</p>
            </div>
            <div className="flex items-center justify-center rounded-lg w-11 h-11 bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300"><UserCog className="w-5 h-5" /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">Program Assistants</h3>
              <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{pas}</p>
              <p className="mt-2 text-xs text-gray-400">active</p>
            </div>
            <div className="flex items-center justify-center rounded-lg w-11 h-11 bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300"><ClipboardList className="w-5 h-5" /></div>
          </div>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {filters.map(f => (
            <Button key={f} size="xs" color={f === filterCat ? 'default' : 'light'} onClick={() => setFilterCat(f)}>{f}</Button>
          ))}
        </div>
        <span className="text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {/* Table */}
      <Table hoverable>
        <TableHead>
          <TableRow>
            <TableHeadCell>Name</TableHeadCell>
            <TableHeadCell>Role</TableHeadCell>
            <TableHeadCell>Phone</TableHeadCell>
            <TableHeadCell>Alt Phone</TableHeadCell>
            <TableHeadCell>Notes</TableHeadCell>
            <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
          </TableRow>
        </TableHead>
        <TableBody className="divide-y">
          {filtered.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-sm text-center text-gray-400">No staff members in this category.</TableCell></TableRow>
          ) : filtered.map(s => (
            <TableRow key={s.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar placeholderInitials={initials(s.name)} rounded size="sm" />
                  <span className="font-semibold text-gray-900 whitespace-nowrap dark:text-white">{s.name}</span>
                </div>
              </TableCell>
              <TableCell>{s.category || '—'}</TableCell>
              <TableCell className="font-mono">{formatPhone(s.phone) || '—'}</TableCell>
              <TableCell className="font-mono">{formatPhone(s.phone2) || '—'}</TableCell>
              <TableCell className="text-gray-500 dark:text-gray-400">{s.notes || '—'}</TableCell>
              <TableCell className="text-right">
                {canEdit && (
                  <Dropdown arrowIcon={false} inline label={<MoreHorizontal className="w-4 h-4 text-gray-400" />}>
                    <DropdownItem onClick={() => openEdit(s)}>Edit</DropdownItem>
                    <DropdownItem className="text-red-600" onClick={() => del(s)}>Remove</DropdownItem>
                  </Dropdown>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Add/Edit Modal */}
      <Modal show={!!modal} onClose={() => setModal(null)}>
        <ModalHeader>{modal === 'add' ? 'Add Staff Member' : `Edit — ${modal?.name}`}</ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            {error && <Alert color="failure">{error}</Alert>}
            <div>
              <Label htmlFor="staff-cat" className="block mb-1">Category</Label>
              <Select id="staff-cat" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="staff-name" className="block mb-1">Name</Label>
              <TextInput id="staff-name" value={form.name} placeholder="Full name"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="staff-phone" className="block mb-1">Phone</Label>
              <TextInput id="staff-phone" value={form.phone} placeholder="(555) 555-5555"
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="staff-phone2" className="block mb-1">Alt Phone</Label>
              <TextInput id="staff-phone2" value={form.phone2} placeholder="Optional"
                onChange={e => setForm(f => ({ ...f, phone2: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="staff-notes" className="block mb-1">Notes</Label>
              <Textarea id="staff-notes" value={form.notes} rows={3} placeholder="Optional notes…"
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
        </ModalBody>
        <ModalFooter className="justify-end">
          <Button color="light" onClick={() => setModal(null)}>Cancel</Button>
          <Button onClick={submit} isProcessing={saving} disabled={saving}>Save</Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
