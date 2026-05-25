import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

// Requires auth; redirects must-change-pw users to /change-password
export function AuthGuard() {
  const { session } = useAuth()
  if (!session) return <Navigate to="/login" replace />
  if (session.mustChangePw) return <Navigate to="/change-password" replace />
  return <Outlet />
}

// Requires auth but allows must-change-pw state (for the /change-password page itself)
export function ChangePasswordGuard() {
  const { session } = useAuth()
  if (!session) return <Navigate to="/login" replace />
  if (!session.mustChangePw) return <Navigate to="/" replace />
  return <Outlet />
}
