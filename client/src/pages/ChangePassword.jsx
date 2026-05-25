import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card-top">
          <div className="auth-org">OpsPoint &bull; Secure Access</div>
          <img src="/static/icons/icon-192.png" alt="OpsPoint" className="auth-app-icon" />
          <h1>Change Password</h1>
          <div className="auth-sub">You must set a new password before continuing</div>
        </div>
        <div className="auth-orange-bar" />
        <div className="auth-card-body">
          {error && <div className="auth-error">&#9888; {error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="pw1">New Password</label>
              <input
                id="pw1"
                type="password"
                autoFocus
                autoComplete="new-password"
                placeholder="Enter new password"
                value={pw1}
                onChange={e => setPw1(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="pw2">Confirm Password</label>
              <input
                id="pw2"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                value={pw2}
                onChange={e => setPw2(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="pw-rules">
              Password must be at least 8 characters and include:
              <ul>
                <li>An uppercase letter</li>
                <li>A lowercase letter</li>
                <li>A number</li>
                <li>A symbol (!@#$%^&amp;* etc.)</li>
              </ul>
            </div>
            <button type="submit" className="auth-btn" disabled={busy} style={{ marginTop: 16 }}>
              {busy ? 'Saving…' : 'Set New Password →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
