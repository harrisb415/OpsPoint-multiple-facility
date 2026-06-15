import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from 'flowbite-react'
import {
  LayoutDashboard, Building2, Users, ShieldCheck, Server, Package, Rocket,
  KeyRound, LogOut,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'

const NAV = [
  { to: '/',          label: 'Overview',  Icon: LayoutDashboard, end: true },
  { to: '/facilities', label: 'Facilities', Icon: Building2 },
  { to: '/users',     label: 'Users',     Icon: Users },
  { to: '/admins',    label: 'HQ Admins', Icon: ShieldCheck },
  { to: '/system',    label: 'System',    Icon: Server },
  { to: '/releases',  label: 'Releases',  Icon: Package },
  { to: '/rollout',   label: 'Rollout',   Icon: Rocket },
]

export default function Shell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const doLogout = async () => { await logout(); navigate('/login', { replace: true }) }

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <header className="text-white bg-gradient-to-r from-primary-700 to-primary-900">
        <div className="flex items-center gap-3 px-5 py-3 mx-auto max-w-[1100px]">
          <span className="text-base font-semibold tracking-wide">
            OpsPoint <span className="text-primary-300">·</span> Central
          </span>
          <span className="flex-1" />
          <span className="hidden text-sm text-primary-100 sm:inline">
            {user?.display_name || user?.username}
          </span>
          <Button size="xs" color="light" onClick={() => navigate('/change-password')}>
            <KeyRound className="w-4 h-4 mr-1.5" /> Change password
          </Button>
          <Button size="xs" color="light" onClick={doLogout}>
            <LogOut className="w-4 h-4 mr-1.5" /> Sign out
          </Button>
        </div>
      </header>

      {/* Section nav */}
      <nav className="bg-white border-b border-gray-200">
        <div className="flex flex-wrap gap-1 px-5 py-2 mx-auto max-w-[1100px]">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <Icon className="w-4 h-4" /> {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Page body */}
      <main className="flex-1 w-full px-5 py-6 mx-auto max-w-[1100px]">
        <Outlet />
      </main>
    </div>
  )
}
