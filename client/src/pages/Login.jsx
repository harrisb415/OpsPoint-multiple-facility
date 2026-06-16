import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Button, Label, TextInput } from 'flowbite-react'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'

const VERSION = '2.3.7'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username || !password) { setError('Username and password required.'); return }
    setBusy(true)
    setError('')
    const result = await login(username, password)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    navigate(result.mustChangePw ? '/change-password' : '/', { replace: true })
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-10 bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-sm overflow-hidden bg-white border border-gray-200 shadow-sm rounded-2xl dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
          <img src="/static/icons/icon-192.png" alt="OpsPoint" className="w-16 h-16 rounded-xl shadow-sm" />
          <h1 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">OpsPoint</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Staff Login</p>
          <Badge color="info" className="mt-2">v{VERSION}</Badge>
        </div>
        <div className="h-1 bg-primary-600" />
        <div className="px-6 py-6">
          {error && <Alert color="failure" icon={AlertCircle} className="mb-4">{error}</Alert>}
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
          </form>
        </div>
      </div>
      <p className="mt-6 text-xs text-gray-400">© 2026 OpsPoint · All rights reserved</p>
    </div>
  )
}
