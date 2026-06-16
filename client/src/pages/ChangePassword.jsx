import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Label, TextInput } from 'flowbite-react'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'

export default function ChangePassword() {
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { refreshSession } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!pw1 || !pw2) { setError('Both fields are required.'); return }
    if (pw1 !== pw2) { setError('Passwords do not match.'); return }

    setBusy(true)
    setError('')
    const r = await fetch('/api/force-change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ newPassword: pw1 }),
    })
    const data = await r.json()
    setBusy(false)

    if (data.error) { setError(data.error); return }
    await refreshSession()
    navigate('/', { replace: true })
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-10 bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-sm overflow-hidden bg-white border border-gray-200 shadow-sm rounded-2xl dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
          <p className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase">OpsPoint · Secure Access</p>
          <img src="/static/icons/icon-192.png" alt="OpsPoint" className="w-16 h-16 mt-2 rounded-xl shadow-sm" />
          <h1 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">Change Password</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">You must set a new password before continuing</p>
        </div>
        <div className="h-1 bg-primary-600" />
        <div className="px-6 py-6">
          {error && <Alert color="failure" icon={AlertCircle} className="mb-4">{error}</Alert>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="pw1" className="block mb-1">New Password</Label>
              <TextInput id="pw1" type="password" autoFocus autoComplete="new-password"
                placeholder="Enter new password" value={pw1} onChange={e => setPw1(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label htmlFor="pw2" className="block mb-1">Confirm Password</Label>
              <TextInput id="pw2" type="password" autoComplete="new-password"
                placeholder="Confirm new password" value={pw2} onChange={e => setPw2(e.target.value)} disabled={busy} />
            </div>
            <div className="p-3 text-xs text-gray-500 border border-gray-200 rounded-lg bg-gray-50 dark:bg-gray-700/40 dark:border-gray-700 dark:text-gray-400">
              Password must be at least 8 characters and include:
              <ul className="mt-1 ml-4 list-disc">
                <li>An uppercase letter</li>
                <li>A lowercase letter</li>
                <li>A number</li>
                <li>A symbol (!@#$%^&amp;* etc.)</li>
              </ul>
            </div>
            <Button type="submit" className="w-full" isProcessing={busy} disabled={busy}>
              {busy ? 'Saving…' : <>Set New Password <ArrowRight className="w-4 h-4 ml-2" /></>}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
