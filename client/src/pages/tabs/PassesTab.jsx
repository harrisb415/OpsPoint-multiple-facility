import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, MoreHorizontal, Ticket, AlertTriangle, LogIn } from 'lucide-react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { CARD, Header, Kpi, KpiRow, Table, NameCell, BadgeCell, MonoCell, MutedCell, ActionsCell, rowCls } from '../../components/console.jsx'

const PAGE_SIZE = 25
const PASS_TONE = { Out: 'yellow', Extended: 'red', In: 'green', Returned: 'gray' }

function fmtDT(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}
function localDT(s) { if (!s) return ''; try { return new Date(s).toISOString().slice(0, 16) } catch { return '' } }

const BLANK_PASS = { client_id: '', room: '', name: '', departure: '', return_date: '', ua_notes: '', notes: '', status: 'In' }

export default function PassesTab() {
  const { data, openProfile, loadData } = useData()
  const { hasPerm } = usePermission()
  const canEdit   = hasPerm('passes.edit')
  const canStatus = hasPerm('passes.status') || canEdit
  const { globalSearch = '' } = useOutletContext() || {}

  const passes = data?.passes || []
  const clients = data?.clients || []

  const [noticeText, setNoticeText] = useState(data?.pass_notice || '')
  const [noticeSaving, setNoticeSaving] = useState(false)
  const [retPage, setRetPage] = useState(0)
  const [menuId, setMenuId] = useState(null)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK_PASS)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const gq = globalSearch.toLowerCase().trim()
  const pmatch = p => !gq || (p.name || '').toLowerCase().includes(gq) || String(p.room || '').includes(gq)
  const active = useMemo(() => passes.filter(p => p.status !== 'Returned' && pmatch(p)), [passes, gq])  // eslint-disable-line react-hooks/exhaustive-deps
  const returned = useMemo(() => passes.filter(p => p.status === 'Returned' && pmatch(p))
    .slice().sort((a, b) => (b.return_date || '').localeCompare(a.return_date || '')), [passes, gq])  // eslint-disable-line react-hooks/exhaustive-deps
  const retPages = Math.ceil(returned.length / PAGE_SIZE)
  const retPaged = returned.slice(retPage * PAGE_SIZE, (retPage + 1) * PAGE_SIZE)

  const activeClients = useMemo(() =>
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [clients]
  )

  async function saveNotice() {
    setNoticeSaving(true)
    await fetch('/api/pass-notice', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ notice: noticeText }) })
    setNoticeSaving(false)
  }
  function openAdd() { setForm({ ...BLANK_PASS }); setError(''); setModal('add') }
  function openEdit(p) {
    setForm({ client_id: String(p.client_id || ''), room: p.room || '', name: p.name || '', departure: localDT(p.departure), return_date: localDT(p.return_date), ua_notes: p.ua_notes || '', notes: p.notes || '', status: p.status || 'Out' })
    setError(''); setModal(p)
  }
  function handleClientSelect(clientId) {
    const c = clients.find(x => String(x.id) === String(clientId))
    setForm(f => ({ ...f, client_id: clientId, room: c?.room || f.room, name: c?.name || f.name }))
  }
  async function submit() {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      const isNew = modal === 'add'
      const url = isNew ? '/api/passes' : `/api/passes/${modal.id}`
      const body = { client_id: form.client_id ? parseInt(form.client_id) : null, room: form.room, name: form.name.trim(), departure: form.departure || null, return_date: form.return_date || null, ua_notes: form.ua_notes, notes: form.notes, status: form.status }
      const r = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Save failed'); return }
      setModal(null)
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }
  async function quickStatus(p, newStatus) {
    const r = await fetch(`/api/passes/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ...p, status: newStatus }) })
    if (r.ok) loadData()
  }
  async function del(p) {
    if (!window.confirm(`Delete pass for ${p.name}?`)) return
    const r = await fetch(`/api/passes/${p.id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) loadData()
  }

  const notesOf = p => [p.ua_notes ? `UA: ${p.ua_notes}` : '', p.notes || ''].filter(Boolean).join(' · ') || '—'
  const nameCell = p => <NameCell name={p.name} sub={`Rm ${p.room}`} onClick={p.client_id ? () => openProfile(p.client_id) : undefined} />

  function RowMenu({ p }) {
    if (!canEdit && !canStatus) return null
    return (
      <div className="relative inline-block text-left">
        <button onClick={() => setMenuId(menuId === p.id ? null : p.id)} className="p-1.5 text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"><MoreHorizontal className="w-4 h-4" /></button>
        {menuId === p.id && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuId(null)} />
            <div className="absolute right-0 z-50 w-40 p-1 mt-1 text-left bg-white border border-gray-200 shadow-lg rounded-lg dark:bg-gray-800 dark:border-gray-700">
              {canEdit && <button onClick={() => { setMenuId(null); openEdit(p) }} className="block w-full px-3 py-2 text-sm text-left text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">Edit</button>}
              {canStatus && p.status !== 'Returned' && <button onClick={() => { setMenuId(null); quickStatus(p, 'Returned') }} className="block w-full px-3 py-2 text-sm text-left text-green-700 rounded-md hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30">Mark Returned</button>}
              {canStatus && p.status === 'Out' && <button onClick={() => { setMenuId(null); quickStatus(p, 'Extended') }} className="block w-full px-3 py-2 text-sm text-left text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">Mark Extended</button>}
              {canEdit && <button onClick={() => { setMenuId(null); del(p) }} className="block w-full px-3 py-2 text-sm text-left text-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30">Delete</button>}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <Header
        crumb={['Daily Ops', 'Passes']}
        title="Passes"
        sub="Active and recent resident passes"
        actions={canEdit ? [{ Icon: Plus, label: 'New Pass', primary: true, onClick: openAdd }] : []}
      />

      <KpiRow>
        <Kpi label="Currently Out" value={active.length} sub="on pass" deltaLabel="now" Icon={Ticket} accent="primary" />
        <Kpi label="Extended" value={active.filter(p => p.status === 'Extended').length} sub="needs follow-up" Icon={AlertTriangle} accent="red" />
        <Kpi label="Returned" value={returned.length} sub="total" Icon={LogIn} accent="green" />
      </KpiRow>

      {/* Pass notice board */}
      <div className={`${CARD} mb-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Pass Notice Board</h3>
          {canEdit && <button onClick={saveNotice} disabled={noticeSaving} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50">{noticeSaving ? 'Saving…' : 'Save Notice'}</button>}
        </div>
        <textarea value={noticeText} onChange={e => setNoticeText(e.target.value)} rows={2} disabled={!canEdit}
          placeholder="Enter any pass-related notices for this weekend…"
          className="block w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg resize-y bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
      </div>

      {/* Active passes */}
      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Active passes</h3>
      <div className="mb-6">
        <Table headers={[{ label: 'Resident' }, { label: 'Status' }, { label: 'Departure' }, { label: 'Return' }, { label: 'Notes' }, { label: '', right: true }]}>
          {active.length === 0 ? (
            <tr><td colSpan={6} className="p-8 text-sm text-center text-gray-400">No active passes.</td></tr>
          ) : active.map((p, i) => (
            <tr key={p.id} className={rowCls(i)}>
              {nameCell(p)}
              <BadgeCell tone={PASS_TONE[p.status] || 'gray'} label={p.status} />
              <MonoCell>{fmtDT(p.departure)}</MonoCell>
              <MonoCell>{fmtDT(p.return_date)}</MonoCell>
              <MutedCell>{notesOf(p)}</MutedCell>
              <ActionsCell><RowMenu p={p} /></ActionsCell>
            </tr>
          ))}
        </Table>
      </div>

      {/* Returned passes */}
      {returned.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Returned passes</h3>
          <Table headers={[{ label: 'Resident' }, { label: 'Departure' }, { label: 'Returned' }, { label: 'Notes' }, { label: '', right: true }]}>
            {retPaged.map((p, i) => (
              <tr key={p.id} className={`${rowCls(i)} opacity-70`}>
                {nameCell(p)}
                <MonoCell>{fmtDT(p.departure)}</MonoCell>
                <MonoCell>{fmtDT(p.return_date)}</MonoCell>
                <MutedCell>{p.notes || '—'}</MutedCell>
                <ActionsCell>{canEdit && <button onClick={() => del(p)} className="p-1.5 text-gray-400 rounded-lg hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"><MoreHorizontal className="w-4 h-4" /></button>}</ActionsCell>
              </tr>
            ))}
          </Table>
          {retPages > 1 && (
            <div className="flex items-center gap-3 mt-3">
              <button disabled={retPage === 0} onClick={() => setRetPage(p => p - 1)} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">← Prev</button>
              <span className="text-sm text-gray-500 dark:text-gray-400 font-mono tabular-nums">{retPage * PAGE_SIZE + 1}–{Math.min((retPage + 1) * PAGE_SIZE, returned.length)} of {returned.length}</span>
              <button disabled={retPage + 1 >= retPages} onClick={() => setRetPage(p => p + 1)} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">Next →</button>
            </div>
          )}
        </>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h2>{modal === 'add' ? 'Add Weekend Pass' : `Edit Pass — ${modal.name}`}</h2>
              <button className="xbtn" onClick={() => setModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              {error && <div className="auth-error">{error}</div>}
              {modal === 'add' && (
                <div className="field"><label>Select Resident</label>
                  <select value={form.client_id} onChange={e => handleClientSelect(e.target.value)}>
                    <option value="">— Select or type below —</option>
                    {activeClients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field"><label>Room</label>
                  <input type="text" value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))} /></div>
                <div className="field"><label>Name</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div className="field"><label>Departure</label>
                  <input type="datetime-local" value={form.departure} onChange={e => setForm(f => ({ ...f, departure: e.target.value }))} /></div>
                <div className="field"><label>Expected Return</label>
                  <input type="datetime-local" value={form.return_date} onChange={e => setForm(f => ({ ...f, return_date: e.target.value }))} /></div>
              </div>
              <div className="field"><label>Status</label>
                <select value={form.status} disabled={!canStatus} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="Out">Out</option>
                  <option value="Extended">Extended</option>
                  <option value="In">In</option>
                </select>
              </div>
              <div className="field"><label>UA Requirements / Notes</label>
                <input type="text" value={form.ua_notes} onChange={e => setForm(f => ({ ...f, ua_notes: e.target.value }))} placeholder="e.g. UA required on return" /></div>
              <div className="field"><label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} /></div>
            </div>
            <div className="modal-foot">
              <button className="btn-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Pass'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
