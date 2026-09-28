import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, ToggleSwitch } from 'flowbite-react'
import { BellRing, Download, LogOut, Monitor, ShieldCheck, Smartphone, Palette, ChevronRight, Contact, Megaphone, KeyRound } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { themeLabel } from '../utils/themes.js'
import { useMobile } from './context.js'
import { api } from './api.js'
import { pushSupport, currentSubscription, enableAlerts, disableAlerts } from './push.js'
import { Card, Initials, ScreenHeader } from './ui.jsx'
import { PinSetupSheet } from './sheets.jsx'
import { unseenAnnouncements } from './model.js'

const ROLE_LABELS = { pa: 'Program Assistant', supervisor: 'Supervisor', admin: 'Administrator', case_manager: 'Case Manager' }

export default function More() {
  const { session, snap, toast, installPrompt, clearInstallPrompt, hasPerm } = useMobile()
  const unseen = unseenAnnouncements(snap)
  const { logout } = useAuth()
  const navigate = useNavigate()
  const support = useMemo(() => pushSupport(), [])
  const [cfg, setCfg] = useState(null)
  const [device, setDevice] = useState({ loading: true, endpoint: null, prefs: {} })
  const [busy, setBusy] = useState(false)
  const [pinOn, setPinOn] = useState(null)   // null while checking
  const [pinSheet, setPinSheet] = useState(false)

  useEffect(() => {
    let cancelled = false
    api('GET', '/api/auth/pin/status')
      .then(s => { if (!cancelled) setPinOn(!!s.mine) })
      .catch(() => { if (!cancelled) setPinOn(false) })
    return () => { cancelled = true }
  }, [])

  async function pinOff() {
    try {
      await api('DELETE', '/api/auth/pin')
      setPinOn(false)
      toast('Quick unlock is off for this phone.', 'ok')
    } catch (e) { toast(`Couldn’t turn it off: ${e.message}`, 'error') }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let config = { enabled: false, types: [] }
      let dev = { loading: false, endpoint: null, prefs: {} }
      try {
        config = await api('GET', '/api/push/config')
        const sub = support.supported ? await currentSubscription() : null
        if (sub) {
          const d = await api('POST', '/api/push/device', { endpoint: sub.endpoint })
          if (d.subscribed) dev = { loading: false, endpoint: sub.endpoint, prefs: d.prefs || {} }
        }
      } catch { /* shown as alerts unavailable */ }
      if (!cancelled) { setCfg(config); setDevice(dev) }
    })()
    return () => { cancelled = true }
  }, [support.supported])

  async function setAlerts(on) {
    setBusy(true)
    try {
      if (on) {
        const r = await enableAlerts(cfg.publicKey)
        setDevice({ loading: false, endpoint: r.endpoint, prefs: r.prefs })
        toast('Alerts are on for this phone.', 'ok')
      } else {
        await disableAlerts()
        setDevice({ loading: false, endpoint: null, prefs: {} })
        toast('Alerts are off for this phone.', 'ok')
      }
    } catch (e) {
      toast(`Couldn’t change alerts: ${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  async function setPref(key, on) {
    const before = device.prefs
    const prefs = { ...before, [key]: on }
    setDevice(d => ({ ...d, prefs }))
    try {
      const r = await api('PUT', '/api/push/prefs', { endpoint: device.endpoint, prefs })
      setDevice(d => ({ ...d, prefs: r.prefs }))
    } catch (e) {
      setDevice(d => ({ ...d, prefs: before }))
      toast(`Not saved: ${e.message}`, 'error')
    }
  }

  async function sendTest() {
    try {
      await api('POST', '/api/push/test', { endpoint: device.endpoint })
      toast('Test alert sent. It should arrive in a few seconds.', 'ok')
    } catch (e) { toast(`Test failed: ${e.message}`, 'error') }
  }

  async function install() {
    installPrompt.prompt()
    await installPrompt.userChoice.catch(() => {})
    clearInstallPrompt()
  }

  async function signOut() {
    setBusy(true)
    await disableAlerts().catch(() => {})   // a signed-out phone gets no alerts
    await logout()
    navigate('/login', { replace: true })
  }

  function classic() {
    try { localStorage.setItem('opspoint-mobile', 'classic') } catch { /* private mode */ }
    window.location.href = '/mobile'
  }

  const on = !!device.endpoint
  const role = ROLE_LABELS[session.role] || session.role || ''

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenHeader
        title="More"
        subtitle={[session.displayName, role].filter(Boolean).join(' · ')}
        right={<Initials name={session.displayName} className="h-10 w-10 text-sm" />}
      />

      <div className="flex flex-col gap-4 px-4">
        <section className="flex flex-col gap-2" aria-labelledby="alerts-h">
          <h2 id="alerts-h" className="px-1 text-xs font-bold tracking-wider text-gray-600 dark:text-gray-400">PUSH ALERTS</h2>
          <AlertsCard
            cfg={cfg} device={device} support={support} on={on} busy={busy}
            onToggle={setAlerts} onPref={setPref} onTest={sendTest}
          />
          <p className="flex items-center gap-1.5 px-1 text-xs text-gray-600 dark:text-gray-400">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            Alerts never include a resident&rsquo;s name or room.
          </p>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="unlock-h">
          <h2 id="unlock-h" className="px-1 text-xs font-bold tracking-wider text-gray-600 dark:text-gray-400">SIGNING IN</h2>
          <Card className="flex items-center gap-3 p-4">
            <KeyRound className="h-6 w-6 shrink-0 text-primary-700 dark:text-primary-300" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-semibold">Unlock with a PIN</span>
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {pinOn
                  ? 'On for this phone. Signing out turns it off.'
                  : 'After the idle sign-out, use a 6-digit PIN instead of your password. Only on this phone.'}
              </span>
            </span>
            {pinOn === true && <Button size="sm" color="light" onClick={pinOff}>Turn off</Button>}
            {pinOn === false && <Button size="sm" onClick={() => setPinSheet(true)}>Set up</Button>}
          </Card>
          <PinSetupSheet open={pinSheet} onClose={() => setPinSheet(false)} onDone={() => setPinOn(true)} />
        </section>

        {installPrompt && !support.standalone && (
          <Card className="flex items-center gap-3 p-4">
            <Smartphone className="h-6 w-6 shrink-0 text-primary-700 dark:text-primary-300" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm">Install OpsPoint on this phone for a full-screen app and alerts.</span>
            <Button size="sm" onClick={install}><Download className="mr-1.5 h-4 w-4" aria-hidden="true" />Install</Button>
          </Card>
        )}

        <Card className="overflow-hidden">
          <Link to="/m/staff" className="flex min-h-[52px] items-center gap-3 border-b border-gray-200 px-4 text-[15px] font-medium last:border-b-0 dark:border-gray-700">
            <Contact className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
            <span className="flex-1">Staff directory</span>
            <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </Link>
          {(hasPerm('broadcast.receive') || hasPerm('broadcast.send')) && (
            <Link to="/m/announcements" className="flex min-h-[52px] items-center gap-3 px-4 text-[15px] font-medium">
              <Megaphone className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
              <span className="flex-1">Announcements</span>
              {unseen > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{unseen} new</span>}
              <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
            </Link>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <Palette className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm">
              Colors follow the facility theme ({themeLabel(snap.facility.theme)}); dark mode follows your phone.
            </span>
          </div>
          <a href="/?desktop=1" className="flex min-h-[52px] items-center gap-3 border-b border-gray-200 px-4 text-[15px] font-medium dark:border-gray-700">
            <Monitor className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
            <span className="flex-1">Desktop view</span>
            <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </a>
          <button type="button" onClick={classic} className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium">
            <Smartphone className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
            <span className="flex-1">Back to the classic mobile page</span>
            <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        </Card>

        <Button color="light" onClick={signOut} disabled={busy} className="w-full">
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </div>
  )
}

function AlertsCard({ cfg, device, support, on, busy, onToggle, onPref, onTest }) {
  if (!cfg || device.loading) return <Card className="p-4 text-sm text-gray-500 dark:text-gray-400">Checking alerts&hellip;</Card>
  if (!cfg.enabled) return <Alert color="gray">Push alerts aren&rsquo;t set up on this server yet.</Alert>
  if (!cfg.types.length) return <Alert color="gray">None of the alerts apply to your account.</Alert>
  if (support.needsInstall) {
    return (
      <Alert color="info">
        To get alerts on an iPhone, add OpsPoint to your Home Screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        Open it from there and turn alerts on.
      </Alert>
    )
  }
  if (!support.supported) return <Alert color="gray">This browser can&rsquo;t receive push alerts.</Alert>
  if (support.permission === 'denied' && !on) {
    return <Alert color="warning">Alerts are blocked for OpsPoint in this browser&rsquo;s settings. Allow notifications there, then come back.</Alert>
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
        <BellRing className="h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300" aria-hidden="true" />
        <span id="alerts-master" className="min-w-0 flex-1 text-[15px] font-semibold">Alerts on this phone</span>
        <ToggleSwitch checked={on} disabled={busy} onChange={onToggle} aria-labelledby="alerts-master" className="py-2.5" />
      </div>
      {on && cfg.types.map(t => (
        <div key={t.key} className="flex items-center gap-3 border-b border-gray-200 px-4 py-2 last:border-b-0 dark:border-gray-700">
          <span className="flex min-w-0 flex-1 flex-col">
            <span id={`alert-${t.key}`} className="text-[15px] font-medium">{t.label}</span>
            <span className="text-xs text-gray-600 dark:text-gray-400">{t.hint}</span>
          </span>
          <ToggleSwitch checked={device.prefs[t.key] !== false} onChange={v => onPref(t.key, v)} aria-labelledby={`alert-${t.key}`} className="py-2.5" />
        </div>
      ))}
      {on && (
        <button type="button" onClick={onTest} className="flex min-h-[48px] w-full items-center justify-center text-sm font-semibold text-primary-700 dark:text-primary-300">
          Send a test alert
        </button>
      )}
    </Card>
  )
}
