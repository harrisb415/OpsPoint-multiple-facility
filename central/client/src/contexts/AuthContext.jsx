import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from '../api.js'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const r = await api('/api/me')
    setUser(r.ok ? r.body : null)
    setLoading(false)
    return r.ok ? r.body : null
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = useCallback(async (username, password) => {
    const r = await api('/login', { method: 'POST', body: { username, password } })
    if (r.ok) setUser(r.body.user)
    return r
  }, [])

  const logout = useCallback(async () => {
    await api('/logout', { method: 'POST' })
    setUser(null)
  }, [])

  const changePassword = useCallback(async (password) => {
    const r = await api('/api/me/password', { method: 'POST', body: { password } })
    if (r.ok) await refresh()
    return r
  }, [refresh])

  return (
    <AuthCtx.Provider value={{ user, loading, refresh, login, logout, changePassword }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
