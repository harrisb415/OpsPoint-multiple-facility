// The setup wizard's steps (pages/Setup.jsx walks them). Each saves through
// the app's own endpoints as it goes, and can be skipped: the defaults then
// apply, and the dashboard's setup checklist lists it afterwards.
import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Checkbox, Label, Select, Textarea, TextInput, ToggleSwitch } from 'flowbite-react'
import { AlertCircle, ArrowRight, Download, Plus, Smartphone, Trash2, X } from 'lucide-react'
import { Field } from '../../components/ui.jsx'
import QrCode from '../../components/QrCode.jsx'
import InviteLink from '../../components/InviteLink.jsx'
import { THEMES, DEFAULT_THEME, applyTheme, setTheme } from '../../utils/themes.js'
import { STATUS_TONES, TONE_DOT, SYSTEM_STATUS_KEYS, DEFAULT_STATUSES } from '../../utils/statuses.js'
import { api, roomRange, parseRoomsCsv } from './setupApi.js'

// ── Shared ──────────────────────────────────────────────────────────────────
function useSave() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) {
    setBusy(true); setError('')
    try { return await fn() } catch (e) { setError(e.message); return undefined } finally { setBusy(false) }
  }
  return { busy, error, setError, run }
}

export function StepFrame({ title, lead, children, onSave, saveLabel = 'Save and continue', onSkip, skipLabel = 'Skip for now', busy, error, canSave = true }) {
  return (
    <section aria-labelledby="setup-step-title" className="space-y-6">
      <header>
        <h2 id="setup-step-title" className="text-xl font-semibold tracking-tight text-gray-900 font-display dark:text-white">{title}</h2>
        {lead && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{lead}</p>}
      </header>
      <div className="space-y-6">{children}</div>
      {error && <Alert color="failure" icon={AlertCircle}>{error}</Alert>}
      <footer className="flex flex-col-reverse gap-2 pt-5 border-t border-gray-200 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
        {onSkip ? <Button color="light" onClick={onSkip} disabled={busy}>{skipLabel}</Button> : <span />}
        {onSave && (
          <Button onClick={onSave} disabled={busy || !canSave} isProcessing={busy}>
            {saveLabel}<ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        )}
      </footer>
    </section>
  )
}

// A box that groups the parts of a step.
function Part({ title, children, aside }) {
  return (
    <div className="p-4 border border-gray-200 rounded-xl sm:p-5 dark:border-gray-700">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        {aside}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

// A short list of words (UA panel, walkthrough areas, times) edited as chips.
function ChipList({ id, items, onChange, placeholder, type = 'text', label }) {
  const [draft, setDraft] = useState('')
  function add() {
    const v = draft.trim()
    if (!v || items.includes(v)) return
    onChange(type === 'time' ? [...items, v].sort() : [...items, v])
    setDraft('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {items.length === 0 && <span className="text-xs text-gray-400">None yet.</span>}
        {items.map((it) => (
          <span key={it} className="inline-flex items-center gap-1 py-1 pl-2.5 pr-1 text-sm rounded-full bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200">
            {it}
            <button type="button" onClick={() => onChange(items.filter((x) => x !== it))} aria-label={`Remove ${it}`}
              className="p-0.5 rounded-full hover:bg-primary-100 dark:hover:bg-primary-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <TextInput id={id} type={type} sizing="sm" value={draft} placeholder={placeholder} aria-label={label}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          className="flex-1 min-w-0" />
        <Button size="xs" color="light" onClick={add}><Plus className="w-4 h-4 mr-1" />Add</Button>
      </div>
    </div>
  )
}

// ── Facility ────────────────────────────────────────────────────────────────
export function FacilityStep({ ctx, done, skip }) {
  const { settings, status } = ctx
  const saved = settings.facility_theme || DEFAULT_THEME
  const [name, setName] = useState(settings.facility_name && settings.facility_name !== 'OpsPoint' ? settings.facility_name : '')
  const [theme, setThemeKey] = useState(saved)
  const [tzOk, setTzOk] = useState(false)
  const { busy, error, run } = useSave()
  const tz = status.timeZone

  function pick(k) { setThemeKey(k); applyTheme(k) }            // a live preview
  const save = () => run(async () => {
    if (!name.trim()) throw new Error("Enter the facility's name.")
    if (!tzOk) throw new Error("Confirm the time zone, or set the right one first (see above).")
    await ctx.saveSettings({ facility_name: name.trim(), facility_theme: theme })
    setTheme(theme)
    await done()
  })
  return (
    <StepFrame title="Facility" lead="Its name on every screen and report, its time zone, and its colours."
      onSave={save} onSkip={() => { applyTheme(saved); skip() }} busy={busy} error={error}>
      <Field label="Facility name" htmlFor="setup-facility-name">
        <TextInput id="setup-facility-name" value={name} maxLength={200} placeholder="Sunrise Recovery House" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Part title="Time zone">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <span className="font-semibold">{tz.name}</span>{' '}
          <span className="text-gray-500 dark:text-gray-400">{tz.explicit ? `(set by ${tz.source})` : "(this server's clock)"}</span>
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Shift dates, log times and reports follow it. If it isn't the facility's, set TZ in the server's settings
          (for example TZ=America/Chicago) and restart OpsPoint, then come back to this step.
        </p>
        <div className="flex items-center gap-2">
          <Checkbox id="setup-tz" checked={tzOk} onChange={(e) => setTzOk(e.target.checked)} />
          <Label htmlFor="setup-tz">This is the facility's time zone</Label>
        </div>
      </Part>
      <Part title="Colours">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEMES.map((t) => {
            const on = theme === t.key
            return (
              <button key={t.key} type="button" onClick={() => pick(t.key)} aria-pressed={on}
                className={`flex items-center gap-3 p-3 text-left border-2 rounded-xl transition-colors ${on
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}`}>
                <svg viewBox="0 0 2 2" aria-hidden="true" className="overflow-hidden rounded-lg shadow-sm w-10 h-10 shrink-0">
                  <rect width="1" height="2" fill={t.swatch[0]} /><rect x="1" width="1" height="2" fill={t.swatch[1]} />
                </svg>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 truncate dark:text-white">{t.label}</span>
                  <span className="block text-xs text-gray-500 truncate dark:text-gray-400">{t.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Part>
    </StepFrame>
  )
}

// ── Shifts and reminders ────────────────────────────────────────────────────
export function ShiftsStep({ ctx, done, skip }) {
  const s = ctx.settings
  const [day, setDay] = useState(s.shift_day_start || '07:00')
  const [swing, setSwing] = useState(s.shift_swing_start || '15:00')
  const [grave, setGrave] = useState(s.shift_grave_start || '23:00')
  const [wellness, setWellness] = useState([...(s.wellness_schedule || [])])
  const [walks, setWalks] = useState([...(s.walk_schedule || [])])
  const { busy, error, run } = useSave()
  const save = () => run(async () => {
    await ctx.saveSettings({ shift_day_start: day, shift_swing_start: swing, shift_grave_start: grave, wellness_schedule: wellness, walk_schedule: walks })
    await done()
  })
  return (
    <StepFrame title="Shifts and reminders" lead="When each shift starts, and when staff are reminded to do wellness checks and walkthroughs."
      onSave={save} onSkip={skip} busy={busy} error={error}>
      <Part title="Shift start times">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Day" htmlFor="setup-day"><TextInput id="setup-day" type="time" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label="Swing" htmlFor="setup-swing"><TextInput id="setup-swing" type="time" value={swing} onChange={(e) => setSwing(e.target.value)} /></Field>
          <Field label="Graveyard" htmlFor="setup-grave"><TextInput id="setup-grave" type="time" value={grave} onChange={(e) => setGrave(e.target.value)} /></Field>
        </div>
      </Part>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Part title="Wellness check reminders">
          <ChipList id="setup-wellness" label="Add a wellness check time" type="time" items={wellness} onChange={setWellness} />
        </Part>
        <Part title="Walkthrough reminders">
          <ChipList id="setup-walks" label="Add a walkthrough time" type="time" items={walks} onChange={setWalks} />
        </Part>
      </div>
    </StepFrame>
  )
}

// ── Rooms and residents ─────────────────────────────────────────────────────
export function RoomsStep({ ctx, done, skip }) {
  const [mode, setMode] = useState('range')
  const [range, setRange] = useState('')
  const [csv, setCsv] = useState('')
  const [result, setResult] = useState(null)
  const { busy, error, setError, run } = useSave()
  const rows = useMemo(() => {
    if (mode === 'range') return (roomRange(range) || []).map((room) => ({ room, name: '' }))
    if (mode === 'csv') return parseRoomsCsv(csv)
    return []
  }, [mode, range, csv])
  const canManage = ctx.hasPerm('facility.manage')

  async function readFile(e) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    if (f.size > 512 * 1024) { setError('That file is too big for a room list (over 512 KB).'); return }
    setCsv(await f.text())
  }
  const add = () => run(async () => {
    if (!rows.length) throw new Error(mode === 'range' ? 'Type a range such as 201-220.' : 'Paste or upload at least one room.')
    const r = await api('/api/setup/rooms', { method: 'POST', body: { rooms: rows } })
    setResult(r)
    setRange(''); setCsv('')
  })
  const MODES = [['range', 'A range of rooms'], ['csv', 'A list, with residents'], ['empty', 'Start empty']]
  return (
    <StepFrame title="Rooms and residents" lead="The rooms staff see on the shift report, and who is in them. You can add and change rooms later in Admin."
      onSave={mode === 'empty' || result ? () => run(done) : undefined} saveLabel={result ? 'Continue' : 'Start empty'}
      onSkip={skip} busy={busy} error={error}>
      {!canManage && <Alert color="warning" icon={AlertCircle}>Adding rooms needs the “Manage facility” permission.</Alert>}
      <div className="inline-flex flex-wrap gap-2" role="group" aria-label="How to add rooms">
        {MODES.map(([k, l]) => (
          <Button key={k} size="sm" color={mode === k ? 'default' : 'light'} onClick={() => { setMode(k); setError('') }}>{l}</Button>
        ))}
      </div>
      {mode === 'range' && (
        <Part title="A range of rooms">
          <Field label="Rooms" htmlFor="setup-range" hint="For example 201-220, or A1-A12. Add another range after this one.">
            <TextInput id="setup-range" value={range} placeholder="201-220" onChange={(e) => setRange(e.target.value)} />
          </Field>
          {range.trim() && !rows.length && <p className="text-sm text-red-600 dark:text-red-400">That isn't a range OpsPoint can read (up to 500 rooms).</p>}
        </Part>
      )}
      {mode === 'csv' && (
        <Part title="A list, with residents">
          <Field label="One room per line: room number, then the resident's name if the room is taken" htmlFor="setup-csv">
            <Textarea id="setup-csv" rows={6} value={csv} placeholder={'room,name\n201,Pat Smith\n202,\n203,Sam Lee'} onChange={(e) => setCsv(e.target.value)} className="font-mono" />
          </Field>
          <Field label="Or upload a CSV file" htmlFor="setup-csv-file">
            <input id="setup-csv-file" type="file" accept=".csv,text/csv,text/plain" onChange={readFile}
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary-700 dark:text-gray-300 dark:file:bg-primary-900/40 dark:file:text-primary-200" />
          </Field>
        </Part>
      )}
      {mode === 'empty' && (
        <p className="text-sm text-gray-600 dark:text-gray-400">No rooms for now: add them in Admin › Facility › Rooms when you're ready.</p>
      )}
      {rows.length > 0 && (
        <Part title={`${rows.length} room${rows.length === 1 ? '' : 's'} to add`}
          aside={<Button size="xs" onClick={add} disabled={busy || !canManage} isProcessing={busy}>Add {rows.length === 1 ? 'it' : `all ${rows.length}`}</Button>}>
          <div className="overflow-y-auto border border-gray-100 rounded-lg max-h-56 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 text-xs text-left text-gray-500 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                <tr><th className="px-3 py-2">Room</th><th className="px-3 py-2">Resident</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={`${r.room}-${i}`}><td className="px-3 py-1.5 font-mono text-gray-900 dark:text-white">{r.room}</td>
                    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{r.name || <span className="text-gray-400">vacant</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && <p className="text-xs text-gray-500">And {rows.length - 100} more.</p>}
        </Part>
      )}
      {result && (
        <Alert color={result.problems.length ? 'warning' : 'success'}>
          Added {result.added.length} room{result.added.length === 1 ? '' : 's'}
          {result.existing.length > 0 && <>; {result.existing.length} already existed ({result.existing.slice(0, 8).join(', ')}{result.existing.length > 8 ? '…' : ''})</>}.
          {result.problems.length > 0 && <span className="block mt-1">{result.problems.slice(0, 5).join(' ')}</span>}
        </Alert>
      )}
    </StepFrame>
  )
}

// ── Care defaults ───────────────────────────────────────────────────────────
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 's_$1').slice(0, 24)

export function CareStep({ ctx, done, skip }) {
  const s = ctx.settings
  const [statuses, setStatuses] = useState(() => (s.client_statuses && s.client_statuses.length ? s.client_statuses : DEFAULT_STATUSES).filter((x) => !x.archived).map((x) => ({ ...x })))
  const [panel, setPanel] = useState([...(s.ua_panel || [])])
  const [areas, setAreas] = useState([...(s.walk_areas || [])])
  const [newLabel, setNewLabel] = useState('')
  const { busy, error, setError, run } = useSave()
  const edit = (i, patch) => setStatuses((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  function addStatus() {
    const label = newLabel.trim(), key = slug(label)
    if (!label || !key) return
    if (statuses.some((x) => x.key === key)) { setError(`There is already a status called “${label}”.`); return }
    setStatuses([...statuses, { key, label, tone: 'gray' }]); setNewLabel(''); setError('')
  }
  const save = () => run(async () => {
    await ctx.saveSettings({ client_statuses: statuses.map(({ key, label, tone }) => ({ key, label, tone })), ua_panel: panel, walk_areas: areas })
    await done()
  })
  return (
    <StepFrame title="Care defaults" lead="The statuses a resident can have, what a UA tests for, and the areas a walkthrough covers."
      onSave={save} onSkip={skip} busy={busy} error={error}>
      <Part title="Resident statuses">
        <ul className="space-y-2">
          {statuses.map((st, i) => (
            <li key={st.key} className="flex flex-wrap items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TONE_DOT[st.tone] || TONE_DOT.gray}`} aria-hidden="true" />
              <TextInput sizing="sm" value={st.label} maxLength={40} aria-label={`Name of the ${st.label} status`} onChange={(e) => edit(i, { label: e.target.value })} className="flex-1 min-w-40" />
              <Select sizing="sm" value={st.tone} aria-label={`Colour of ${st.label}`} onChange={(e) => edit(i, { tone: e.target.value })}>
                {STATUS_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
              {SYSTEM_STATUS_KEYS.includes(st.key)
                ? <Badge color="gray" className="shrink-0">built in</Badge>
                : <Button size="xs" color="light" onClick={() => setStatuses(statuses.filter((_, j) => j !== i))} aria-label={`Remove ${st.label}`}><Trash2 className="w-4 h-4" /></Button>}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <TextInput sizing="sm" value={newLabel} placeholder="New status, such as At work" aria-label="New status" maxLength={40}
            onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStatus() } }} className="flex-1 min-w-0" />
          <Button size="xs" color="light" onClick={addStatus}><Plus className="w-4 h-4 mr-1" />Add</Button>
        </div>
      </Part>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Part title="UA test panel"><ChipList id="setup-panel" label="Add a substance" items={panel} onChange={setPanel} placeholder="THC" /></Part>
        <Part title="Walkthrough areas"><ChipList id="setup-areas" label="Add an area" items={areas} onChange={setAreas} placeholder="Kitchen" /></Part>
      </div>
    </StepFrame>
  )
}

// ── Features ────────────────────────────────────────────────────────────────
const FEATURES = [
  { key: 'clinical', label: 'Clinical section', desc: 'Notes, treatment plans, assessments, group notes, incidents, discharge summaries' },
  { key: 'passes', label: 'Passes', desc: 'Weekend and day passes' },
  { key: 'mail', label: 'Mail', desc: 'Incoming mail, approved and delivered' },
  { key: 'groups', label: 'Groups', desc: 'Group sessions and attendance' },
  { key: 'chores', label: 'Chores', desc: 'Chore assignments and the chore log' },
]
export function FeaturesStep({ ctx, done, skip }) {
  const vis = ctx.settings.ui_visibility || { tabs: {}, buttons: {} }
  const [on, setOn] = useState(() => Object.fromEntries(FEATURES.map((f) => [f.key, (vis.tabs || {})[f.key] !== false])))
  const { busy, error, run } = useSave()
  const save = () => run(async () => {
    await ctx.saveSettings({ ui_visibility: { ...vis, tabs: { ...(vis.tabs || {}), ...on } } })
    await done()
  })
  return (
    <StepFrame title="Features" lead="Turn off what your facility doesn't use: it leaves the menus for everyone. Admin › Facility › Features has the rest."
      onSave={save} onSkip={skip} busy={busy} error={error}>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {FEATURES.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-gray-900 dark:text-white">{f.label}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{f.desc}</span>
            </span>
            <ToggleSwitch checked={on[f.key]} label="" aria-label={f.label} onChange={(v) => setOn((o) => ({ ...o, [f.key]: v }))} />
          </li>
        ))}
      </ul>
    </StepFrame>
  )
}

// ── Staff ───────────────────────────────────────────────────────────────────
const toUsername = (name) => String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 40)

export function StaffStep({ ctx, done, skip }) {
  const [profiles, setProfiles] = useState(null)
  const [form, setForm] = useState({ name: '', username: '', role: '' })
  const [invited, setInvited] = useState([])
  const { busy, error, run } = useSave()
  const canInvite = ctx.hasPerm('admin.users')

  useEffect(() => {
    if (!canInvite) return
    let gone = false
    api('/api/permission-profiles').then((p) => {
      if (gone) return
      setProfiles(p)
      setForm((f) => ({ ...f, role: (p.find((x) => x.key === 'pa') || p[0] || {}).key || 'pa' }))
    }).catch(() => { if (!gone) setProfiles([]) })
    return () => { gone = true }
  }, [canInvite])
  const invite = () => run(async () => {
    const name = form.name.trim(), username = (form.username || toUsername(form.name)).trim()
    if (!name) throw new Error('Enter their name.')
    if (!username) throw new Error('Enter a username.')
    const r = await api('/api/users', { method: 'POST', body: { displayName: name, username, role: form.role || 'pa', invite: true } })
    setInvited((list) => [{ name, username, ...r.invite }, ...list])
    setForm((f) => ({ ...f, name: '', username: '' }))
  })
  return (
    <StepFrame title="Staff" lead="Everyone who signs in. Each gets a one-time link, or its QR code, to set their own password: nobody hands out passwords."
      onSave={() => run(done)} saveLabel={invited.length ? 'Continue' : 'Save and continue'} onSkip={skip} busy={busy} error={error}>
      {!canInvite && <Alert color="warning" icon={AlertCircle}>Adding staff needs the “Manage users” permission.</Alert>}
      {canInvite && (
        <Part title="Invite someone">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Name" htmlFor="setup-staff-name">
              <TextInput id="setup-staff-name" value={form.name} maxLength={80} placeholder="Pat Smith" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Username" htmlFor="setup-staff-user" hint={form.name && !form.username ? `Will be ${toUsername(form.name) || '…'}` : undefined}>
              <TextInput id="setup-staff-user" value={form.username} maxLength={40} placeholder={toUsername(form.name) || 'pat.smith'} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
            </Field>
            <Field label="Role" htmlFor="setup-staff-role">
              <Select id="setup-staff-role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} disabled={!profiles}>
                {(profiles || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={invite} disabled={busy} isProcessing={busy}><Plus className="w-4 h-4 mr-1" />Invite</Button>
          </div>
        </Part>
      )}
      {invited.map((i) => (
        <Part key={i.link} title={`${i.name} (${i.username})`}>
          <InviteLink name={i.name} link={i.link} expiresAt={i.expiresAt} />
        </Part>
      ))}
    </StepFrame>
  )
}

// ── Security and records ────────────────────────────────────────────────────
export function SecurityStep({ ctx, done, skip }) {
  const sec = ctx.status.security
  const [keyStored, setKeyStored] = useState(!!(sec.dbKey && sec.dbKey.confirmed))
  const [dir, setDir] = useState(sec.backups.kind === 'folder' ? sec.backups.dir : '')
  const [dirNote, setDirNote] = useState(null)
  const [autoUpdates, setAutoUpdates] = useState(sec.updates ? sec.updates.auto : false)
  const { busy, error, run } = useSave()
  const system = ctx.hasPerm('admin.system')

  const saveDir = () => run(async () => {
    const r = await api('/api/setup/backup-dir', { method: 'PUT', body: { dir: dir.trim() } })
    setDirNote(r.sameDrive ? 'warn' : 'ok')
  })
  const save = () => run(async () => {
    if (sec.dbKey && !sec.dbKey.inStore && !keyStored) {
      throw new Error("Tick that the database key is stored somewhere off this server: without it, the database and every backup are unreadable.")
    }
    if (sec.dbKey && !sec.dbKey.inStore && keyStored && !sec.dbKey.confirmed) await api('/api/system/health/dbkey-confirmed', { method: 'POST', body: {} })
    if (sec.updates && system) await api('/api/setup/updates', { method: 'PUT', body: { auto: autoUpdates } })
    await done()
  })
  return (
    <StepFrame title="Security and records" lead={`What keeps the records safe on this install (${ctx.status.profile.label}).`}
      onSave={save} onSkip={skip} busy={busy} error={error}>
      {!system && <Alert color="warning" icon={AlertCircle}>These settings need the “System” permission.</Alert>}
      {sec.dbKey && (
        <Part title="Encryption key">
          {sec.dbKey.inStore ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">The database key is kept in {sec.dbKey.source}, not on this server. Nothing to do here.</p>
          ) : (
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                The database is encrypted. Without its key, the database and every backup of it are unreadable, and nobody can recover them.
                {sec.dbKey.downloadable ? ' Download the key and keep it somewhere off this server: a password manager, or a USB key kept apart from the backups.'
                  : ' It comes from OPSPOINT_DB_KEY: keep a copy of that somewhere off this server.'}
              </p>
              {sec.dbKey.downloadable && system && (
                <a href="/api/system/dbkey" download="opspoint.dbkey"
                  className="inline-flex items-center w-fit px-3 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-100 dark:bg-gray-800 dark:text-white dark:border-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-700">
                  <Download className="w-4 h-4 mr-2" />Download the key
                </a>
              )}
              <div className="flex items-center gap-2">
                <Checkbox id="setup-key" checked={keyStored} onChange={(e) => setKeyStored(e.target.checked)} disabled={!system} />
                <Label htmlFor="setup-key">The key is stored somewhere off this server</Label>
              </div>
            </>
          )}
        </Part>
      )}
      <Part title="Backups">
        {sec.backups.kind === 'folder' && (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300">OpsPoint copies the database every 6 hours and keeps the last 28 copies. Choose a folder on another drive, so a failed disk doesn't take the backups with it.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <TextInput value={dir} onChange={(e) => { setDir(e.target.value); setDirNote(null) }} aria-label="Backup folder" className="flex-1 min-w-0 font-mono" disabled={!system} />
              <Button size="sm" color="light" onClick={saveDir} disabled={busy || !system || !dir.trim()}>Use this folder</Button>
            </div>
            {dirNote === 'warn' && <Alert color="warning" icon={AlertCircle}>That folder is on the same drive as the database: a failed disk would take both.</Alert>}
            {dirNote === 'ok' && <Alert color="success">Backups go there from the next one on.</Alert>}
          </>
        )}
        {sec.backups.kind === 'provider' && <p className="text-sm text-gray-700 dark:text-gray-300">Your provider keeps point-in-time backups of the database (usually 7 to 35 days: check the database's backup settings in its console).</p>}
        {sec.backups.kind === 'volume' && <p className="text-sm text-gray-700 dark:text-gray-300">Back up the Postgres volume, or point a scheduled pg_dump at a volume or bucket that leaves this host.</p>}
        {sec.backups.kind === 'external' && <p className="text-sm text-gray-700 dark:text-gray-300">The database is Postgres: schedule a pg_dump (scripts/opspoint-backup.sh records each one for the health check) to a disk or bucket that leaves the building.</p>}
        <p className="text-sm text-gray-700 dark:text-gray-300">
          For a copy that outlasts {sec.backups.kind === 'provider' ? 'that window' : 'these backups'} and opens in any OpsPoint (another server, another database), schedule an export:{' '}
          <code className="font-mono text-xs">node server/cli/opspoint.js export --out &lt;folder&gt;</code> writes one encrypted file with every record and photo, and{' '}
          <code className="font-mono text-xs">drill &lt;folder&gt;</code> proves the newest one restores.
        </p>
      </Part>
      <Part title="HTTPS and address">
        {sec.https === 'certificate' && <p className="text-sm text-gray-700 dark:text-gray-300">{sec.tls ? 'OpsPoint serves HTTPS with its own certificate (data/cert.pem).' : 'OpsPoint serves plain HTTP here. Put a proxy with a certificate in front of it (nginx, Caddy, IIS), or add data/cert.pem and data/key.pem, before staff use it over the network.'}</p>}
        {sec.https === 'domain' && <p className="text-sm text-gray-700 dark:text-gray-300">The platform serves HTTPS. To use your own address, add the domain in the platform's console and create the DNS record it shows.</p>}
        {sec.https === 'proxy' && <p className="text-sm text-gray-700 dark:text-gray-300">The proxy container serves HTTPS: set its domain and certificate in the compose file.</p>}
      </Part>
      <Part title="Sign-in">
        <p className="text-sm text-gray-700 dark:text-gray-300">Everyone signs in with their own password; the phone app adds a PIN for quick unlock. Passwords need 8 characters with upper and lower case, a number and a symbol.</p>
      </Part>
      {sec.updates && (
        <Part title="Updates">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-gray-700 dark:text-gray-300">Check for new versions every day (they are never installed without you).</span>
            <ToggleSwitch checked={autoUpdates} label="" aria-label="Check for new versions every day" onChange={setAutoUpdates} disabled={!system} />
          </div>
        </Part>
      )}
    </StepFrame>
  )
}

// ── Phone app ───────────────────────────────────────────────────────────────
export function PhoneStep({ ctx, done, skip }) {
  // The server's own LAN address when this browser is on the server itself.
  const link = ctx.status.phoneUrl || `${window.location.origin}/m`
  return (
    <StepFrame title="Phone app" lead="Staff use OpsPoint on their phones for wellness rounds, the log and alerts. There's nothing to install from a store."
      onSave={done} saveLabel="Done" onSkip={skip} skipLabel="Later">
      <Part title="Open it on a phone">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <QrCode text={link} label="Link to the phone app" className="w-40 h-40 shrink-0" />
          <ol className="space-y-2 text-sm text-gray-700 list-decimal list-inside dark:text-gray-300">
            <li>Scan this with the phone's camera, or open <span className="font-mono">{link}</span>.</li>
            <li>Sign in. It offers to set a PIN, so the next unlock is quicker.</li>
            <li><span className="font-semibold">iPhone:</span> in Safari, tap Share, then “Add to Home Screen”. <span className="font-semibold">Android:</span> in Chrome, tap ⋮, then “Install app”.</li>
            <li>Open More › Alerts, turn alerts on, and tap “Send a test alert”.</li>
          </ol>
        </div>
      </Part>
      <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"><Smartphone className="w-4 h-4" />Alerts on an iPhone need iOS 16.4 or later, from the Home Screen app.</p>
    </StepFrame>
  )
}

// ── HQ (optional) ───────────────────────────────────────────────────────────
export function HqStep({ ctx, done, skip }) {
  const [form, setForm] = useState({ url: '', facility_id: '', api_key: '' })
  const [joined, setJoined] = useState(false)
  const { busy, error, run } = useSave()
  const join = () => run(async () => {
    if (!form.url.trim() || !form.facility_id.trim() || !form.api_key.trim()) throw new Error('HQ gives you all three: its address, this facility\'s ID and a one-time key.')
    await api('/api/central/connect', { method: 'POST', body: { url: form.url.trim(), facility_id: form.facility_id.trim(), api_key: form.api_key.trim() } })
    setJoined(true)
  })
  return (
    <StepFrame title="HQ" lead="Only if your organization runs an OpsPoint HQ for several facilities: it then sees this one's census and pushes updates."
      onSave={joined ? done : undefined} saveLabel="Continue" onSkip={skip} skipLabel={joined ? 'Skip' : 'No HQ: skip'} busy={busy} error={error}>
      {!ctx.hasPerm('admin.system') && <Alert color="warning" icon={AlertCircle}>Joining HQ needs the “System” permission.</Alert>}
      {joined ? <Alert color="success">This facility has joined HQ.</Alert> : (
        <Part title="Join HQ">
          <Field label="HQ address" htmlFor="setup-hq-url"><TextInput id="setup-hq-url" value={form.url} placeholder="https://hq.example.org" onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Facility ID" htmlFor="setup-hq-id"><TextInput id="setup-hq-id" value={form.facility_id} onChange={(e) => setForm((f) => ({ ...f, facility_id: e.target.value }))} /></Field>
            <Field label="Enrollment key" htmlFor="setup-hq-key"><TextInput id="setup-hq-key" type="password" value={form.api_key} placeholder="one-time key from HQ" onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} /></Field>
          </div>
          <div className="flex justify-end"><Button size="sm" onClick={join} disabled={busy || !ctx.hasPerm('admin.system')} isProcessing={busy}>Join HQ</Button></div>
        </Part>
      )}
    </StepFrame>
  )
}
