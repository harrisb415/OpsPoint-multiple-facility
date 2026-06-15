import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Spinner } from 'flowbite-react'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import { ConfirmProvider } from './components/ui.jsx'
import Shell from './components/Shell.jsx'
import Login from './pages/Login.jsx'
import ChangePassword from './pages/ChangePassword.jsx'
import Overview from './pages/Overview.jsx'
import Facilities from './pages/Facilities.jsx'
import FacilityDetail from './pages/FacilityDetail.jsx'
import Users from './pages/Users.jsx'
import Admins from './pages/Admins.jsx'
import System from './pages/System.jsx'
import Releases from './pages/Releases.jsx'
import Rollout from './pages/Rollout.jsx'

function Loading() {
  return (
    <div className="flex items-center justify-center min-h-full py-24">
      <Spinner size="xl" />
    </div>
  )
}

// Authenticated app — also bounces users who still owe a password change.
function Protected() {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_pw) return <Navigate to="/change-password" replace />
  return <Outlet />
}

// Change-password is reachable while authenticated (incl. forced state) but not anonymously.
function PwGate() {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace />
  return <ChangePassword />
}

export default function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<PwGate />} />
          <Route element={<Protected />}>
            <Route element={<Shell />}>
              <Route index element={<Overview />} />
              <Route path="facilities" element={<Facilities />} />
              <Route path="facilities/:id" element={<FacilityDetail />} />
              <Route path="users" element={<Users />} />
              <Route path="admins" element={<Admins />} />
              <Route path="system" element={<System />} />
              <Route path="releases" element={<Releases />} />
              <Route path="rollout" element={<Rollout />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ConfirmProvider>
    </AuthProvider>
  )
}
