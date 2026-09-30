// An invite link (/invite/<token>): the new account's owner sets their own
// password, and is signed in. The link works once; server/modules/users/invites.js.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Spinner, TextInput } from 'flowbite-react'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { Field } from '../components/ui.jsx'

export default function Invite() {
  const { token } = useParams()
  const { refreshSession } = useAuth()
  const navigate = useNavigate()
  const [who, setWho] = useState(null)          // null = loading, false = not usable
  const [gone, setGone] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let off = false
    fetch(`/api/invites/${encodeURIComponent(token)}`, { credentials: 'include' })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (off) return; if (r.ok) setWho(d); else { setWho(false); setGone(d.error || 'This invite link does not work.') } })
      .catch(() => { if (!off) { setWho(false); setGone('No connection to the server.') } })
    return () => { off = true }
  }, [token])

  async function submit(e) {
    e.preventDefault()
    if (pw !== pw2) { setError("The two passwords don't match."); return }
    setBusy(true); setError('')
    try {
      const r = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(d.error || 'That did not work.'); setBusy(false); return }
      await refreshSession()
      navigate('/', { replace: true })
    } catch { setError('No connection to the server.'); setBusy(false) }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-10 bg-gradient-to-br from-rail-top via-rail-mid to-rail-bot dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <div className="w-full max-w-sm overflow-hidden bg-white shadow-2xl rounded-2xl dark:bg-gray-800">
        <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
          <img src="/static/icons/icon-192.png" alt="OpsPoint" className="w-16 h-16 shadow-sm rounded-xl" />
          <h1 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">Welcome to OpsPoint</h1>
          {who && <p className="text-sm text-gray-600 dark:text-gray-400">{who.displayName}, choose your password.</p>}
        </div>
        <div className="h-1 bg-primary-600" />
        <div className="px-6 py-6">
          {who === null && <div className="flex justify-center py-6"><Spinner /></div>}
          {who === false && <Alert color="failure" icon={AlertCircle}>{gone}</Alert>}
          {who && (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-300">Your username is <span className="font-semibold">{who.username}</span>.</p>
              <Field label="Password" htmlFor="invite-pw" hint="8 or more characters: upper and lower case, a number and a symbol.">
                <TextInput id="invite-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus required />
              </Field>
              <Field label="Password again" htmlFor="invite-pw2">
                <TextInput id="invite-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
              </Field>
              {error && <Alert color="failure" icon={AlertCircle}>{error}</Alert>}
              <Button type="submit" className="w-full" disabled={busy} isProcessing={busy}>Set my password and sign in<ArrowRight className="w-4 h-4 ml-2" /></Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
