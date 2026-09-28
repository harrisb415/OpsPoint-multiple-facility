import { NavLink } from 'react-router-dom'
import { House, CircleCheck, ClipboardList, Ellipsis } from 'lucide-react'

// Bottom tab bar, within thumb reach. Residents joins it in the next step.
export default function TabBar({ roundsOn }) {
  const tabs = [
    { to: '/m', end: true, label: 'Home', Icon: House },
    roundsOn && { to: '/m/rounds', label: 'Rounds', Icon: CircleCheck },
    { to: '/m/log', label: 'Log', Icon: ClipboardList },
    { to: '/m/more', label: 'More', Icon: Ellipsis },
  ].filter(Boolean)
  return (
    <nav
      aria-label="Main"
      className={`grid shrink-0 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-gray-700 dark:bg-gray-800 ${tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}
    >
      {tabs.map(({ to, end, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] ${isActive
              ? 'font-bold text-primary-700 dark:text-primary-300'
              : 'font-medium text-gray-500 dark:text-gray-400'}`}
        >
          {({ isActive }) => (
            <>
              <span className={`flex h-8 w-14 items-center justify-center rounded-full ${isActive ? 'bg-primary-100 dark:bg-primary-900' : ''}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
