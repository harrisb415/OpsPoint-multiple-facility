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

// Requires the named permission(s). Use as a route wrapper.
//   <Route element={<PermGuard perm="admin.users" />}>...</Route>
// or with multiple perms (any-of):
//   <Route element={<PermGuard perms={['x','y']} />}>...</Route>
export function PermGuard({ perm, perms }) {
  const { session } = useAuth()
  if (!session) return <Navigate to="/login" replace />
  const userPerms = session.permissions || []
  const required = perm ? [perm] : (perms || [])
  if (required.length === 0) return <Outlet />
  const ok = required.some(p => userPerms.includes(p))
  if (!ok) return <Navigate to="/" replace />
  return <Outlet />
}
