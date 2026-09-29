// The step-4 action sheets. Each calls an endpoint the desktop already uses,
// so the same permission checks and audit entries apply.
import { useState } from 'react'
import { Alert, Button, Label, Radio, Select, Textarea, TextInput, ToggleSwitch } from 'flowbite-react'
import PinPad from '../components/PinPad.jsx'
import { useMobile } from './context.js'
import { api } from './api.js'
import { Sheet } from './ui.jsx'
import { currentStatuses, isAway } from './model.js'
import { fmtDay, fmtWhen } from '../utils/dates.js'

const todayKey = () => new Date().toLocaleDateString('en-CA')

// ── Review an infraction: assign a consequence, or waive it ─────────────────
export function InfractionReviewSheet({ item, onClose }) {
  const { toast, reload } = useMobile()
  const [action, setAction] = useState('assign')
  const [consequence, setConsequence] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (action === 'assign' && !consequence.trim()) return
    setBusy(true)
    try {
      await api('PUT', `/api/violations/${item.id}/review`, action === 'waive' ? { action: 'waive' } : { action: 'assign', consequence: consequence.trim() })
      toast(action === 'waive' ? 'Infraction waived.' : 'Consequence assigned.', 'ok')
      onClose()
      await reload()
    } catch (err) { toast(`Not saved: ${err.message}`, 'error') }
    finally { setBusy(false) }
  }

  return (
    <Sheet open={!!item} onClose={onClose} title="Review infraction">
      {item && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="rounded-xl bg-gray-100 p-3 dark:bg-gray-700">
            <p className="text-[15px] font-semibold">{item.client_name}{item.room ? ` · Rm ${item.room}` : ''}</p>
            <p className="mt-1 text-sm">{item.description || 'No description'}</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {[item.violation_date && fmtDay(item.violation_date), (item.staff_name || item.logged_by) && `by ${item.staff_name || item.logged_by}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Decision</legend>
            <div className="flex items-center gap-2">
              <Radio id="rv-assign" name="rv" value="assign" checked={action === 'assign'} onChange={() => setAction('assign')} />
              <Label htmlFor="rv-assign">Assign a consequence</Label>
            </div>
            {action === 'assign' && (
              <TextInput value={consequence} onChange={e => setConsequence(e.target.value)} placeholder="e.g. Extra kitchen duty" maxLength={200} aria-label="Consequence" required />
            )}
            <div className="flex items-center gap-2">
              <Radio id="rv-waive" name="rv" value="waive" checked={action === 'waive'} onChange={() => setAction('waive')} />
              <Label htmlFor="rv-waive">Waive it</Label>
            </div>
          </fieldset>
          <Button type="submit" disabled={busy || (action === 'assign' && !consequence.trim())} className="w-full">
            {action === 'waive' ? 'Waive infraction' : 'Assign consequence'}
          </Button>
        </form>
      )}
    </Sheet>
  )
}

// ── Log an infraction, for a given resident or one picked here ──────────────
export function LogInfractionSheet({ open, resident = null, onClose, onDone }) {
  const { snap, toast, reload } = useMobile()
  const [clientId, setClientId] = useState('')
  const [description, setDescription] = useState('')
  const [staff, setStaff] = useState('')
  const [date, setDate] = useState(todayKey)
  const [busy, setBusy] = useState(false)
  const who = resident || snap.residents.find(c => String(c.id) === String(clientId)) || null
  const ready = who && description.trim() && staff.trim()

  function close() { setClientId(''); setDescription(''); setStaff(''); setDate(todayKey()); onClose() }

  async function submit(e) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      await api('POST', '/api/violations', { client_id: who.id, client_name: who.name, room: String(who.room), violation_date: date, description: description.trim(), staff_name: staff.trim() })
      toast(`Infraction logged for ${who.name}.`, 'ok')
      close()
      onDone?.()
      await reload()
    } catch (err) { toast(`Not saved: ${err.message}`, 'error') }
    finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={close} title="Log an infraction">
      <form onSubmit={submit} className="flex flex-col gap-3">
        {resident
          ? <p className="text-[15px] font-semibold">{resident.name} · Rm {resident.room}</p>
          : (
            <div>
              <Label htmlFor="inf-res">Resident</Label>
              <Select id="inf-res" value={clientId} onChange={e => setClientId(e.target.value)} required className="mt-1">
                <option value="">Choose a resident</option>
                {snap.residents.map(c => <option key={c.id} value={c.id}>{c.room} · {c.name}</option>)}
              </Select>
            </div>
          )}
        <div>
          <Label htmlFor="inf-desc">What happened</Label>
          <Textarea id="inf-desc" rows={3} maxLength={500} value={description} onChange={e => setDescription(e.target.value)} required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="inf-staff">Staff</Label>
          <TextInput id="inf-staff" value={staff} maxLength={80} onChange={e => setStaff(e.target.value)} placeholder="Staff name" autoComplete="off" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="inf-date">Date</Label>
          <TextInput id="inf-date" type="date" value={date} max={todayKey()} onChange={e => setDate(e.target.value)} required className="mt-1" />
        </div>
        <Button type="submit" disabled={busy || !ready} className="w-full">Log infraction</Button>
      </form>
    </Sheet>
  )
}

// ── Random UA draw — the desktop's rules: residents in the building only,
//    optionally skipping anyone drawn in the last 30 days ──────────────────
export function UaDrawSheet({ open, onClose }) {
  const { snap, toast, reload } = useMobile()
  const [count, setCount] = useState(5)
  const [smart, setSmart] = useState(true)
  const [preview, setPreview] = useState(null)
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  function close() { setPreview(null); setInfo(''); onClose() }

  async function draw() {
    setBusy(true)
    try {
      let recent = new Set()
      if (smart) recent = new Set(((await api('GET', '/api/ua-draws/recent-clients?days=30')).ids || []).map(Number))
      const statuses = currentStatuses(snap)
      const inBuilding = snap.residents.filter(c => !isAway(statuses, c.id))
      const pool = inBuilding.filter(c => !recent.has(c.id))
      const a = pool.slice()
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
      setPreview(a.slice(0, Math.min(count, a.length)).map(c => ({ id: c.id, name: c.name, room: c.room })))
      setInfo(`${pool.length} of ${inBuilding.length} residents eligible${smart && inBuilding.length > pool.length ? ` (${inBuilding.length - pool.length} drawn in the last 30 days)` : ''}`)
    } catch (err) { toast(`Couldn’t draw: ${err.message}`, 'error') }
    finally { setBusy(false) }
  }

  async function confirm() {
    setBusy(true)
    try {
      await api('POST', '/api/ua-draws', { residents: preview, method: smart ? 'smart' : 'random' })
      toast(`UA requested for ${preview.length} ${preview.length === 1 ? 'resident' : 'residents'}.`, 'ok')
      close()
      await reload()
    } catch (err) { toast(`Not saved: ${err.message}`, 'error') }
    finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={close} title="Random UA draw">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="ua-count">How many</Label>
          <div className="flex items-center gap-2">
            <Button size="sm" color="light" onClick={() => { setCount(c => Math.max(1, c - 1)); setPreview(null) }} aria-label="Fewer">−</Button>
            <span id="ua-count" className="w-8 text-center font-display text-xl font-bold">{count}</span>
            <Button size="sm" color="light" onClick={() => { setCount(c => Math.min(10, c + 1)); setPreview(null) }} aria-label="More">+</Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span id="ua-smart" className="text-sm">Skip anyone drawn in the last 30 days</span>
          <ToggleSwitch checked={smart} onChange={v => { setSmart(v); setPreview(null) }} aria-labelledby="ua-smart" />
        </div>
        {!preview && <Button onClick={draw} disabled={busy} className="w-full">Draw names</Button>}
        {preview && (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-400">{info}</p>
            {preview.length === 0
              ? <Alert color="warning">No one is eligible right now.</Alert>
              : (
                <ul className="flex flex-col divide-y divide-gray-200 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                  {preview.map(c => (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="w-10 font-mono text-sm font-bold text-gray-600 dark:text-gray-400">{c.room}</span>
                      <span className="text-[15px] font-semibold">{c.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            <div className="flex gap-2">
              <Button color="light" onClick={draw} disabled={busy} className="flex-1">Draw again</Button>
              <Button onClick={confirm} disabled={busy || preview.length === 0} className="flex-1">Request UAs</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

// ── Extend a pass: a new return date and time ───────────────────────────────
function toLocalInput(v) {
  const d = v ? new Date(v) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ExtendPassSheet({ pass, resident, onClose, onDone }) {
  const { toast } = useMobile()
  const [when, setWhen] = useState(() => toLocalInput(pass?.return_date))
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const d = new Date(when)
    if (Number.isNaN(d.getTime())) return
    setBusy(true)
    try {
      await api('PUT', `/api/passes/${pass.id}`, { status: 'Extended', return_date: d.toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
      toast(`Pass extended to ${fmtWhen(d.toISOString())}.`, 'ok')
      onDone?.()
      onClose()
    } catch (err) { toast(`Not saved: ${err.message}`, 'error') }
    finally { setBusy(false) }
  }

  return (
    <Sheet open={!!pass} onClose={onClose} title="Extend pass">
      {pass && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-[15px] font-semibold">{resident?.name}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Due back {fmtWhen(pass.return_date)}</p>
          <div>
            <Label htmlFor="ext-when">New return date and time</Label>
            <TextInput id="ext-when" type="datetime-local" value={when} min={toLocalInput(pass.return_date)} onChange={e => setWhen(e.target.value)} required className="mt-1" />
          </div>
          <Button type="submit" disabled={busy || !when} className="w-full">Extend pass</Button>
        </form>
      )}
    </Sheet>
  )
}

// ── Set up quick unlock: the PIN twice ──────────────────────────────────────
export function PinSetupSheet({ open, onClose, onDone }) {
  const { toast } = useMobile()
  const [first, setFirst] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function close() { setFirst(null); setError(''); onClose() }

  async function entered(pin) {
    if (!first) { setFirst(pin); setError(''); return }
    if (pin !== first) { setFirst(null); setError('The PINs didn’t match. Start again.'); return }
    setBusy(true)
    try {
      await api('POST', '/api/auth/pin/setup', { pin })
      toast('Quick unlock is on for this phone.', 'ok')
      onDone?.()
      close()
    } catch (err) {
      setFirst(null)
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={close} title="Quick unlock">
      <div className="flex flex-col items-center gap-4 pb-2">
        <p className="text-center text-sm text-gray-600 dark:text-gray-300">
          {first ? 'Enter the same PIN again.' : 'Choose a 6-digit PIN. After the idle sign-out you can unlock with it instead of your password.'}
        </p>
        {error && <Alert color="failure" className="w-full">{error}</Alert>}
        <PinPad key={first ? 'confirm' : 'first'} onComplete={entered} busy={busy} label={first ? 'Confirm PIN' : 'New PIN'} />
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">Five wrong tries switch it off. It only works on this phone.</p>
      </div>
    </Sheet>
  )
}
