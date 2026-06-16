import { useState, useMemo, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Download, UserPlus, MoreHorizontal, Users, Home, CalendarDays, Search, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, Card, Dropdown, DropdownItem,
  TextInput,
  Select, Textarea, Modal, ModalHeader, ModalBody, ModalFooter, Alert,
} from 'flowbite-react'
import { Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from '../../components/table'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import ClientReportModal from '../../components/ClientReportModal.jsx'
import { initials } from '../../utils/ui.js'
import { Field, ColoredAvatar } from '../../components/ui.jsx'

// Prototype-style status badge class strings (rounded-md pill, not rounded-full)
const BADGE_CLS = {
  green:  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  blue:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  red:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  gray:   'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

function DeltaRow({ delta, label }) {
  if (!delta) return (
    <div className="pt-3 mt-4 border-t border-gray-100 dark:border-gray-700">
      <span className="inline-flex items-center text-sm font-medium text-gray-400">
        <Minus className="w-4 h-4 mr-1" />{label}
      </span>
    </div>
  )
  const up = delta > 0
  return (
    <div className="pt-3 mt-4 border-t border-gray-100 dark:border-gray-700">
      <span className={`inline-flex items-center text-sm font-medium ${up ? 'text-green-500' : 'text-red-500'}`}>
        {up ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
        {up ? '+' : ''}{delta}
        <span className="ml-1.5 font-normal text-gray-400">{label}</span>
      </span>
    </div>
  )
}

const PAGE_SIZE = 50

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function formatPhone(raw) {
  if (!raw) return ''
  const d = String(raw).replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

function todayStr() { return new Date().toLocaleDateString('en-CA') }

const BLANK_FORM = {
  room: '', name: '', case_manager: '', phone: '', intake_date: '', discharge_date: '',
  referral_source: '', program_track: '', intake_notes: '', emergency_contacts: [],
}
const BLANK_ADD  = {
  room: '', name: '', case_manager: '', phone: '', intake_date: todayStr(),
  referral_source: '', program_track: '', intake_notes: '', emergency_contacts: [],
}

function blankAdd(vacantRooms) {
  return { ...BLANK_ADD, room: vacantRooms[0] || '' }
}


const BLANK_DISCHARGE = {
  discharge_date: todayStr(),
  reason: 'graduate',
  narrative: '', aftercare_plan: '',
  referrals_made: [],
}

export default function ClientsTab() {
  const { data, openProfile } = useData()
  const { hasPerm } = usePermission()
  const canEdit = hasPerm('residents.edit')
  const { globalSearch = '' } = useOutletContext() || {}

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(0)
  const [showDischarged, setShowDischarged] = useState(false)
  const [page, setPage] = useState(0)
  const [sortKey, setSortKey] = useState('room')
  const [sortDir, setSortDir] = useState('asc')
  const [reportModal, setReportModal] = useState(false)

  // Edit modal
  const [editModal, setEditModal] = useState(null) // null | client object
  const [editForm, setEditForm] = useState(BLANK_FORM)
  const [editPhoto, setEditPhoto] = useState(null) // base64 for pending new photo
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const photoRef = useRef(null)

  // Add client modal
  const [addModal, setAddModal]   = useState(false)
  const [addForm, setAddForm]     = useState(BLANK_ADD)
  const [addError, setAddError]   = useState('')
  const [addSaving, setAddSaving] = useState(false)

  // Photo popout
  const [photoPopout, setPhotoPopout] = useState(null) // null | { src, name }

  // Discharge modal (creates a discharge_record + flips client to inactive)
  const [dischargeModal, setDischargeModal] = useState(null) // null | client
  const [dischargeForm, setDischargeForm] = useState(BLANK_DISCHARGE)
  const [dischargeErr, setDischargeErr]   = useState('')
  const [dischargeSaving, setDischargeSaving] = useState(false)

  // Reactivate modal
  const [reactivateModal, setReactivateModal] = useState(null) // null | client
  const [reactRoom, setReactRoom]             = useState('')
  const [reactSaving, setReactSaving]         = useState(false)

  const clients = data?.clients || []

  function handleSort(col) {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('asc') }
    setPage(0)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    const list = clients
      .filter(c => {
        if (c.is_special) return true
        if (c.name === 'VACANT') return true
        return showDischarged || c.is_active
      })
      .filter(c => {
        if (!q) return true
        return String(c.room).toLowerCase().includes(q)
          || c.name.toLowerCase().includes(q)
          || (c.special_label || '').toLowerCase().includes(q)
          || (c.case_manager || '').toLowerCase().includes(q)
          || (c.phone || '').toLowerCase().includes(q)
      })
      .slice()

    list.sort((a, b) => {
      let av, bv
      switch (sortKey) {
        case 'name':
          av = (a.is_special ? (a.special_label || a.name) : (a.name || '')).toLowerCase()
          bv = (b.is_special ? (b.special_label || b.name) : (b.name || '')).toLowerCase()
          break
        case 'case_manager':
          av = (a.case_manager || '').toLowerCase()
          bv = (b.case_manager || '').toLowerCase()
          break
        case 'phone':
          av = (a.phone || '').toLowerCase()
          bv = (b.phone || '').toLowerCase()
          break
        case 'intake':
          av = a.intake_date || ''
          bv = b.intake_date || ''
          break
        case 'discharge':
          av = a.discharge_date || ''
          bv = b.discharge_date || ''
          break
        case 'status': {
          const rank = c => c.is_special ? 2 : (c.name === 'VACANT' ? 1 : (c.is_active ? 0 : 3))
          av = rank(a); bv = rank(b)
          break
        }
        default: // 'room'
          av = parseInt(a.room) || 0
          bv = parseInt(b.room) || 0
      }
      const cmp = typeof av === 'number' ? av - bv : (av < bv ? -1 : av > bv ? 1 : 0)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [clients, search, showDischarged, sortKey, sortDir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  async function saveAdd() {
    if (!addForm.name.trim()) { setAddError('Name is required.'); return }
    if (!addForm.room) { setAddError('Select a vacant room.'); return }
    setAddSaving(true); setAddError('')
    try {
      const r = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room: addForm.room.trim(),
          name: addForm.name.trim(),
          case_manager: addForm.case_manager,
          phone: addForm.phone,
          intake_date: addForm.intake_date || null,
          referral_source:    addForm.referral_source || '',
          program_track:      addForm.program_track   || '',
          emergency_contacts: Array.isArray(addForm.emergency_contacts) ? addForm.emergency_contacts : [],
          intake_notes:       addForm.intake_notes    || '',
        }),
      })
      const j = await r.json()
      if (!r.ok) { setAddError(j.error || 'Save failed'); return }
      setAddModal(false); setAddForm(BLANK_ADD)
    } catch { setAddError('Network error') }
    finally { setAddSaving(false) }
  }

  function openEdit(c) {
    setEditForm({
      room: c.room || '', name: c.name || '',
      case_manager: c.case_manager || '', phone: c.phone || '',
      intake_date: c.intake_date || '', discharge_date: c.discharge_date || '',
      referral_source:    c.referral_source || '',
      program_track:      c.program_track   || '',
      emergency_contacts: Array.isArray(c.emergency_contacts) ? c.emergency_contacts : [],
      intake_notes:       c.intake_notes    || '',
    })
    setEditPhoto(null)
    setEditError('')
    setEditModal(c)
  }

  async function saveEdit() {
    if (!editForm.name.trim()) { setEditError('Name is required.'); return }
    setEditSaving(true)
    setEditError('')
    try {
      const r = await fetch(`/api/clients/${editModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room: editForm.room,
          name: editForm.name.trim(),
          case_manager: editForm.case_manager,
          phone: editForm.phone,
          intake_date: editForm.intake_date || null,
          discharge_date: editForm.discharge_date || null,
          referral_source:    editForm.referral_source || '',
          program_track:      editForm.program_track   || '',
          emergency_contacts: Array.isArray(editForm.emergency_contacts) ? editForm.emergency_contacts : [],
          intake_notes:       editForm.intake_notes    || '',
          ...(editPhoto === 'REMOVE' ? { photo: null } : editPhoto ? { photo: editPhoto } : {}),
        }),
      })
      const j = await r.json()
      if (!r.ok) { setEditError(j.error || 'Save failed'); return }
      setEditModal(null)
    } catch { setEditError('Network error') }
    finally { setEditSaving(false) }
  }

  function openDischarge(c) {
    setDischargeForm({
      ...BLANK_DISCHARGE,
      discharge_date: todayStr(),
    })
    setDischargeErr('')
    setDischargeModal(c)
  }

  async function discharge() {
    if (!dischargeModal) return
    if (!dischargeForm.reason) { setDischargeErr('Reason required'); return }
    if (!dischargeForm.discharge_date) { setDischargeErr('Discharge date required'); return }
    setDischargeSaving(true); setDischargeErr('')
    try {
      const r = await fetch('/api/discharge-records', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          client_id: dischargeModal.id,
          client_name: dischargeModal.name,
          room: dischargeModal.room,
          program_track: dischargeModal.program_track || '',
          intake_date: dischargeModal.intake_date || null,
          discharge_date: dischargeForm.discharge_date,
          reason: dischargeForm.reason,
          narrative: dischargeForm.narrative || '',
          aftercare_plan: dischargeForm.aftercare_plan || '',
          referrals_made: dischargeForm.referrals_made || [],
        }),
      })
      const j = await r.json()
      if (!r.ok) { setDischargeErr(j.error || 'Discharge failed'); return }
      setDischargeModal(null); setDischargeForm(BLANK_DISCHARGE)
    } catch { setDischargeErr('Network error') }
    finally { setDischargeSaving(false) }
  }

  function addEmergencyContact(setForm, form) {
    const ec = Array.isArray(form.emergency_contacts) ? form.emergency_contacts : []
    setForm({ ...form, emergency_contacts: [...ec, { name:'', relationship:'', phone:'' }] })
  }
  function updateEmergencyContact(setForm, form, idx, key, val) {
    const ec = [...(form.emergency_contacts || [])]
    ec[idx] = { ...ec[idx], [key]: val }
    setForm({ ...form, emergency_contacts: ec })
  }
  function removeEmergencyContact(setForm, form, idx) {
    const ec = [...(form.emergency_contacts || [])]
    ec.splice(idx, 1)
    setForm({ ...form, emergency_contacts: ec })
  }

  function addReferral() {
    setDischargeForm(f => ({
      ...f, referrals_made: [...(f.referrals_made||[]), { agency:'', contact:'', date:todayStr(), type:'' }]
    }))
  }
  function updateReferral(idx, key, val) {
    setDischargeForm(f => {
      const rs = [...(f.referrals_made||[])]
      rs[idx] = { ...rs[idx], [key]: val }
      return { ...f, referrals_made: rs }
    })
  }
  function removeReferral(idx) {
    setDischargeForm(f => {
      const rs = [...(f.referrals_made||[])]
      rs.splice(idx, 1)
      return { ...f, referrals_made: rs }
    })
  }

  const programTracks = data?.program_tracks || []

  const vacantRooms = useMemo(
    () => clients.filter(c => c.is_active && c.name === 'VACANT').map(c => c.room).sort((a, b) => (parseInt(a)||0)-(parseInt(b)||0)),
    [clients]
  )

  function openReactivate(c) {
    setReactRoom(vacantRooms[0] || c.room || '')
    setReactivateModal(c)
  }

  async function confirmReactivate() {
    if (!reactivateModal) return
    setReactSaving(true)
    const targetRoom = String(reactRoom || reactivateModal.room)
    try {
      const r = await fetch(`/api/clients/${reactivateModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room: targetRoom,
          is_active: true,
          discharge_date: null,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        console.error('Reactivate failed:', j.error || r.status)
      }
    } catch (e) {
      console.error('Reactivate network error:', e)
    } finally {
      setReactivateModal(null)
      setReactSaving(false)
    }
  }

  const active = clients.filter(c => !c.is_special && c.is_active && c.name !== 'VACANT').length
  const vacant = clients.filter(c => !c.is_special && c.is_active && c.name === 'VACANT').length
  const special = clients.filter(c => c.is_special).length
  const discharged = clients.filter(c => !c.is_special && !c.is_active).length

  // ── Console table data (active residents; shift status from active report) ──
  const STATUS = { building:{tone:'green',label:'In Building'}, work:{tone:'blue',label:'At Work'}, pass:{tone:'yellow',label:'On Pass'}, hospital:{tone:'red',label:'Hospital'}, bhc:{tone:'purple',label:'BHC'}, efc:{tone:'purple',label:'EFC'}, out:{tone:'orange',label:'Out'} }
  const STATUS_KEYS = [null, 'building', 'work', 'pass', 'hospital']
  const activeReport = data?.reports?.find(r => r.id === data?.active_report_id)
  const statuses = activeReport?.statuses || {}
  const residents = useMemo(() => clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT'), [clients])
  const rows = useMemo(() => {
    const q = search.toLowerCase().trim()
    const gq = globalSearch.toLowerCase().trim()
    const key = STATUS_KEYS[statusFilter]
    const match = (c, s) => !s || c.name.toLowerCase().includes(s) || String(c.room).includes(s) || (c.case_manager || '').toLowerCase().includes(s)
    return residents
      .filter(c => !key || (statuses[c.id] || 'building') === key)
      .filter(c => match(c, q) && match(c, gq))
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0))
  }, [residents, statuses, search, statusFilter, globalSearch])  // eslint-disable-line react-hooks/exhaustive-deps
  const daysSince = d => { if (!d) return null; return Math.max(0, Math.floor((Date.now() - new Date(d + 'T12:00:00').getTime()) / 86400000)) }
  const onSite = residents.filter(c => (statuses[c.id] || 'building') === 'building').length
  const pct = residents.length ? Math.round(onSite / residents.length * 100) : 0
  const newIntakes = residents.filter(c => { const dd = daysSince(c.intake_date); return dd != null && dd <= 7 }).length
  const tenures = residents.map(c => daysSince(c.intake_date)).filter(v => v != null)
  const avgTenure = tenures.length ? Math.round(tenures.reduce((a, b) => a + b, 0) / tenures.length) : 0

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>People</BreadcrumbItem>
            <BreadcrumbItem>Clients</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Clients</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{active} residents · {data?.facility_name || 'Facility'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button color="light" onClick={() => setReportModal(true)}><Download className="w-4 h-4 mr-2" /> Export</Button>
          {canEdit && (
            <Button onClick={() => { setAddForm(blankAdd(vacantRooms)); setAddError(''); setAddModal(true) }}>
              <UserPlus className="w-4 h-4 mr-2" /> New Intake
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Residents', value: active, sub: `${vacant} beds open`, delta: newIntakes, dl: 'new this week', Icon: Users, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
          { label: 'On Site', value: onSite, sub: `${pct}% of census`, delta: 0, dl: 'this shift', Icon: Home, tint: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300' },
          { label: 'New Intakes', value: newIntakes, sub: 'last 7 days', delta: newIntakes, dl: 'this week', Icon: UserPlus, tint: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300' },
          { label: 'Avg Tenure', value: avgTenure, sub: 'days in program', delta: 0, dl: 'this session', Icon: CalendarDays, tint: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-300' },
        ].map(k => (
          <Card key={k.label}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">{k.label}</h3>
                <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{k.value}</p>
                <p className="mt-2 text-xs text-gray-400">{k.sub}</p>
              </div>
              <div className={`flex items-center justify-center rounded-lg w-11 h-11 ${k.tint}`}><k.Icon className="w-5 h-5" /></div>
            </div>
            <DeltaRow delta={k.delta} label={k.dl} />
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {['All', 'In Building', 'At Work', 'On Pass', 'Hospital'].map((f, i) => (
            <button
              key={f}
              onClick={() => setStatusFilter(i)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                i === statusFilter
                  ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-800'
                  : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700'
              }`}
            >{f}</button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{rows.length} records</span>
          <TextInput sizing="sm" icon={Search} placeholder="Filter…" value={search} onChange={e => setSearch(e.target.value)} className="w-full sm:w-56" />
        </div>
      </div>

      {/* Table */}
      <Table hoverable>
        <TableHead>
          <TableRow>
            <TableHeadCell>Resident</TableHeadCell>
            <TableHeadCell>Status</TableHeadCell>
            <TableHeadCell>Phase</TableHeadCell>
            <TableHeadCell>Sobriety</TableHeadCell>
            <TableHeadCell>Case Manager</TableHeadCell>
            <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
          </TableRow>
        </TableHead>
        <TableBody className="divide-y">
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-sm text-center text-gray-400">No residents found.</TableCell></TableRow>
          ) : rows.map(c => {
            const st = STATUS[statuses[c.id] || 'building'] || STATUS.building
            const days = daysSince(c.intake_date)
            return (
              <TableRow key={c.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <ColoredAvatar name={c.name} />
                    <div>
                      <button onClick={() => openProfile(c.id)} className="text-sm font-semibold text-left text-gray-900 dark:text-white hover:text-primary-700 hover:underline">{c.name}</button>
                      <p className="font-mono text-xs text-gray-400">Rm {c.room}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap ${BADGE_CLS[st.tone] || BADGE_CLS.gray}`}>{st.label}</span>
                </TableCell>
                <TableCell>{c.program_track || '—'}</TableCell>
                <TableCell className="text-gray-500 dark:text-gray-400">
                  {days != null ? <><span className="font-mono font-semibold text-gray-900 dark:text-white">{days}</span> <span className="text-xs text-gray-400">days</span></> : '—'}
                </TableCell>
                <TableCell className="text-gray-500 dark:text-gray-400">{c.case_manager || '—'}</TableCell>
                <TableCell className="text-right">
                  {canEdit && (
                    <Dropdown arrowIcon={false} inline label={<MoreHorizontal className="w-4 h-4 text-gray-400" />}>
                      <DropdownItem onClick={() => openEdit(c)}>Edit</DropdownItem>
                      <DropdownItem className="text-red-600" onClick={() => openDischarge(c)}>Discharge</DropdownItem>
                    </Dropdown>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* Edit Modal */}
      {editModal && (
        <Modal show size="xl" onClose={() => setEditModal(null)}>
          <ModalHeader>Edit Client — Rm. {editModal.room}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {editError && <Alert color="failure">{editError}</Alert>}
              <Field label="Photo">
                <div className="flex items-center gap-3">
                  {(editPhoto && editPhoto !== 'REMOVE')
                    ? <img src={editPhoto} alt="Client photo" className="object-cover w-16 h-16 border-2 border-gray-200 rounded-full shrink-0 dark:border-gray-600" />
                    : (editModal?.photo && editPhoto !== 'REMOVE')
                      ? <img src={editModal.photo} alt="Client photo" className="object-cover w-16 h-16 border-2 border-gray-200 rounded-full shrink-0 dark:border-gray-600" />
                      : <div className="flex items-center justify-center w-16 h-16 text-2xl bg-gray-200 rounded-full shrink-0 dark:bg-gray-700">👤</div>
                  }
                  <div className="flex flex-col gap-1.5">
                    <Button type="button" size="xs" color="light" onClick={() => photoRef.current?.click()}>
                      📷 {((editModal?.photo && editPhoto !== 'REMOVE') || (editPhoto && editPhoto !== 'REMOVE')) ? 'Change Photo' : 'Add Photo'}
                    </Button>
                    {((editPhoto && editPhoto !== 'REMOVE') || (editModal?.photo && editPhoto !== 'REMOVE')) && (
                      <Button type="button" size="xs" color="light" className="text-red-600" onClick={() => setEditPhoto('REMOVE')}>Remove</Button>
                    )}
                  </div>
                  <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={async ev => {
                      const file = ev.target.files?.[0]
                      if (!file) return
                      const b64 = await new Promise((res, rej) => {
                        const rd = new FileReader()
                        rd.onload = () => res(rd.result)
                        rd.onerror = rej
                        rd.readAsDataURL(file)
                      })
                      setEditPhoto(b64)
                      ev.target.value = ''
                    }} />
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Room"><TextInput value={editForm.room} onChange={e => setEditForm(f => ({ ...f, room: e.target.value }))} /></Field>
                <Field label="Name"><TextInput value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></Field>
                <Field label="Case Manager"><TextInput value={editForm.case_manager} onChange={e => setEditForm(f => ({ ...f, case_manager: e.target.value }))} /></Field>
                <Field label="Phone"><TextInput value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></Field>
                <Field label="Intake Date"><TextInput type="date" value={editForm.intake_date} onChange={e => setEditForm(f => ({ ...f, intake_date: e.target.value }))} /></Field>
                <Field label="Discharge Date"><TextInput type="date" value={editForm.discharge_date} onChange={e => setEditForm(f => ({ ...f, discharge_date: e.target.value }))} /></Field>
              </div>
              <Field label="Referral source"><TextInput placeholder="Referring agency / person" value={editForm.referral_source} onChange={e => setEditForm(f => ({ ...f, referral_source: e.target.value }))} /></Field>
              <Field label="Program track">
                <Select value={editForm.program_track} onChange={e => setEditForm(f => ({ ...f, program_track: e.target.value }))}>
                  <option value="">— select —</option>
                  {programTracks.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Emergency contacts">
                <div className="space-y-1.5">
                  {(editForm.emergency_contacts||[]).map((c, idx) => (
                    <div key={idx} className="flex gap-1.5">
                      <TextInput sizing="sm" className="flex-[2]" placeholder="Name" value={c.name||''} onChange={e=>updateEmergencyContact(setEditForm, editForm, idx, 'name', e.target.value)} />
                      <TextInput sizing="sm" className="flex-1" placeholder="Relationship" value={c.relationship||''} onChange={e=>updateEmergencyContact(setEditForm, editForm, idx, 'relationship', e.target.value)} />
                      <TextInput sizing="sm" className="flex-1" placeholder="Phone" value={c.phone||''} onChange={e=>updateEmergencyContact(setEditForm, editForm, idx, 'phone', e.target.value)} />
                      <Button type="button" size="xs" color="red" onClick={()=>removeEmergencyContact(setEditForm, editForm, idx)}>×</Button>
                    </div>
                  ))}
                  <Button type="button" size="xs" color="light" onClick={()=>addEmergencyContact(setEditForm, editForm)}>+ Add contact</Button>
                </div>
              </Field>
              <Field label="Intake notes"><Textarea rows={3} value={editForm.intake_notes} onChange={e => setEditForm(f => ({ ...f, intake_notes: e.target.value }))} /></Field>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setEditModal(null)}>Cancel</Button>
            <Button onClick={saveEdit} isProcessing={editSaving} disabled={editSaving}>Save Changes</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Reactivate Modal */}
      {reactivateModal && (
        <Modal show size="md" onClose={() => setReactivateModal(null)}>
          <ModalHeader>Reactivate {reactivateModal.name}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">Assign a room and reactivate <strong className="text-gray-900 dark:text-white">{reactivateModal.name}</strong>.</p>
              <Field label="Room Assignment">
                {vacantRooms.length > 0 ? (
                  <Select value={reactRoom} onChange={e => setReactRoom(e.target.value)}>
                    {vacantRooms.map(r => <option key={r} value={r}>Room {r} (vacant)</option>)}
                    <option value={reactivateModal.room}>Room {reactivateModal.room} (previous)</option>
                  </Select>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs text-amber-600">No VACANT rooms available. Enter room number manually:</p>
                    <TextInput value={reactRoom} onChange={e => setReactRoom(e.target.value)} placeholder="Room number" />
                  </div>
                )}
              </Field>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setReactivateModal(null)}>Cancel</Button>
            <Button onClick={confirmReactivate} isProcessing={reactSaving} disabled={reactSaving || !reactRoom}>Reactivate</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Add Client Modal */}
      {addModal && (
        <Modal show size="lg" onClose={() => setAddModal(false)}>
          <ModalHeader>Add Client</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {addError && <Alert color="failure">{addError}</Alert>}
              <Field label="Room *">
                {vacantRooms.length > 0 ? (
                  <Select value={addForm.room} autoFocus onChange={e => setAddForm(f => ({ ...f, room: e.target.value }))}>
                    {vacantRooms.map(r => <option key={r} value={r}>Room {r} (vacant)</option>)}
                  </Select>
                ) : (
                  <div className="py-2 text-sm text-amber-600">No vacant rooms available. Add VACANT rooms via facility management first.</div>
                )}
              </Field>
              <Field label="Name *"><TextInput value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Case Manager (optional)"><TextInput value={addForm.case_manager} onChange={e => setAddForm(f => ({ ...f, case_manager: e.target.value }))} /></Field>
                <Field label="Phone (optional)"><TextInput value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 555-5555" /></Field>
              </div>
              <Field label="Intake Date (optional)"><TextInput type="date" value={addForm.intake_date} onChange={e => setAddForm(f => ({ ...f, intake_date: e.target.value }))} /></Field>
              <Field label="Referral source (optional)"><TextInput placeholder="Referring agency / person" value={addForm.referral_source} onChange={e => setAddForm(f => ({ ...f, referral_source: e.target.value }))} /></Field>
              <Field label="Program track (optional)">
                <Select value={addForm.program_track} onChange={e => setAddForm(f => ({ ...f, program_track: e.target.value }))}>
                  <option value="">— select —</option>
                  {programTracks.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Emergency contacts (optional)">
                <div className="space-y-1.5">
                  {(addForm.emergency_contacts||[]).map((c, idx) => (
                    <div key={idx} className="flex gap-1.5">
                      <TextInput sizing="sm" className="flex-[2]" placeholder="Name" value={c.name||''} onChange={e=>updateEmergencyContact(setAddForm, addForm, idx, 'name', e.target.value)} />
                      <TextInput sizing="sm" className="flex-1" placeholder="Relationship" value={c.relationship||''} onChange={e=>updateEmergencyContact(setAddForm, addForm, idx, 'relationship', e.target.value)} />
                      <TextInput sizing="sm" className="flex-1" placeholder="Phone" value={c.phone||''} onChange={e=>updateEmergencyContact(setAddForm, addForm, idx, 'phone', e.target.value)} />
                      <Button type="button" size="xs" color="red" onClick={()=>removeEmergencyContact(setAddForm, addForm, idx)}>×</Button>
                    </div>
                  ))}
                  <Button type="button" size="xs" color="light" onClick={()=>addEmergencyContact(setAddForm, addForm)}>+ Add contact</Button>
                </div>
              </Field>
              <Field label="Intake notes (optional)"><Textarea rows={3} value={addForm.intake_notes} onChange={e => setAddForm(f => ({ ...f, intake_notes: e.target.value }))} /></Field>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setAddModal(false)}>Cancel</Button>
            <Button onClick={saveAdd} isProcessing={addSaving} disabled={addSaving}>Add Client</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Photo Popout */}
      {photoPopout && (
        <Modal show size="lg" onClose={() => setPhotoPopout(null)}>
          <ModalHeader>{photoPopout.name}</ModalHeader>
          <ModalBody>
            <img src={photoPopout.src} alt={photoPopout.name} className="object-contain mx-auto rounded-lg max-h-[70vh]" />
          </ModalBody>
        </Modal>
      )}

      {/* Client Report Builder */}
      {reportModal && (
        <ClientReportModal data={data} onClose={() => setReportModal(false)} />
      )}

      {/* Discharge Modal — creates a formal discharge_record and marks client inactive */}
      {dischargeModal && (
        <Modal show size="2xl" onClose={() => setDischargeModal(null)}>
          <ModalHeader>Discharge {dischargeModal.name}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {dischargeErr && <Alert color="failure">{dischargeErr}</Alert>}
              <p className="text-sm text-gray-600 dark:text-gray-300">
                A discharge record is created and is <strong className="text-gray-900 dark:text-white">immutable</strong> after submission. The client will be marked inactive.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Discharge date"><TextInput type="date" value={dischargeForm.discharge_date} onChange={e => setDischargeForm(f => ({ ...f, discharge_date: e.target.value }))} /></Field>
                <Field label="Reason">
                  <Select value={dischargeForm.reason} onChange={e => setDischargeForm(f => ({ ...f, reason: e.target.value }))}>
                    <option value="graduate">Graduate / Successful completion</option>
                    <option value="ama">AMA (Against Medical Advice)</option>
                    <option value="therapeutic">Therapeutic discharge</option>
                    <option value="administrative">Administrative discharge</option>
                  </Select>
                </Field>
              </div>
              <Field label="Narrative"><Textarea rows={3} value={dischargeForm.narrative} onChange={e => setDischargeForm(f => ({ ...f, narrative: e.target.value }))} /></Field>
              <Field label="Aftercare plan"><Textarea rows={3} value={dischargeForm.aftercare_plan} onChange={e => setDischargeForm(f => ({ ...f, aftercare_plan: e.target.value }))} /></Field>
              <Field label="Referrals made">
                <div className="space-y-1.5">
                  {(dischargeForm.referrals_made||[]).map((r, idx) => (
                    <div key={idx} className="flex gap-1.5">
                      <TextInput sizing="sm" className="flex-[2]" placeholder="Agency" value={r.agency||''} onChange={e=>updateReferral(idx,'agency', e.target.value)} />
                      <TextInput sizing="sm" className="flex-[2]" placeholder="Contact" value={r.contact||''} onChange={e=>updateReferral(idx,'contact',e.target.value)} />
                      <TextInput sizing="sm" className="flex-1" type="date" value={r.date||''} onChange={e=>updateReferral(idx,'date', e.target.value)} />
                      <TextInput sizing="sm" className="flex-1" placeholder="Type" value={r.type||''} onChange={e=>updateReferral(idx,'type', e.target.value)} />
                      <Button type="button" size="xs" color="red" onClick={()=>removeReferral(idx)}>×</Button>
                    </div>
                  ))}
                  <Button type="button" size="xs" color="light" onClick={addReferral}>+ Add referral</Button>
                </div>
              </Field>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={() => setDischargeModal(null)}>Cancel</Button>
            <Button color="red" onClick={discharge} isProcessing={dischargeSaving} disabled={dischargeSaving}>Discharge &amp; Save Record</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
