import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, TextInput } from 'flowbite-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { Field, ErrLine } from '../components/ui.jsx'
import { errOf } from '../api.js'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e?.preventDefault()
    setErr(''); setBusy(true)
    const r = await login(username, password)
    setBusy(false)
    if (!r.ok) { setErr(errOf(r, 'Sign in failed')); return }
    setPassword('')
    navigate(r.body?.user?.must_change_pw ? '/change-password' : '/', { replace: true })
  }

  return (
    <div className="flex items-center justify-center min-h-full px-4 py-16 bg-gray-50">
      <form onSubmit={submit} className="w-full max-w-sm p-6 bg-white border border-gray-200 shadow-sm rounded-xl">
        <div className="mb-5 text-center">
          <h1 className="text-lg font-semibold text-gray-900">OpsPoint Central</h1>
          <p className="text-sm text-gray-500">HQ sign in</p>
        </div>
        <Field label="Username" className="mb-3">
          <TextInput value={username} autoComplete="username" autoFocus
            onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password" className="mb-4">
          <TextInput type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" isProcessing={busy} disabled={busy}>Sign in</Button>
        <ErrLine>{err}</ErrLine>
      </form>
    </div>
  )
}
