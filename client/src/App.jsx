import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext.jsx'
import { AuthGuard, ChangePasswordGuard } from './components/ProtectedRoute.jsx'
import AppShell from './components/AppShell.jsx'
import Login from './pages/Login.jsx'
import ChangePassword from './pages/ChangePassword.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Admin from './pages/Admin.jsx'
import About from './pages/About.jsx'
import Mobile from './pages/Mobile.jsx'

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-inner">
        <img src="/static/icons/icon-192.png" alt="OpsPoint" className="loading-logo" />
        <div className="loading-text">OpsPoint</div>
      </div>
    </div>
  )
}

// Apply saved theme on startup — OpsPoint is fixed navy/amber
function useThemeInit() {
  useEffect(() => {
    delete document.documentElement.dataset.theme
  }, [])
}

// Detect mobile user agents
function isMobileUA() {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '')
}

// Auto-redirect mobile UAs to /mobile when:
//   - user is logged in
//   - user has mobile.access permission
//   - URL doesn't have ?desktop=1 (Desktop override)
//   - we're not already on /mobile, /login, /change-password, /admin, /about
function MobileAutoRedirect() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!session) return
    if (!isMobileUA()) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('desktop') === '1') return
    const p = location.pathname
    if (p === '/mobile' || p === '/login' || p === '/change-password' || p === '/admin' || p === '/about') return
    if (!session.permissions?.includes('mobile.access')) return // no access → stay on desktop
    navigate('/mobile', { replace: true })
  }, [session, location.pathname, navigate])

  return null
}

// Gate /mobile route — only users with mobile.access permission may visit
function MobileGuard() {
  const { session } = useAuth()
  if (!session) return <Navigate to="/login" replace />
  if (session.mustChangePw) return <Navigate to="/change-password" replace />
  if (!session.permissions?.includes('mobile.access')) return <Navigate to="/" replace />
  return <Mobile />
}

export default function App() {
  const { loading } = useAuth()
  useThemeInit()

  if (loading) return <LoadingScreen />

  return (
    <>
      <MobileAutoRedirect />
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<ChangePasswordGuard />}>
          <Route path="/change-password" element={<ChangePassword />} />
        </Route>

        <Route path="/mobile" element={<MobileGuard />} />

        <Route element={<AuthGuard />}>
          <Route path="/about" element={<About />} />
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
