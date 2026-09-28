import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Button, Label, TextInput } from 'flowbite-react'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import PinPad from '../components/PinPad.jsx'

const VERSION = '2.6.1'

// ?next= (set by the /m pages) brings the installed app back where it was.
// Same-site paths only: never '//host', which would leave the site.
function destination() {
  const next = new URLSearchParams(window.location.search).get('next') || ''
  return /^\/(?![/\\])/.test(next) && !next.startsWith('/login') ? next : '/'
}

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Quick unlock: 'checking', then { name } when this phone has a PIN, else null
  const [pin, setPin] = useState('checking')
  const [usePassword, setUsePassword] = useState(false)
  const { login, refreshSession } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const stored = localStorage.getItem('opspoint-theme')
    if (stored) {
      document.documentElement.classList.toggle('dark', stored === 'dark')
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (e) => document.documentElement.classList.toggle('dark', e.matches)
    apply(mq)
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/pin/status', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(s => { if (!cancelled) setPin(s?.available ? { name: s.name } : null) })
      .catch(() => { if (!cancelled) setPin(null) })
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username || !password) { setError('Username and password required.'); return }
    setBusy(true)
    setError('')
    const result = await login(username, password)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    navigate(result.mustChangePw ? '/change-password' : destination(), { replace: true })
  }

  async function unlock(code) {
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/auth/pin/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pin: code }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(data.error || 'Unlock failed.')
        if (data.gone) setPin(null)   // switched off: back to the password
        setBusy(false)
        return
      }
      await refreshSession()
      navigate(data.mustChangePw ? '/change-password' : destination(), { replace: true })
    } catch {
      setError('No connection to the server.')
      setBusy(false)
    }
  }

  const pinMode = pin && pin !== 'checking' && !usePassword
  const switchTo = (toPassword) => { setUsePassword(toPassword); setError('') }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-10 bg-gradient-to-br from-rail-top via-rail-mid to-rail-bot dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <div className="w-full max-w-sm overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-primary-100 border border-white/60 shadow-2xl shadow-primary-950/40 ring-1 ring-white/50 rounded-2xl dark:from-gray-800 dark:via-gray-800 dark:to-gray-800 dark:border-gray-700 dark:ring-0">
        <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
          <img src="/static/icons/icon-192.png" alt="OpsPoint" className="w-16 h-16 rounded-xl shadow-sm" />
          <h1 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">OpsPoint</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{pinMode ? 'Quick unlock' : 'Staff Login'}</p>
          <Badge color="info" className="mt-2">v{VERSION}</Badge>
        </div>
        <div className="h-1 bg-primary-600" />
        <div className="px-6 py-6">
          {error && <Alert color="failure" icon={AlertCircle} className="mb-4">{error}</Alert>}
          {pin === 'checking' && <div className="h-64" aria-busy="true" />}
          {pinMode && (
            <div className="flex flex-col items-center gap-5">
              <p className="text-center">
                <span className="block text-lg font-bold text-gray-900 dark:text-white">Welcome back, {pin.name}</span>
                <span className="block text-sm text-gray-600 dark:text-gray-400">Enter your PIN to unlock.</span>
              </p>
              <PinPad onComplete={unlock} busy={busy} label="PIN" />
              <button type="button" onClick={() => switchTo(true)} className="min-h-11 px-3 text-sm font-semibold text-primary-700 dark:text-primary-300">
                Use my password instead
              </button>
            </div>
          )}
          {pin !== 'checking' && !pinMode && (
            <form onSubmit={handleSubmit} autoComplete="on" className="space-y-4">
              <div>
                <Label htmlFor="username" className="block mb-1">Username</Label>
                <TextInput id="username" name="username" autoFocus autoComplete="username"
                  placeholder="Enter your username" value={username}
                  onChange={e => setUsername(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label htmlFor="password" className="block mb-1">Password</Label>
                <TextInput id="password" name="password" type="password" autoComplete="current-password"
                  placeholder="Enter your password" value={password}
                  onChange={e => setPassword(e.target.value)} disabled={busy} />
              </div>
              <Button type="submit" className="w-full" isProcessing={busy} disabled={busy}>
                {busy ? 'Signing In…' : <>Sign In <ArrowRight className="w-4 h-4 ml-2" /></>}
              </Button>
              {pin && (
                <button type="button" onClick={() => switchTo(false)} className="block w-full min-h-11 text-sm font-semibold text-primary-700 dark:text-primary-300">
                  Unlock with my PIN
                </button>
              )}
            </form>
          )}
        </div>
      </div>
      <p className="mt-6 text-xs text-gray-400">© 2026 OpsPoint · All rights reserved</p>
    </div>
  )
}
