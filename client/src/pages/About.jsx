import { Link } from 'react-router-dom'

const VERSION = '2.0.0'

const STACK = [
  'React 19', 'React Router v7', 'Vite', 'Node.js', 'Express',
  'SQLite (better-sqlite3)', 'WebSocket (ws)', 'PBKDF2-SHA512',
]

const FEATURES = [
  { icon: '📋', title: 'Shift Reports', desc: 'Create and manage shift reports with resident statuses, log entries, issues, and medical notes.' },
  { icon: '📡', title: 'Real-time Sync', desc: 'WebSocket broadcast keeps all connected clients in sync instantly — desktop and mobile.' },
  { icon: '📱', title: 'Mobile Interface', desc: 'Responsive mobile UI for status updates from phones on the local network.' },
  { icon: '👥', title: 'Staff Directory', desc: 'Categorized staff contacts with phone numbers and notes.' },
  { icon: '🧹', title: 'Chore Tracking', desc: 'Assign and log daily chore completions per resident.' },
  { icon: '🚪', title: 'Weekend Passes', desc: 'Track resident passes with departure/return dates and UA notes.' },
  { icon: '📬', title: 'Mail Log', desc: 'Track incoming mail with approval and delivery workflow.' },
  { icon: '🧪', title: 'UA Requests', desc: 'Flag residents for urinalysis with real-time banner alerts.' },
  { icon: '🔒', title: 'Secure', desc: 'PBKDF2-SHA512 passwords, CSRF protection, session fixation prevention, and rate limiting.' },
]

export default function About() {
  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
      {/* Hero */}
      <div style={{
        background: 'var(--dark)', padding: '48px 28px', textAlign: 'center',
        borderBottom: '3px solid var(--orange)',
      }}>
        <img
          src="/static/icons/icon-192.png"
          alt="OpsPoint"
          style={{ width: 80, height: 80, borderRadius: 18, marginBottom: 16, boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}
        />
        <div style={{
          fontFamily: 'Libre Baskerville, serif', fontSize: '2.2rem', fontWeight: 700,
          color: '#fff', letterSpacing: '-.02em', marginBottom: 8,
        }}>
          <span style={{ color: 'var(--orange)' }}>O</span>psPoint
        </div>
        <div style={{
          display: 'inline-block', background: 'rgba(212,160,23,.2)', color: 'var(--orange)',
          fontSize: '.75rem', fontWeight: 700, padding: '4px 12px', borderRadius: 20,
          border: '1px solid rgba(212,160,23,.35)', letterSpacing: '.06em', marginBottom: 14,
        }}>
          v{VERSION} — React Edition
        </div>
        <div style={{ color: 'rgba(255,255,255,.55)', fontSize: '1rem', maxWidth: 520, margin: '0 auto' }}>
          Shift management platform for residential facilities.
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 24px 80px' }}>
        {/* Features */}
        <div style={{ marginBottom: 40 }}>
          <div style={{
            fontSize: '.72rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
            color: 'var(--crimson)', marginBottom: 14, paddingBottom: 6,
            borderBottom: '2px solid var(--line)',
          }}>
            Features
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {FEATURES.map(f => (
              <div key={f.title} style={{
                background: '#fff', borderRadius: 10, padding: '16px 18px',
                border: '1px solid var(--line)',
              }}>
                <div style={{ fontSize: '1.4rem', marginBottom: 8 }}>{f.icon}</div>
                <div style={{ fontWeight: 700, fontSize: '.88rem', marginBottom: 4 }}>{f.title}</div>
                <div style={{ fontSize: '.8rem', color: 'var(--steel)', lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tech stack */}
        <div style={{ marginBottom: 40 }}>
          <div style={{
            fontSize: '.72rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
            color: 'var(--crimson)', marginBottom: 14, paddingBottom: 6,
            borderBottom: '2px solid var(--line)',
          }}>
            Technology Stack
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {STACK.map(s => (
              <span key={s} style={{
                background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 20,
                padding: '5px 13px', fontSize: '.78rem', fontWeight: 600, color: '#0F172A',
              }}>
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Build info */}
        <div style={{
          background: '#fff', borderRadius: 10, padding: '16px 20px',
          border: '1px solid var(--line)', marginBottom: 24,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16,
        }}>
          {[
            { label: 'Version', value: `v${VERSION}` },
            { label: 'Edition', value: 'React (Vite + Express)' },
            { label: 'Support', value: 'Contact your system administrator' },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: '.68rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: 4 }}>{label}</div>
              <div style={{ fontWeight: 700, fontSize: '.88rem' }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center' }}>
          <Link
            to="/"
            style={{
              color: 'var(--crimson)', fontWeight: 700, fontSize: '.88rem',
              textDecoration: 'none', padding: '8px 20px',
              border: '1.5px solid var(--crimson)', borderRadius: 6,
              transition: 'all .15s', display: 'inline-block',
            }}
          >
            ← Back to Shift Report
          </Link>
        </div>
      </div>
    </div>
  )
}
