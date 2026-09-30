// First-run setup (/setup). A new install has no accounts: the one-time setup
// code (printed by the installer, or the server's log) creates the first
// admin, who then walks the steps — each saved as it goes, skippable, and
// resumable after signing in again — and finishes. Afterwards the page is
// gone for good (server/modules/setup).
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Alert, Badge, Button, Checkbox, Label, Spinner, TextInput } from 'flowbite-react'
import { AlertCircle, ArrowRight, Check, KeyRound, SkipForward } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { Field } from '../components/ui.jsx'
import { api } from './setup/setupApi.js'
import {
  StepFrame, FacilityStep, ShiftsStep, RoomsStep, CareStep, FeaturesStep, StaffStep, SecurityStep, PhoneStep, HqStep,
} from './setup/SetupSteps.jsx'

const STEP_VIEWS = {
  facility: FacilityStep, shifts: ShiftsStep, rooms: RoomsStep, care: CareStep, features: FeaturesStep,
  staff: StaffStep, security: SecurityStep, phone: PhoneStep, hq: HqStep,
}

// The page's own scroll box: body scrolling is off app-wide.
function Frame({ children, scrollRef }) {
  return (
    <div ref={scrollRef} className="h-screen overflow-y-auto bg-gradient-to-br from-rail-top via-rail-mid to-rail-bot dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-6xl px-4 py-6 mx-auto sm:px-6 sm:py-10">
        <header className="flex items-center gap-3 mb-6">
          <img src="/static/icons/icon-192.png" alt="" className="w-10 h-10 shadow rounded-xl" />
          <div>
            <p className="text-lg font-bold leading-tight text-white">OpsPoint</p>
            <p className="text-sm text-white/80">Setup</p>
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}
const Card = ({ children }) => (
  <div className="p-5 bg-white shadow-xl rounded-2xl sm:p-8 dark:bg-gray-800 shadow-primary-950/30">{children}</div>
)

export default function Setup() {
  const { session, refreshSession } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [asked, setAsked] = useState(0)         // bump to ask the server again
  useEffect(() => {
    let off = false
    api('/api/setup/status').then((s) => { if (!off) { setStatus(s); setError('') } }, (e) => { if (!off) setError(e.message) })
    return () => { off = true }
  }, [asked, session?.id])

  if (error) return <Frame><Card><Alert color="failure" icon={AlertCircle}>{error}</Alert></Card></Frame>
  if (!status) return <Frame><Card><div className="flex justify-center py-10"><Spinner size="lg" /></div></Card></Frame>
  if (status.state === 'done') return <Navigate to="/" replace />
  if (status.state === 'code') {
    return <Frame><div className="max-w-xl mx-auto"><Card><FirstAdmin expired={status.expired} codeHours={status.codeHours} onCreated={async () => { await refreshSession(); setAsked((n) => n + 1) }} /></Card></div></Frame>
  }
  if (status.signIn) return <Navigate to={session ? '/' : '/login?next=%2Fsetup'} replace />
  return <Wizard status={status} setStatus={setStatus} onFinished={() => navigate('/', { replace: true })} />
}

// ── Step 1: the code and the first admin ────────────────────────────────────
function FirstAdmin({ expired, codeHours, onCreated }) {
  const [f, setF] = useState({ code: '', displayName: '', username: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function submit(e) {
    e.preventDefault()
    if (f.password !== f.confirm) { setError("The two passwords don't match."); return }
    setBusy(true); setError('')
    try {
      await api('/api/setup/account', { method: 'POST', body: { code: f.code, displayName: f.displayName, username: f.username, password: f.password } })
      await onCreated()
    } catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-5" autoComplete="off">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 font-display dark:text-white">Set up OpsPoint</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Enter the setup code from the installer's last screen (or the server's log), and create the first administrator.
          The rest of setup takes about ten minutes, and you can stop and come back.
        </p>
      </div>
      {expired && (
        <Alert color="warning" icon={AlertCircle}>
          There is no working setup code: codes last {codeHours} hours. On the server, run <span className="font-mono">node server/cli/opspoint.js setup-code</span> (or restart OpsPoint) and use the new one.
        </Alert>
      )}
      <Field label="Setup code" htmlFor="setup-code">
        <TextInput id="setup-code" icon={KeyRound} value={f.code} onChange={set('code')} placeholder="XXXX-XXXX" maxLength={12}
          autoCapitalize="characters" spellCheck={false} className="font-mono tracking-widest uppercase" required />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="setup-admin-name">
          <TextInput id="setup-admin-name" value={f.displayName} onChange={set('displayName')} maxLength={80} placeholder="Robin Lee" autoComplete="name" required />
        </Field>
        <Field label="Username" htmlFor="setup-admin-user">
          <TextInput id="setup-admin-user" value={f.username} onChange={set('username')} maxLength={40} placeholder="robin" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="setup-admin-pw" hint="8 or more characters: upper and lower case, a number and a symbol.">
          <TextInput id="setup-admin-pw" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" required />
        </Field>
        <Field label="Password again" htmlFor="setup-admin-pw2">
          <TextInput id="setup-admin-pw2" type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required />
        </Field>
      </div>
      {error && <Alert color="failure" icon={AlertCircle}>{error}</Alert>}
      <Button type="submit" className="w-full" disabled={busy} isProcessing={busy}>
        Create the admin account<ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </form>
  )
}

// ── The steps ───────────────────────────────────────────────────────────────
function StepMark({ state, n, current }) {
  if (state === 'done') return <span className="flex items-center justify-center w-7 h-7 text-white bg-green-600 rounded-full shrink-0"><Check className="w-4 h-4" /></span>
  if (state === 'skipped') return <span className="flex items-center justify-center text-gray-500 bg-gray-200 rounded-full w-7 h-7 shrink-0 dark:bg-gray-600 dark:text-gray-300"><SkipForward className="w-3.5 h-3.5" /></span>
  return <span className={`flex items-center justify-center text-xs font-semibold rounded-full w-7 h-7 shrink-0 ${current ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>{n}</span>
}

function Wizard({ status, setStatus, onFinished }) {
  const { session } = useAuth()
  const perms = session?.permissions || []
  const hasPerm = (p) => perms.includes(p)
  const [settings, setSettings] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [current, setCurrent] = useState(() => (status.steps.find((s) => !s.state && s.id !== 'account') || { id: 'review' }).id)
  const scroller = useRef(null)
  useEffect(() => { api('/api/facility/settings').then(setSettings).catch((e) => setLoadError(e.message)) }, [])
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [current])

  async function saveSettings(patch) {
    const body = { ...settings, ...patch }
    await api('/api/facility/settings', { method: 'PUT', body })
    setSettings(body)
  }
  async function mark(id, state) {
    const r = await api(`/api/setup/steps/${id}`, { method: 'PUT', body: { state } })
    setStatus(r.status)
    const ids = r.status.steps.map((s) => s.id)
    const after = ids.slice(ids.indexOf(id) + 1)
    setCurrent(after.find((sid) => sid === 'review' || !r.status.steps.find((s) => s.id === sid).state) || 'review')
  }
  const ctx = { status, settings, saveSettings, hasPerm }
  const View = STEP_VIEWS[current]
  const doneCount = status.steps.filter((s) => s.state).length

  return (
    <Frame scrollRef={scroller}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Setup steps" className="min-w-0">
          <p className="mb-3 text-sm text-white/80">{doneCount} of {status.steps.length} steps done</p>
          <ol className="flex gap-2 pb-2 overflow-x-auto lg:flex-col lg:overflow-visible lg:pb-0">
            {status.steps.map((s, i) => {
              const on = s.id === current, locked = s.id === 'account'
              return (
                <li key={s.id} className="shrink-0 lg:shrink">
                  <button type="button" disabled={locked} onClick={() => setCurrent(s.id)} aria-current={on ? 'step' : undefined}
                    className={`flex items-center w-full gap-3 px-3 py-2 text-left rounded-xl transition-colors ${on
                      ? 'bg-white text-gray-900 shadow dark:bg-gray-800 dark:text-white'
                      : 'text-white/90 hover:bg-white/10 disabled:hover:bg-transparent'}`}>
                    <StepMark state={s.state} n={i + 1} current={on} />
                    <span className="text-sm font-medium whitespace-nowrap lg:whitespace-normal">{s.title}{s.optional ? ' (optional)' : ''}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
        <main className="min-w-0">
          <Card>
            {loadError && <Alert color="failure" icon={AlertCircle}>{loadError}</Alert>}
            {!loadError && !settings && <div className="flex justify-center py-10"><Spinner size="lg" /></div>}
            {settings && current === 'review' && <Review status={status} hasPerm={hasPerm} goTo={setCurrent} onFinished={onFinished} />}
            {settings && View && <View key={current} ctx={ctx} done={() => mark(current, 'done')} skip={() => mark(current, 'skipped')} />}
          </Card>
        </main>
      </div>
    </Frame>
  )
}

// ── Review and finish ───────────────────────────────────────────────────────
const BAA = {
  azure: { who: 'Microsoft', url: 'https://learn.microsoft.com/azure/compliance/offerings/offering-hipaa-us' },
  aws: { who: 'Amazon Web Services', url: 'https://aws.amazon.com/compliance/hipaa-compliance/' },
  gcp: { who: 'Google Cloud', url: 'https://cloud.google.com/security/compliance/hipaa' },
}
const HEALTH_BADGE = { pass: 'success', warn: 'warning', fail: 'failure', skip: 'gray' }

function Review({ status, hasPerm, goTo, onFinished }) {
  const [health, setHealth] = useState(null)
  const [tick, setTick] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const kind = status.security.compliance
  const baa = BAA[status.profile.name]
  const canCheck = hasPerm('admin.system')
  const [runs, setRuns] = useState(0)
  const [checking, setChecking] = useState(canCheck)
  useEffect(() => {
    if (!canCheck) return undefined
    let off = false
    api('/api/system/health/run', { method: 'POST', body: {} })
      .then((r) => { if (!off) setHealth(r) }, (e) => { if (!off) setError(e.message) })
      .finally(() => { if (!off) setChecking(false) })
    return () => { off = true }
  }, [canCheck, runs])
  const check = () => { setChecking(true); setRuns((n) => n + 1) }

  async function finish() {
    setBusy(true); setError('')
    try { await api('/api/setup/finish', { method: 'POST', body: { compliance: kind } }); onFinished() }
    catch (e) { setError(e.message); setBusy(false) }
  }
  const failing = health ? health.results.filter((r) => r.status === 'fail') : []
  return (
    <StepFrame title="Review and finish" lead="Anything skipped can be done later: the dashboard lists it until it is."
      onSave={finish} saveLabel="Finish setup" busy={busy} error={error} canSave={tick}>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {status.steps.filter((s) => s.id !== 'review').map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-gray-900 dark:text-white">{s.title}</span>
            <span className="flex items-center gap-2">
              <Badge color={s.state === 'done' ? 'success' : s.state === 'skipped' ? 'gray' : 'warning'}>{s.state === 'done' ? 'Done' : s.state === 'skipped' ? 'Skipped' : 'Not yet'}</Badge>
              {s.id !== 'account' && <Button size="xs" color="light" onClick={() => goTo(s.id)}>{s.state ? 'Change' : 'Open'}</Button>}
            </span>
          </li>
        ))}
      </ul>
      <div className="p-4 border border-gray-200 rounded-xl sm:p-5 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Health check</h3>
          {canCheck && <Button size="xs" color="light" onClick={check} disabled={checking} isProcessing={checking}>Run again</Button>}
        </div>
        {!canCheck && <p className="text-sm text-gray-600 dark:text-gray-400">It runs when you finish.</p>}
        {canCheck && !health && <div className="flex justify-center py-4"><Spinner /></div>}
        {health && (
          <ul className="space-y-2">
            {health.results.filter((r) => r.status !== 'skip').map((r) => (
              <li key={r.id} className="flex items-start gap-3">
                <Badge color={HEALTH_BADGE[r.status]} className="shrink-0 w-12 justify-center">{r.status}</Badge>
                <span className="min-w-0 text-sm text-gray-700 dark:text-gray-300"><span className="font-semibold">{r.label}:</span> {r.says}{r.fix && r.status !== 'pass' ? <span className="block text-xs text-gray-500 dark:text-gray-400">{r.fix}</span> : null}</span>
              </li>
            ))}
          </ul>
        )}
        {failing.length > 0 && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">You can finish with failures: the dashboard keeps listing them.</p>}
      </div>
      <div className="flex items-start gap-3 p-4 rounded-xl bg-primary-50 dark:bg-primary-900/20">
        <Checkbox id="setup-compliance" checked={tick} onChange={(e) => setTick(e.target.checked)} className="mt-0.5" />
        <Label htmlFor="setup-compliance" className="text-sm leading-relaxed">
          {kind === 'baa'
            ? <>My organization has signed a Business Associate Agreement with {baa ? baa.who : 'the cloud provider'}{baa && <> (<a href={baa.url} target="_blank" rel="noopener noreferrer" className="font-medium underline text-primary-700 dark:text-primary-300">their HIPAA page</a>)</>}, as HIPAA requires before this install holds resident records.</>
            : <>Backups are copied somewhere outside the building (another site, or an encrypted cloud copy), so a fire or theft doesn't take them with the server.</>}
        </Label>
      </div>
    </StepFrame>
  )
}
