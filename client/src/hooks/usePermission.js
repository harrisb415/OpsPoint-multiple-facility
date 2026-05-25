import { useAuth } from '../contexts/AuthContext.jsx'

export function usePermission() {
  const { session } = useAuth()
  const hasPerm = (perm) => !!(session?.permissions?.includes(perm))
  const hasAnyPerm = (...perms) => perms.some(p => hasPerm(p))
  return { hasPerm, hasAnyPerm }
}
