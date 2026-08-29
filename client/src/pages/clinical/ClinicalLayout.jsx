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
    <div className="h-full min-h-0 overflow-hidden">
      {/* Clinical rail */}
      <aside className="fixed top-0 left-0 z-40 flex flex-col h-screen w-60 bg-gradient-to-b from-primary-950 via-[#241f52] to-[#2d1b4e] border-r border-primary-950/60 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center gap-2.5 h-16 px-4 border-b shrink-0 border-white/10 dark:border-gray-700">
          <span className="flex items-center justify-center rounded-lg w-9 h-9 bg-gradient-to-br from-primary-400 to-accent-500 text-white dark:from-primary-600 dark:to-accent-600">
            <Stethoscope className="w-5 h-5" />
          </span>
          <div className="leading-tight">
            <p className="font-display text-lg font-semibold tracking-tight text-white">Clinical</p>
            <p className="text-[11px] text-indigo-200/60">Charting &amp; records</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto [scrollbar-color:theme(colors.slate.600)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600 hover:[&::-webkit-scrollbar-thumb]:bg-slate-500">
          {navItems.map(n => {
            const Icon = n.icon
            return (
              <NavLink
                key={n.path}
                to={n.path}
                className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg group ${isActive ? 'bg-gradient-to-r from-primary-500 to-accent-500 text-white shadow-lg shadow-primary-900/40 dark:from-primary-600 dark:to-accent-600' : 'text-indigo-200/80 hover:bg-white/10 hover:text-white dark:text-gray-300 dark:hover:bg-gray-700'}`}
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-indigo-300/70 group-hover:text-white'}`} />
                    <span className="flex-1">{n.label}</span>
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>
        <div className="p-3 border-t shrink-0 border-white/10 dark:border-gray-700">
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center w-full gap-2 px-3 py-2 text-sm font-semibold text-indigo-100 bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 hover:text-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700"
          >
            <ArrowLeft className="w-4 h-4" /> Return to shift
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="h-full ml-60 min-w-0 px-6 py-5 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <Outlet />
      </div>
    </div>
  )
}
