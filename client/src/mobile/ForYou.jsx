import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Ticket, FlaskConical, Ban, Mail, SquareCheck, Flag, FileWarning, ShieldCheck, HeartPulse,
  ChevronRight, Shuffle, Megaphone, CircleCheck,
} from 'lucide-react'
import { useMobile } from './context.js'
import { api } from './api.js'
import { useNow } from './useSnapshot.js'
import { Card, SectionTitle } from './ui.jsx'
import { InfractionReviewSheet, LogInfractionSheet, UaDrawSheet } from './sheets.jsx'
import { initials } from '../utils/ui.js'
import { fmtDay, parseWhen } from '../utils/dates.js'
import { fmtClock } from './schedule.js'
import { fmtBack } from './model.js'

const TONES = {
  red: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
  brand: 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200',
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
}

const words = (s) => {
  const t = String(s || '').replace(/[_,-]+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}
const at = (v) => { const d = parseWhen(v); return d ? fmtClock(d) : '' }

// What this person can act on now, most urgent first. Built on the server
// from their permissions (snapshot.todo); every button here is an endpoint
// the desktop already uses.
export default function ForYou() {
  const { snap, session, toast, reload } = useMobile()
  const todo = snap.todo || {}
  const [busy, setBusy] = useState(null)
  const [reviewing, setReviewing] = useState(null)
  const now = useNow(60000).getTime()   // re-checks "late back" each minute

  if (!Object.keys(todo).length) return null

  async function act(key, method, url, body, done) {
    setBusy(key)
    try {
      await api(method, url, body)
      toast(done, 'ok')
      await reload()
    } catch (e) { toast(`Not saved: ${e.message}`, 'error') }
    finally { setBusy(null) }
  }

  const rows = []
  for (const p of todo.pass_due || []) {
    const late = (parseWhen(p.return_date)?.getTime() ?? Infinity) < now
    rows.push({
      key: `pd${p.id}`, Icon: Ticket, tone: late ? 'red' : 'amber', to: `/m/residents/${p.client_id}`,
      title: late ? `${p.name} is late back` : `${p.name} due back ${fmtBack(p.return_date)}`,
      detail: `Rm ${p.room}${late ? ` · was due ${fmtBack(p.return_date)}` : ' · on pass'}`,
      action: { label: 'Returned', run: () => act(`pd${p.id}`, 'PUT', `/api/passes/${p.id}`, { status: 'Returned' }, `${p.name} marked returned.`) },
    })
  }
  for (const u of todo.ua || []) {
    const name = u.is_interview ? (u.interview_name || 'Interview') : u.client_name
    rows.push({
      key: `ua${u.id}`, Icon: FlaskConical, tone: 'brand', to: u.client_id ? `/m/residents/${u.client_id}` : null,
      title: `UA requested · ${name}`,
      detail: [u.room && `Rm ${u.room}`, u.requested_by && `by ${u.requested_by}`, at(u.requested_at)].filter(Boolean).join(' · '),
      action: { label: 'Acknowledge', run: () => act(`ua${u.id}`, 'POST', `/api/ua-requests/${u.id}/acknowledge`, {}, 'UA request acknowledged.') },
    })
  }
  for (const v of todo.infractions || []) {
    rows.push({
      key: `iv${v.id}`, Icon: Ban, tone: 'orange', to: `/m/residents/${v.client_id}`,
      title: `Review infraction · ${v.client_name}`,
      detail: [v.description, v.violation_date && fmtDay(v.violation_date), (v.staff_name || v.logged_by) && `by ${v.staff_name || v.logged_by}`].filter(Boolean).join(' · '),
      action: { label: 'Review', run: () => setReviewing(v) },
    })
  }
  for (const v of todo.consequences || []) {
    rows.push({
      key: `cq${v.id}`, Icon: Ban, tone: 'orange', to: `/m/residents/${v.client_id}`,
      title: `Consequence · ${v.client_name}`,
      detail: [v.consequence, v.consequence_by && `assigned by ${v.consequence_by}`].filter(Boolean).join(' · '),
      action: v.can_complete ? { label: 'Done', run: () => act(`cq${v.id}`, 'PUT', `/api/violations/${v.id}/complete`, {}, 'Consequence marked done.') } : null,
    })
  }
  for (const p of todo.pass_leaving || []) {
    rows.push({
      key: `pl${p.id}`, Icon: Ticket, tone: 'gray', to: `/m/residents/${p.client_id}`,
      title: `${p.name} leaving ${fmtBack(p.departure)}`,
      detail: `Rm ${p.room} · approved pass`,
      action: { label: 'Checked out', run: () => act(`pl${p.id}`, 'PUT', `/api/passes/${p.id}`, { status: 'Out' }, `${p.name} checked out.`) },
    })
  }
  for (const m of todo.mail_deliver || []) {
    rows.push({
      key: `md${m.id}`, Icon: Mail, tone: 'brand', to: `/m/residents/${m.client_id}`,
      title: `Deliver mail · ${m.client_name}`, detail: [words(m.mail_type) || 'Mail', m.room && `Rm ${m.room}`].filter(Boolean).join(' · '),
      action: { label: 'Delivered', run: () => act(`md${m.id}`, 'PUT', `/api/mail/${m.id}/deliver`, {}, 'Mail marked delivered.') },
    })
  }
  for (const m of todo.mail_approve || []) {
    rows.push({
      key: `ma${m.id}`, Icon: Mail, tone: 'brand', to: `/m/residents/${m.client_id}`,
      title: `Approve mail · ${m.client_name}`, detail: [words(m.mail_type) || 'Mail', m.room && `Rm ${m.room}`].filter(Boolean).join(' · '),
      action: { label: 'Approve', run: () => act(`ma${m.id}`, 'PUT', `/api/mail/${m.id}/approve`, {}, 'Mail approved.') },
    })
  }
  const mine = initials(session.displayName).slice(0, 3).toUpperCase() || '?'
  for (const c of todo.chores || []) {
    rows.push({
      key: `ch${c.client_id}`, Icon: SquareCheck, tone: 'green', to: `/m/residents/${c.client_id}`,
      title: `Chore · ${c.name}`, detail: `${c.chore}${c.chore_time ? ` (${c.chore_time})` : ''} · Rm ${c.room}`,
      action: { label: 'Sign off', run: () => act(`ch${c.client_id}`, 'PUT', '/api/chore-log', { client_id: c.client_id, log_date: new Date().toLocaleDateString('en-CA'), initials: mine }, `${c.name}’s chore signed off.`) },
    })
  }
  for (const m of todo.milestones || []) {
    rows.push({
      key: `ms${m.id}`, Icon: Flag, tone: 'green', to: `/m/residents/${m.client_id}`,
      title: `Milestone · ${m.client_name}`, detail: [m.objective, m.target_date && `target ${fmtDay(m.target_date)}`].filter(Boolean).join(' · '),
      action: { label: 'Sign off', run: () => act(`ms${m.id}`, 'PUT', `/api/milestones/${m.id}/signoff`, {}, 'Milestone signed off.') },
    })
  }
  // Clinical headlines: read here, dealt with on the desktop.
  for (const i of todo.incidents || []) {
    rows.push({
      key: `in${i.id}`, Icon: FileWarning, tone: 'red', to: i.client_id ? `/m/residents/${i.client_id}` : null,
      title: `Incident to review · ${i.client_name || 'Resident'}`,
      detail: [i.incident_date && fmtDay(i.incident_date), i.severity && `${words(i.severity)} severity`, 'review on the desktop'].filter(Boolean).join(' · '),
    })
  }
  for (const c of todo.consents || []) {
    rows.push({
      key: `cs${c.id}`, Icon: ShieldCheck, tone: 'amber', to: `/m/residents/${c.client_id}`,
      title: `Consent expiring · ${c.client_name}`,
      detail: [`to ${c.recipient_name || c.recipient_org || 'recipient'}`, `ends ${fmtDay(c.expiration_date)}`].join(' · '),
    })
  }
  for (const t of todo.plan_reviews || []) {
    rows.push({
      key: `pr${t.id}`, Icon: HeartPulse, tone: 'brand', to: `/m/residents/${t.client_id}`,
      title: `Treatment plan review · ${t.client_name}`, detail: `Due ${fmtDay(t.review_date)}`,
    })
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="foryou-h">
      <SectionTitle id="foryou-h" count={rows.length}>For you</SectionTitle>
      <Card className="overflow-hidden">
        {rows.length === 0 && (
          <p className="flex items-center gap-2 p-4 text-sm text-gray-600 dark:text-gray-400">
            <CircleCheck className="h-5 w-5 text-green-600 dark:text-green-400" aria-hidden="true" />Nothing waiting on you.
          </p>
        )}
        {rows.map(r => (
          <div key={r.key} className="flex min-h-[60px] items-center gap-3 border-b border-gray-200 py-2 pl-3 pr-2.5 last:border-b-0 dark:border-gray-700">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONES[r.tone]}`}>
              <r.Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            {r.to
              ? (
                <Link to={r.to} className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-semibold leading-snug">{r.title}</span>
                  {r.detail && <span className="text-[13px] text-gray-600 dark:text-gray-400">{r.detail}</span>}
                </Link>
              )
              : (
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-semibold leading-snug">{r.title}</span>
                  {r.detail && <span className="text-[13px] text-gray-600 dark:text-gray-400">{r.detail}</span>}
                </span>
              )}
            {r.action
              ? (
                <button
                  type="button"
                  onClick={r.action.run}
                  disabled={busy === r.key}
                  className="h-10 shrink-0 rounded-lg bg-primary-700 px-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-primary-600"
                >{r.action.label}</button>
              )
              : r.to && <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />}
          </div>
        ))}
      </Card>
      <InfractionReviewSheet item={reviewing} onClose={() => setReviewing(null)} />
    </section>
  )
}

// Actions that start something rather than finish it, one tile each.
export function QuickActions() {
  const { hasPerm } = useMobile()
  const [sheet, setSheet] = useState(null)
  const tiles = [
    hasPerm('ua.draw') && { key: 'draw', label: 'Run UA draw', Icon: Shuffle, onClick: () => setSheet('draw') },
    hasPerm('violations.log') && { key: 'inf', label: 'Log infraction', Icon: Ban, onClick: () => setSheet('inf') },
    hasPerm('broadcast.send') && { key: 'ann', label: 'Announce', Icon: Megaphone, to: '/m/announcements' },
  ].filter(Boolean)
  if (!tiles.length) return null
  const tileCls = 'flex h-[84px] flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white text-[13px] font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
  const icon = (Icon) => (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200">
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </span>
  )
  return (
    <section aria-label="Quick actions" className={`grid gap-2 ${tiles.length === 3 ? 'grid-cols-3' : tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {tiles.map(t => t.to
        ? <Link key={t.key} to={t.to} className={tileCls}>{icon(t.Icon)}{t.label}</Link>
        : <button key={t.key} type="button" onClick={t.onClick} className={tileCls}>{icon(t.Icon)}{t.label}</button>)}
      <UaDrawSheet open={sheet === 'draw'} onClose={() => setSheet(null)} />
      <LogInfractionSheet open={sheet === 'inf'} onClose={() => setSheet(null)} />
    </section>
  )
}
