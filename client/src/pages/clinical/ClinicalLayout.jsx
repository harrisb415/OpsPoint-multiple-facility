import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom'
import { Stethoscope, ArrowLeft } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { CLINICAL_NAV, navItemVisible, isFeatureVisible, clinicalSectionEnabled } from './clinicalShared.jsx'

// ui_visibility off the live data payload. Same shape/parse as AppShell and
// Dashboard — an unset or unparseable value means "everything visible".
function useUiVisibility() {
  const { data } = useData()
  const def = { tabs: {}, buttons: {} }
  if (!data?.ui_visibility) return def
  try { return typeof data.ui_visibility === 'string' ? JSON.parse(data.ui_visibility) : data.ui_visibility }
  catch { return def }
}

// A clinical page is reachable only if the user has the permission AND the
// facility has left both the section and that page switched on in
// Admin → Features.
function usableNav(hasPerm, vis) {
  if (!clinicalSectionEnabled(vis)) return []
  return CLINICAL_NAV.filter(n => navItemVisible(n, hasPerm) && isFeatureVisible(vis, n.key))
}

// /clinical index → redirect to the first section the user can actually use.
export function ClinicalIndexRedirect() {
  const { hasPerm } = usePermission()
  const vis = useUiVisibility()
  const first = usableNav(hasPerm, vis)[0]
  return <Navigate to={first ? first.path : '/'} replace />
}

// Secondary navigation rail + content outlet for the clinical charting section.
// Renders inside AppShell's content area (the main tab sidebar is hidden on
// /clinical, mirroring how /admin behaves).
export default function ClinicalLayout() {
  const { session } = useAuth()
  const { hasPerm } = usePermission()
  const navigate    = useNavigate()
  const vis         = useUiVisibility()   // must run before any early return

  // Auth guard (belt-and-suspenders — route is already behind AuthGuard)
  if (!session) return <Navigate to="/login" replace />

  const navItems = usableNav(hasPerm, vis)
  // Section switched off in Admin → Features, or no clinical access at all.
  // Guards the direct-URL path, not just the hidden sidebar button.
  if (navItems.length === 0) return <Navigate to="/" replace />

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Clinical rail */}
      <aside className="flex flex-col bg-white border-r border-gray-200 shrink-0 w-60 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center gap-2.5 h-16 px-4 border-b shrink-0 border-gray-200 dark:border-gray-700">
          <span className="flex items-center justify-center rounded-lg w-9 h-9 bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
            <Stethoscope className="w-5 h-5" />
          </span>
          <div className="leading-tight">
            <p className="text-base font-bold text-gray-900 dark:text-white">Clinical</p>
            <p className="text-[11px] text-gray-400">Charting &amp; records</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {navItems.map(n => {
            const Icon = n.icon
            return (
              <NavLink
                key={n.path}
                to={n.path}
                className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg group ${isActive ? 'bg-primary-50 text-primary-700 dark:bg-gray-700 dark:text-white' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`w-5 h-5 ${isActive ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 group-hover:text-gray-700 dark:group-hover:text-white'}`} />
                    <span className="flex-1">{n.label}</span>
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>
        <div className="p-3 border-t shrink-0 border-gray-200 dark:border-gray-700">
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center w-full gap-2 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700"
          >
            <ArrowLeft className="w-4 h-4" /> Return to shift
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 px-6 py-5 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <Outlet />
      </div>
    </div>
  )
}
