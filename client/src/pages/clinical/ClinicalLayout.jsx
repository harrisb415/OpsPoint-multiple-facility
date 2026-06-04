import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { CLINICAL_NAV, navItemVisible } from './clinicalShared.jsx'

// /clinical index → redirect to the first section the user can actually use.
export function ClinicalIndexRedirect() {
  const { hasPerm } = usePermission()
  const first = CLINICAL_NAV.find(n => navItemVisible(n, hasPerm))
  return <Navigate to={first ? first.path : '/'} replace />
}

// Secondary navigation rail + content outlet for the clinical charting section.
// Renders inside AppShell's content area (the main tab sidebar is hidden on
// /clinical, mirroring how /admin behaves).
export default function ClinicalLayout() {
  const { session } = useAuth()
  const { hasPerm } = usePermission()
  const navigate    = useNavigate()

  // Auth guard (belt-and-suspenders — route is already behind AuthGuard)
  if (!session) return <Navigate to="/login" replace />

  const navItems = CLINICAL_NAV.filter(n => navItemVisible(n, hasPerm))
  // No clinical access at all → bounce home
  if (navItems.length === 0) return <Navigate to="/" replace />

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Clinical rail */}
      <aside style={{
        width: 220, flexShrink: 0, background: '#fff',
        borderRight: '1px solid var(--line, #e2e8f0)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '16px 16px 10px' }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sidebar-bg, #0a4655)', letterSpacing: '-.01em' }}>
            🏥 Clinical
          </div>
          <div style={{ fontSize: '.72rem', color: '#94a3b8', marginTop: 2 }}>Charting & documentation</div>
        </div>
        <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
          {navItems.map(n => (
            <NavLink
              key={n.path}
              to={n.path}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '9px 12px', marginBottom: 2, borderRadius: 7,
                fontSize: '.85rem', fontWeight: 600, textDecoration: 'none',
                color: isActive ? '#fff' : '#334155',
                background: isActive ? 'var(--teal-600, #106f88)' : 'transparent',
              })}
            >
              <span style={{ fontSize: '1rem' }}>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--line, #e2e8f0)' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              width: '100%', padding: '8px 0', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--line, #cbd5e1)', background: '#f8fafc',
              fontSize: '.8rem', fontWeight: 700, color: '#475569',
            }}
          >← Back to Dashboard</button>
        </div>
      </aside>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px', background: 'var(--bg, #f1f5f9)' }}>
        <Outlet />
      </div>
    </div>
  )
}
