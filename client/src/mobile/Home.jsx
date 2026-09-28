import { Link } from 'react-router-dom'
import { Alert } from 'flowbite-react'
import { CircleCheck, Building2, TriangleAlert, ChevronRight } from 'lucide-react'
import { useMobile } from './context.js'
import { useNow } from './useSnapshot.js'
import { Card, Bar, Initials, ScreenHeader, SectionTitle } from './ui.jsx'
import { countStatuses, censusKeys, statusLabel, statusBadge } from '../utils/statuses.js'
import { mostRecentLogTime, scheduledStatus, fmtClock, fmtSpan } from './schedule.js'
import { statusData, currentStatuses, roundStats, lastWellness, openNotLocated, shortName } from './model.js'

export default function Home() {
  const { snap, session, hasPerm, flags } = useMobile()
  const now = useNow(30000)
  const { facility, report } = snap
  const reportOpen = !!report && !report.is_closed
  const statuses = currentStatuses(snap)
  const entries = report?.log_entries || []

  const subtitle = [reportOpen ? report.shift : 'No shift open', session.displayName].filter(Boolean).join(' · ')
  const counts = countStatuses(statusData(snap), snap.residents, statuses)
  const notLocated = openNotLocated(snap)
  const showHero = flags.wellnessOn && (hasPerm('reminders.view') || hasPerm('log.add'))

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenHeader
        title={facility.name || 'OpsPoint'}
        subtitle={subtitle}
        right={<Link to="/m/more" aria-label="Your account"><Initials name={session.displayName} className="h-10 w-10 text-sm" /></Link>}
      />

      <div className="flex flex-col gap-4 px-4">
        {!reportOpen && (
          <Alert color="warning" icon={TriangleAlert}>
            No shift report is open. Rounds and log entries need one, so start it on the desktop.
          </Alert>
        )}

        {notLocated.length > 0 && (
          <Link to="/m/rounds">
            <Card className="flex items-start gap-3 border-red-200 p-4 dark:border-red-900">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200">
                <TriangleAlert className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold">Not located on the last round</span>
                <span className="block text-sm text-gray-600 dark:text-gray-300">
                  {notLocated.map(m => m.resident ? `Rm ${m.resident.room} ${m.resident.name}` : 'A resident').join(', ')}
                </span>
                <span className="mt-1 block text-sm font-semibold text-red-700 dark:text-red-300">Record when they&rsquo;re found</span>
              </span>
              <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
            </Card>
          </Link>
        )}

        {showHero && <WellnessHero snap={snap} statuses={statuses} entries={entries} now={now} reportOpen={reportOpen} />}

        <Card className="flex flex-col gap-3 p-4" aria-labelledby="census-h">
          <div className="flex items-baseline justify-between">
            <h2 id="census-h" className="text-base font-bold">Census</h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">{snap.residents.length} residents</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {censusKeys(statusData(snap), counts).map(k => (
              <div key={k} className={`flex flex-col gap-1.5 rounded-xl p-2.5 ${statusBadge(statusData(snap), k)}`}>
                <span className="font-display text-2xl font-bold leading-none">{counts[k] || 0}</span>
                <span className="text-[11px] font-semibold leading-tight">{statusLabel(statusData(snap), k)}</span>
              </div>
            ))}
          </div>
        </Card>

        {reportOpen && (
          <section className="flex flex-col gap-2" aria-labelledby="latest-h">
            <SectionTitle id="latest-h">Latest in the log</SectionTitle>
            <Card className="overflow-hidden">
              {entries.length === 0 && <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Nothing logged yet this shift.</p>}
              {entries.slice(-3).reverse().map(e => (
                <div key={e.id} className="flex gap-3 border-b border-gray-200 px-4 py-3 last:border-b-0 dark:border-gray-700">
                  <span className="w-16 shrink-0 pt-0.5 font-mono text-xs font-semibold text-primary-700 dark:text-primary-300">{e.time}</span>
                  <span className="line-clamp-2 text-sm">{e.text}</span>
                </div>
              ))}
              <Link to="/m/log" className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm font-semibold text-primary-700 dark:border-gray-700 dark:text-primary-300">
                Open the shift log <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Card>
          </section>
        )}
      </div>
    </div>
  )
}

function WellnessHero({ snap, statuses, entries, now, reportOpen }) {
  const { hasPerm, flags } = useMobile()
  const canLog = hasPerm('log.add')
  const round = snap.round
  const last = lastWellness(entries)
  const st = hasPerm('reminders.view')
    ? scheduledStatus(mostRecentLogTime(entries, 'wellness check', now), snap.facility.wellness_schedule, now)
    : null
  const overdue = !round && st?.status === 'overdue'

  let label, big, small, bar = null
  if (round) {
    const s = roundStats(snap, statuses)
    label = 'ROUND IN PROGRESS'
    big = `${s.accounted} of ${s.total}`
    small = 'accounted for'
    bar = { value: s.accounted, max: s.total }
  } else if (overdue) {
    label = 'WELLNESS CHECK OVERDUE'
    big = `since ${fmtClock(st.overdueAt)}`
    small = ''
  } else if (st?.nextTime) {
    const start = st.prevTime || new Date(st.nextTime.getTime() - 2 * 3600000)
    label = 'NEXT WELLNESS CHECK'
    big = fmtSpan(st.nextTime - now)
    small = `until ${fmtClock(st.nextTime)}`
    bar = { value: now - start, max: st.nextTime - start }
  } else {
    label = 'WELLNESS CHECKS'
    big = last ? last.time : 'None yet'
    small = last ? `last check${last.summary ? ` · ${last.summary}` : ''}` : 'this shift'
  }
  const showLast = !round && !!last && (overdue || !!st?.nextTime)

  const hero = overdue
    ? 'bg-red-700 dark:bg-red-900'
    : 'bg-primary-700 dark:bg-primary-900'
  const onHeroText = overdue ? 'text-red-800' : 'text-primary-800'

  return (
    <section aria-label="Wellness checks" className={`flex flex-col gap-2.5 rounded-3xl p-4 text-white ${hero}`}>
      <span className="text-xs font-bold tracking-wider text-white/80">{label}</span>
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="font-display text-[44px] font-bold leading-none tracking-tight">{big}</span>
        {small && <span className="text-[15px] text-white/80">{small}</span>}
      </div>
      {bar && <Bar value={bar.value} max={bar.max} onHero label={label} />}
      {round && <span className="text-sm text-white/80">Started {fmtClock(new Date(round.started_at))} by {shortName(round.started_by)}</span>}
      {showLast && <span className="text-sm text-white/80">Last check {last.time}{last.summary ? ` · ${last.summary}` : ''}</span>}
      {canLog && reportOpen && (
        <div className="mt-1 flex gap-2.5">
          <Link to="/m/rounds" className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-bold ${onHeroText}`}>
            <CircleCheck className="h-5 w-5" aria-hidden="true" />
            {round ? 'Continue round' : 'Start round'}
          </Link>
          {flags.walkOn && (
            <Link to="/m/rounds?view=walk" className="flex h-12 items-center gap-2 rounded-xl border border-white/50 px-4 text-[15px] font-semibold text-white">
              <Building2 className="h-5 w-5" aria-hidden="true" />
              Walkthrough
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
