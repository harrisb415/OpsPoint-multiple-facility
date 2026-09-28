import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Button, Spinner } from 'flowbite-react'
import {
  ChevronLeft, FlaskConical, Ticket, SquareCheck, Mail, Ban, Clock, Lock,
  HeartPulse, FileText, ClipboardList, Flag, UserRound,
} from 'lucide-react'
import { useMobile } from './context.js'
import { api } from './api.js'
import { Card, Initials } from './ui.jsx'
import { statusLabel, statusBadge } from '../utils/statuses.js'
import { fmtDay, fmtWhen } from '../utils/dates.js'
import { statusData, currentStatuses, floorOf, fmtBack } from './model.js'

const words = (s) => {
  const t = String(s || '').replace(/[_-]+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

// One resident. Fetched when opened; every open is access-logged on the
// server, so it isn't re-fetched on each live update.
export default function Resident() {
  const { id } = useParams()
  const { snap, hasPerm, toast } = useMobile()
  const [card, setCard] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api('GET', `/api/m/residents/${encodeURIComponent(id)}`)
      .then(c => { if (!cancelled) { setCard(c); setError(null) } })
      .catch(e => { if (!cancelled) setError(e) })
    return () => { cancelled = true }
  }, [id])

  const sd = statusData(snap)
  const st = currentStatuses(snap)[Number(id)] || 'building'
  const uaPending = (snap.ua_pending || []).includes(Number(id)) || card?.ua.pending_request

  async function requestUA() {
    setBusy(true)
    try {
      await api('POST', '/api/ua-requests', { client_id: card.resident.id, client_name: card.resident.name, room: String(card.resident.room) })
      toast(`UA requested for ${card.resident.name}.`, 'ok')
      setCard(c => ({ ...c, ua: { ...c.ua, pending_request: true } }))
    } catch (e) {
      toast(`Not sent: ${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-6">
      <header className="px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Link to="/m/residents" className="inline-flex h-11 items-center gap-1 px-2 text-[15px] font-semibold text-primary-700 dark:text-primary-300">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />Residents
        </Link>
      </header>

      <div className="flex flex-col gap-4 px-4">
        {error && <Alert color="failure">Couldn&rsquo;t load this resident: {error.message}.</Alert>}
        {!card && !error && <div className="flex justify-center py-10"><Spinner size="lg" aria-label="Loading" /></div>}

        {card && (
          <>
            <Card className="flex flex-col items-center gap-2 px-4 py-5 text-center">
              <Initials name={card.resident.name} className="h-20 w-20 font-display text-2xl" />
              <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">{card.resident.name}</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Room <span className="font-mono font-bold">{card.resident.room}</span> · {floorOf(card.resident.room)}
                {card.resident.intake_date && <> · admitted {fmtDay(card.resident.intake_date)}</>}
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <span className={`rounded-full px-3 py-1 text-[13px] font-bold ${statusBadge(sd, st)}`}>{statusLabel(sd, st)}</span>
                {card.pass?.return_date && (
                  <span className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-[13px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />Back {fmtBack(card.pass.return_date)}
                  </span>
                )}
                {uaPending && <span className="rounded-full bg-blue-100 px-3 py-1 text-[13px] font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">UA requested</span>}
              </div>
            </Card>

            {hasPerm('ua.request') && !uaPending && (
              <Button color="light" onClick={requestUA} disabled={busy} className="w-full">
                <FlaskConical className="mr-2 h-4 w-4" aria-hidden="true" />Request a UA
              </Button>
            )}

            <Section title="TODAY">
              {card.pass && (
                <Row Icon={Ticket} title={card.pass.status === 'Extended' ? 'On pass (extended)' : 'On pass'}
                  detail={[card.pass.departure && `Out ${fmtWhen(card.pass.departure)}`, card.pass.return_date && `back ${fmtWhen(card.pass.return_date)}`, card.pass.extended_by && `extended by ${card.pass.extended_by}`].filter(Boolean).join(' · ')} />
              )}
              {card.chore && (
                <Row Icon={SquareCheck} title={`Chore · ${card.chore.name}${card.chore.time ? ` (${card.chore.time})` : ''}`}
                  detail={!card.chore.due_today ? 'Not due today' : card.chore.signed_by ? `Signed off by ${card.chore.signed_by}` : 'Not signed off yet'} />
              )}
              <Row Icon={Mail} title="Mail"
                detail={card.mail.awaiting_approval || card.mail.to_deliver
                  ? [card.mail.awaiting_approval && `${card.mail.awaiting_approval} awaiting approval`, card.mail.to_deliver && `${card.mail.to_deliver} to deliver`].filter(Boolean).join(' · ')
                  : 'Nothing waiting'} />
              {card.resident.case_manager && <Row Icon={UserRound} title="Case manager" detail={card.resident.case_manager} />}
            </Section>

            <Section title="HEALTH AND COMPLIANCE">
              <Row Icon={FlaskConical} title="Last UA"
                detail={card.ua.last ? fmtDay(card.ua.last.tested_at) : 'None on record'}
                right={card.ua.last && <UaResult result={card.ua.last.result} />} />
              <Row Icon={Ban} title="Infractions" detail={card.infractions.open ? `${card.infractions.open} open` : 'None open'} />
            </Section>

            {card.clinical && <Clinical c={card.clinical} />}
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, children, badge }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-xs font-bold tracking-wider text-gray-600 dark:text-gray-400">{title}</h2>
        {badge}
      </div>
      <Card className="overflow-hidden">{children}</Card>
    </section>
  )
}

function Row({ Icon, title, detail, right }) {
  return (
    <div className="flex min-h-[58px] items-center gap-3 border-b border-gray-200 px-4 py-2.5 last:border-b-0 dark:border-gray-700">
      <Icon className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold">{title}</span>
        {detail && <span className="text-[13px] text-gray-600 dark:text-gray-400">{detail}</span>}
      </span>
      {right}
    </div>
  )
}

function UaResult({ result }) {
  if (result === 'pass') return <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800 dark:bg-green-900/40 dark:text-green-300">Negative</span>
  if (result === 'fail') return <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800 dark:bg-red-900/40 dark:text-red-300">Positive</span>
  return result ? <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700 dark:bg-gray-700 dark:text-gray-200">{words(result)}</span> : null
}

// Headlines only: what exists, its status and dates. The records themselves
// stay on the desktop.
function Clinical({ c }) {
  const readOnly = (
    <span className="flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-bold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
      <Lock className="h-3 w-3" aria-hidden="true" />Read-only
    </span>
  )
  const signed = (x) => x.signed_at ? `signed${x.signed_by_name ? ` by ${x.signed_by_name}` : ''}` : words(x.status || 'draft')
  return (
    <Section title="CLINICAL" badge={readOnly}>
      {'treatment' in c && (
        <Row Icon={HeartPulse} title="Treatment plan"
          detail={c.treatment ? [words(c.treatment.status), c.treatment.review_date && `review due ${fmtDay(c.treatment.review_date)}`].filter(Boolean).join(' · ') : 'None yet'} />
      )}
      {'last_note' in c && (
        <Row Icon={FileText} title="Last clinical note"
          detail={c.last_note ? [words(c.last_note.note_type), c.last_note.note_date && fmtDay(c.last_note.note_date), signed(c.last_note)].filter(Boolean).join(' · ') : 'None yet'} />
      )}
      {'last_assessment' in c && (
        <Row Icon={ClipboardList} title="Last assessment"
          detail={c.last_assessment ? [words(c.last_assessment.assessment_type), c.last_assessment.assessment_date && fmtDay(c.last_assessment.assessment_date), c.last_assessment.score_label].filter(Boolean).join(' · ') : 'None yet'} />
      )}
      {'next_milestone' in c && (
        <Row Icon={Flag} title="Next milestone"
          detail={c.next_milestone ? [c.next_milestone.objective, c.next_milestone.target_date && `target ${fmtDay(c.next_milestone.target_date)}`].filter(Boolean).join(' · ') : 'None open'} />
      )}
      <p className="px-4 py-3 text-[13px] text-gray-600 dark:text-gray-400">Full clinical records open in the desktop app.</p>
    </Section>
  )
}
