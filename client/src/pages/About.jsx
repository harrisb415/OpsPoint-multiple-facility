import { Link } from 'react-router-dom'

const VERSION = '2.3.7'

const STACK = [
  'React 19', 'React Router v7', 'Vite', 'Node.js',
  'Express', 'SQLite (better-sqlite3)', 'WebSocket (ws)', 'PBKDF2-SHA512',
]

const DEPLOY = [
  {
    icon: '🖥',
    title: 'Local (On-Premise)',
    desc: 'Runs on Windows or Linux hardware at the facility. Staff access via LAN. Optional self-signed TLS certificate.',
  },
  {
    icon: '☁',
    title: 'Cloud (Self-Hosted)',
    desc: 'Hosted on a VPS or cloud server. nginx handles TLS termination with a Let\'s Encrypt certificate. Accessible from anywhere over HTTPS.',
  },
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

const SECTION_HDR = 'text-[.68rem] font-bold tracking-[.12em] uppercase text-[var(--crimson)] mb-[10px] pb-[5px] border-b-2 border-[var(--line)]'

export default function About() {
  return (
    <div className="h-screen overflow-y-auto bg-[var(--bg)] dark:bg-gray-900">

      {/* Hero */}
      <div className="bg-[var(--dark)] px-7 pt-6 pb-5 border-b-[3px] border-[var(--orange)] flex items-center justify-center gap-4">
        <img
          src="/static/icons/icon-192.png"
          alt="OpsPoint"
          className="w-12 h-12 rounded-xl shadow-[0_2px_12px_rgba(0,0,0,.4)] shrink-0"
        />
        <div className="text-left">
          <div className="font-sans text-[1.6rem] font-bold text-white tracking-[-0.02em] leading-[1.1]">
            <span className="text-[var(--orange)]">O</span>psPoint
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="bg-[rgba(249,115,22,.18)] text-[var(--orange)] text-[.68rem] font-bold px-2 py-[2px] rounded-full border border-[rgba(249,115,22,.35)] tracking-[.06em]">
              v{VERSION}
            </span>
            <span className="text-[rgba(255,255,255,.45)] text-[.8rem]">Shift management for residential facilities</span>
          </div>
        </div>
      </div>

      <div className="max-w-[760px] mx-auto px-5 pt-5 pb-12">

        {/* Description */}
        <div className="bg-white dark:bg-gray-800 rounded-lg px-[18px] py-[14px] mb-5 border border-[var(--line)] border-l-4 border-l-[var(--sidebar-bg)]">
          <p className="text-[.88rem] text-gray-900 dark:text-gray-100 leading-[1.65] m-0">
            <strong>OpsPoint</strong> is an operations and compliance platform built for residential treatment facilities.
            It centralizes shift documentation, resident tracking, and clinical record-keeping into a single system —
            deployable on-premise at the facility or self-hosted on a cloud server.
          </p>
          <p className="text-[.84rem] text-gray-500 dark:text-gray-400 leading-[1.65] mt-[10px] mb-0">
            Staff log shift activity, track resident statuses, manage passes and mail, conduct and record UA tests,
            and document behavioral incidents — all in real time. Supervisors and case managers have role-based access
            to clinical records, milestone tracking, 42 CFR Part 2 consent management, and a full audit trail.
            Permissions are fully configurable per user and group.
          </p>
        </div>

        {/* Deployment */}
        <div className="mb-5">
          <div className={SECTION_HDR}>Deployment</div>
          <div className="grid [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))] gap-2">
            {DEPLOY.map(d => (
              <div key={d.title} className="bg-white dark:bg-gray-800 rounded-lg px-3 py-[10px] border border-[var(--line)] flex gap-[10px] items-start">
                <span className="text-[1.1rem] shrink-0 mt-[1px]">{d.icon}</span>
                <div>
                  <div className="font-bold text-[.81rem] mb-[2px] text-gray-900 dark:text-gray-100">{d.title}</div>
                  <div className="text-[.74rem] text-[var(--steel)] leading-[1.4]">{d.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <div className="mb-5">
          <div className={SECTION_HDR}>Features</div>
          <div className="grid [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))] gap-2">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-white dark:bg-gray-800 rounded-lg px-3 py-[10px] border border-[var(--line)] flex gap-[10px] items-start">
                <span className="text-[1.1rem] shrink-0 mt-[1px]">{f.icon}</span>
                <div>
                  <div className="font-bold text-[.81rem] mb-[2px] text-gray-900 dark:text-gray-100">{f.title}</div>
                  <div className="text-[.74rem] text-[var(--steel)] leading-[1.4]">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tech stack + build info row */}
        <div className="grid grid-cols-[1fr_auto] gap-4 items-start mb-5">
          <div>
            <div className={SECTION_HDR}>Stack</div>
            <div className="flex flex-wrap gap-[6px]">
              {STACK.map(s => (
                <span key={s} className="bg-[var(--bg)] dark:bg-gray-700 border border-[var(--line)] rounded-full px-[10px] py-[3px] text-[.74rem] font-semibold text-slate-900 dark:text-gray-100">
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg px-4 py-[10px] border border-[var(--line)] whitespace-nowrap">
            {[
              { label: 'Version', value: `v${VERSION}` },
              { label: 'Edition', value: 'Vite + Express' },
            ].map(({ label, value }) => (
              <div key={label} className="mb-[6px] last:mb-0">
                <div className="text-[.62rem] font-bold tracking-[.08em] uppercase text-slate-400">{label}</div>
                <div className="font-bold text-[.82rem] text-gray-900 dark:text-gray-100">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center">
          <Link
            to="/"
            className="text-[var(--crimson)] font-bold text-[.84rem] no-underline px-4 py-[6px] border-[1.5px] border-[var(--crimson)] rounded-md inline-block hover:bg-[var(--crimson)]/10 transition-colors"
          >
            ← Back to Shift Report
          </Link>
        </div>
      </div>
    </div>
  )
}
