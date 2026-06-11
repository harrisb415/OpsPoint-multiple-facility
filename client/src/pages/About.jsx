import { Link } from 'react-router-dom'

const VERSION = '2.3.6'

const STACK = [
  'React 19', 'React Router v7', 'Vite', 'Node.js',
  'Express', 'SQLite (better-sqlite3)', 'WebSocket (ws)', 'PBKDF2-SHA512',
]

const FEATURES = [
  { icon: '📋', title: 'Shift Reports',    desc: 'Resident statuses, log entries, issues, medical notes.' },
  { icon: '📡', title: 'Real-time Sync',   desc: 'WebSocket broadcast — desktop and mobile stay in sync.' },
  { icon: '📱', title: 'Mobile Interface', desc: 'Responsive mobile UI for phones on the local network.' },
  { icon: '👥', title: 'Staff Directory',  desc: 'Categorized contacts with phone numbers and notes.' },
  { icon: '🧹', title: 'Chore Tracking',   desc: 'Assign and log daily chore completions per resident.' },
  { icon: '🚪', title: 'Weekend Passes',   desc: 'Departure/return tracking with UA notes.' },
  { icon: '📬', title: 'Mail Log',         desc: 'Incoming mail with approve and deliver workflow.' },
  { icon: '🧪', title: 'UA Module',        desc: 'Random draw, request system, witnessed results, photo COC.' },
  { icon: '🏥', title: 'HIPAA Clinical',   desc: 'UA records, milestones, incidents, discharge, 42 CFR Part 2.' },
  { icon: '🔒', title: 'Secure',           desc: 'CSRF, rate limiting, session fixation prevention, audit log.' },
]

export default function About() {
  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg)' }}>

      {/* Hero */}
      <div style={{
        background: 'var(--dark)', padding: '24px 28px 20px', textAlign: 'center',
        borderBottom: '3px solid var(--orange)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
      }}>
        <img
          src="/static/icons/icon-192.png"
          alt="OpsPoint"
          style={{ width: 48, height: 48, borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.4)', flexShrink: 0 }}
        />
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: '1.6rem', fontWeight: 700, color: '#fff', letterSpacing: '-.02em', lineHeight: 1.1 }}>
            <span style={{ color: 'var(--orange)' }}>O</span>psPoint
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{
              background: 'rgba(249,115,22,.18)', color: 'var(--orange)',
              fontSize: '.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              border: '1px solid rgba(249,115,22,.35)', letterSpacing: '.06em',
            }}>v{VERSION}</span>
            <span style={{ color: 'rgba(255,255,255,.45)', fontSize: '.8rem' }}>Shift management for residential facilities</span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 20px 48px' }}>

        {/* Description */}
        <div style={{
          background: '#fff', borderRadius: 8, padding: '14px 18px', marginBottom: 20,
          border: '1px solid var(--line)', borderLeft: '4px solid var(--sidebar-bg)',
        }}>
          <p style={{ fontSize: '.88rem', color: '#1e293b', lineHeight: 1.65, margin: 0 }}>
            <strong>OpsPoint</strong> is an operations and compliance platform built for residential treatment facilities.
            It centralizes shift documentation, resident tracking, and clinical record-keeping into a single system
            accessible from any device on the facility network.
          </p>
          <p style={{ fontSize: '.84rem', color: '#475569', lineHeight: 1.65, margin: '10px 0 0' }}>
            Staff log shift activity, track resident statuses, manage passes and mail, conduct and record UA tests,
            and document behavioral incidents — all in real time. Supervisors and case managers have role-based access
            to clinical records, milestone tracking, 42 CFR Part 2 consent management, and a full audit trail.
            Permissions are fully configurable per user and group.
          </p>
        </div>

        {/* Features */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: '.68rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
            color: 'var(--crimson)', marginBottom: 10, paddingBottom: 5,
            borderBottom: '2px solid var(--line)',
          }}>Features</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
            {FEATURES.map(f => (
              <div key={f.title} style={{
                background: '#fff', borderRadius: 8, padding: '10px 12px',
                border: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '.81rem', marginBottom: 2 }}>{f.title}</div>
                  <div style={{ fontSize: '.74rem', color: 'var(--steel)', lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tech stack + build info row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'start', marginBottom: 20 }}>
          <div>
            <div style={{
              fontSize: '.68rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
              color: 'var(--crimson)', marginBottom: 8, paddingBottom: 5,
              borderBottom: '2px solid var(--line)',
            }}>Stack</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {STACK.map(s => (
                <span key={s} style={{
                  background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 20,
                  padding: '3px 10px', fontSize: '.74rem', fontWeight: 600, color: '#0F172A',
                }}>{s}</span>
              ))}
            </div>
          </div>
          <div style={{
            background: '#fff', borderRadius: 8, padding: '10px 16px',
            border: '1px solid var(--line)', whiteSpace: 'nowrap',
          }}>
            {[
              { label: 'Version', value: `v${VERSION}` },
              { label: 'Edition', value: 'Vite + Express' },
            ].map(({ label, value }) => (
              <div key={label} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: '.62rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#94A3B8' }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: '.82rem' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <Link to="/" style={{
            color: 'var(--crimson)', fontWeight: 700, fontSize: '.84rem',
            textDecoration: 'none', padding: '6px 16px',
            border: '1.5px solid var(--crimson)', borderRadius: 6,
            display: 'inline-block',
          }}>← Back to Shift Report</Link>
        </div>
      </div>
    </div>
  )
}
