import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, TextInput, Alert } from 'flowbite-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { Field, ErrLine } from '../components/ui.jsx'
import { errOf } from '../api.js'

export default function ChangePassword() {
  const { user, changePassword } = useAuth()
  const navigate = useNavigate()
  const forced = !!user?.must_change_pw
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e?.preventDefault()
    setErr('')
    if (pw.length < 10) { setErr('Password must be at least 10 characters'); return }
    if (pw !== confirm) { setErr('Passwords do not match'); return }
    setBusy(true)
    const r = await changePassword(pw)
    setBusy(false)
    if (!r.ok) { setErr(errOf(r, 'Failed')); return }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex items-center justify-center min-h-full px-4 py-16 bg-gray-50">
      <form onSubmit={submit} className="w-full max-w-md p-6 bg-white border border-gray-200 shadow-sm rounded-xl">
        <h1 className="mb-4 text-lg font-semibold text-gray-900">Change password</h1>
        {forced && (
          <Alert color="warning" className="mb-4">
            You must set a new password before continuing.
          </Alert>
        )}
        <Field label="New password" hint="Minimum 10 characters" className="mb-3">
          <TextInput type="password" value={pw} autoComplete="new-password" autoFocus
            onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password" className="mb-4">
          <TextInput type="password" value={confirm} autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" isProcessing={busy} disabled={busy}>Save password</Button>
          {!forced && <Button color="light" onClick={() => navigate('/')}>Cancel</Button>}
        </div>
        <ErrLine>{err}</ErrLine>
      </form>
    </div>
  )
}
