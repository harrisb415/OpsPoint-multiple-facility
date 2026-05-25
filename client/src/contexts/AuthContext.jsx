import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { setSession(data || null); setLoading(false) })
      .catch(() => { setSession(null); setLoading(false) })
  }, [])

  const login = useCallback(async (username, password) => {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    })
    const data = await r.json()
    if (!r.ok || data.error) return { ok: false, error: data.error || 'Login failed' }
    // Re-fetch full session (includes permissions)
    const me = await fetch('/api/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null)
    setSession(me)
    return { ok: true, mustChangePw: data.mustChangePw }
  }, [])

  const logout = useCallback(async () => {
    await fetch('/logout', { method: 'POST', credentials: 'include' })
    setSession(null)
  }, [])

  const refreshSession = useCallback(async () => {
    const me = await fetch('/api/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null)
    setSession(me)
  }, [])

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
