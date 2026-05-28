import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

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
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card-top">
          <img
            src="/static/icons/icon-192.png"
            alt="OpsPoint"
            className="auth-app-icon"
          />
          <h1>OpsPoint</h1>
          <div className="auth-sub">Staff Login</div>
        </div>
        <div className="auth-orange-bar" />
        <div className="auth-card-body">
          {error && <div className="auth-error">&#9888; {error}</div>}
          <form onSubmit={handleSubmit} autoComplete="on">
            <div className="auth-field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                name="username"
                autoFocus
                autoComplete="username"
                placeholder="Enter your username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={busy}
              />
            </div>
            <button type="submit" className="auth-btn" disabled={busy}>
              {busy ? 'Signing In…' : 'Sign In →'}
            </button>
          </form>
        </div>
      </div>
      <div className="auth-footer">
        &copy; 2026 OpsPoint v2.0.0 &nbsp;&bull;&nbsp; All rights reserved
        &nbsp;&bull;&nbsp; <Link to="/about">About</Link>
      </div>
    </div>
  )
}
