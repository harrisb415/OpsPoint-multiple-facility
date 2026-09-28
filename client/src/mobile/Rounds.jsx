import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, TextInput } from 'flowbite-react'
import { Check, X, CloudCheck, TriangleAlert, CircleCheck } from 'lucide-react'
import { useConfirm } from '../components/ui.jsx'
import { useMobile } from './context.js'
import { api } from './api.js'
import { Card, Bar, SectionTitle } from './ui.jsx'
import { statusLabel, statusBadge } from '../utils/statuses.js'
import { fmtClock } from './schedule.js'
import { statusData, currentStatuses, isAway, marksOf, roundStats, floorOf, shortName, openNotLocated } from './model.js'

const DEFAULT_AREAS = [
  'Supply Room', 'Basement / Offices', 'Kitchen', 'Meeting Room', 'Dining Room',
  'Laundry Area', 'Clothing Closet', 'Stairs to Roof', 'Floors 2, 3 & 4',
  'Stairs Down to Main', 'Perimeter Check',
]

export default function Rounds() {
  const { flags } = useMobile()
  const [params, setParams] = useSearchParams()
  const view = flags.walkOn && (!flags.wellnessOn || params.get('view') === 'walk') ? 'walk' : 'wellness'
  const pick = (v) => setParams(v === 'walk' ? { view: 'walk' } : {}, { replace: true })

  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <header className="sticky top-0 z-10 flex flex-col gap-3 bg-gray-100 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] dark:bg-gray-900">
        <h1 className="font-display text-2xl font-bold tracking-tight">{view === 'walk' ? 'Walkthrough' : 'Wellness round'}</h1>
        {flags.wellnessOn && flags.walkOn && (
          <div role="group" aria-label="Round type" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-200 p-1 dark:bg-gray-800">
            {[['wellness', 'Wellness'], ['walk', 'Walkthrough']].map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => pick(v)}
                className={`h-10 rounded-lg text-sm ${view === v
                  ? 'bg-white font-bold text-gray-900 shadow-sm dark:bg-gray-600 dark:text-white'
                  : 'font-medium text-gray-600 dark:text-gray-300'}`}
              >{label}</button>
            ))}
          </div>
        )}
      </header>
      {view === 'walk' ? <Walkthrough /> : <Wellness />}
    </div>
  )
}

// ── Wellness round ──────────────────────────────────────────────────────────
function Wellness() {
  const { snap, reload, patchSnap, hasPerm, toast, session } = useMobile()
  const confirm = useConfirm()
  const [floor, setFloor] = useState('all')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const round = snap.round
  const canLog = hasPerm('log.add')
  const reportOpen = !!snap.report && !snap.report.is_closed
  const statuses = currentStatuses(snap)
  const marks = marksOf(round)

  const floors = useMemo(() => {
    const groups = new Map()
    for (const c of snap.residents) {
      const f = floorOf(c.room)
      if (!groups.has(f)) groups.set(f, [])
      groups.get(f).push(c)
    }
    return [...groups.entries()].map(([label, residents]) => ({ label, residents }))
  }, [snap.residents])

  async function start() {
    setBusy(true)
    try { await api('POST', '/api/rounds', {}); await reload() }
    catch (e) { toast(`Couldn’t start the round: ${e.message}`, 'error') }
    finally { setBusy(false) }
  }

  // Seen -> not located -> unmarked. Shown at once; a failure reloads the truth.
  async function tap(c) {
    const cur = marks.get(c.id)?.mark || null
    const next = !cur ? 'ok' : cur === 'ok' ? 'missing' : null
    patchSnap(s => ({
      ...s,
      round: {
        ...s.round,
        marks: next
          ? [...s.round.marks.filter(m => m.client_id !== c.id), { client_id: c.id, mark: next, by: session.displayName, at: new Date().toISOString() }]
          : s.round.marks.filter(m => m.client_id !== c.id),
      },
    }))
    try { await api('PUT', `/api/rounds/${round.id}/marks/${c.id}`, { mark: next }) }
    catch (e) { toast(`Not saved: ${e.message}`, 'error'); reload() }
  }

  async function finish() {
    const unchecked = snap.residents.filter(c => !marks.has(c.id) && !isAway(statuses, c.id))
    if (unchecked.length) {
      const ok = await confirm({
        title: 'Finish the round?',
        body: `${unchecked.length === 1 ? '1 resident hasn’t' : `${unchecked.length} residents haven’t`} been checked:\n` +
          unchecked.map(c => `Rm ${c.room} ${c.name}`).join('\n') + '\n\nThey’ll be logged as not checked.',
        confirmText: 'Finish anyway',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const r = await api('POST', `/api/rounds/${round.id}/finish`, { notes })
      setNotes('')
      toast(r.missing ? `Round logged. ${r.missing} not located.` : 'Round logged. Everyone accounted for.', r.missing ? 'warn' : 'ok')
      await reload()
    } catch (e) {
      toast(`Not saved: ${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  if (!round) return <NoRound busy={busy} onStart={start} canLog={canLog} reportOpen={reportOpen} />

  const stats = roundStats(snap, statuses)
  const shown = floor === 'all' ? snap.residents : (floors.find(f => f.label === floor)?.residents || [])
  const floorCount = (list) => list.filter(c => isAway(statuses, c.id) || marks.get(c.id)?.mark === 'ok').length

  return (
    <>
      <div className="flex min-w-0 flex-col gap-3 px-4 pb-4">
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[15px] font-bold">{stats.accounted} of {stats.total} accounted for</span>
            {stats.missing > 0
              ? <span className="text-sm font-semibold text-red-700 dark:text-red-300">{stats.missing} not located</span>
              : <span className="flex items-center gap-1 text-sm font-semibold text-green-700 dark:text-green-300"><CloudCheck className="h-4 w-4" aria-hidden="true" />Saved</span>}
          </div>
          <Bar value={stats.accounted} max={stats.total} label="Residents accounted for" />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Started {fmtClock(new Date(round.started_at))} by {shortName(round.started_by)}
          </span>
        </Card>

        {floors.length > 1 && (
          <div role="group" aria-label="Floor" className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[{ label: 'all', residents: snap.residents }, ...floors].map(f => {
              const on = floor === f.label
              const who = f.label === 'all' ? '' : lastMarker(f.residents, marks)
              return (
                <button
                  key={f.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFloor(f.label)}
                  className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold ${on
                    ? 'border-primary-700 bg-primary-700 text-white dark:border-primary-500 dark:bg-primary-600'
                    : 'border-gray-300 bg-white text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'}`}
                >
                  {f.label === 'all' ? 'All' : f.label}
                  <span className={on ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}>{floorCount(f.residents)}/{f.residents.length}</span>
                  {who && <span className={on ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}>· {who}</span>}
                </button>
              )
            })}
          </div>
        )}

        <Card className="overflow-hidden">
          {shown.map(c => {
            const m = marks.get(c.id)?.mark
            const away = isAway(statuses, c.id)
            return (
              <div key={c.id} className={`flex min-h-[64px] items-center gap-3 border-b border-gray-200 py-1.5 pl-4 pr-2.5 last:border-b-0 dark:border-gray-700 ${m === 'missing' ? 'bg-red-50 dark:bg-red-950/40' : ''}`}>
                <span className="w-10 shrink-0 font-mono text-sm font-bold text-gray-600 dark:text-gray-400">{c.room}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={`text-base font-semibold ${away ? 'text-gray-500 dark:text-gray-400' : ''}`}>{c.name}</span>
                  {away && (
                    <span className={`self-start rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(statusData(snap), statuses[c.id])}`}>
                      {statusLabel(statusData(snap), statuses[c.id])} · away
                    </span>
                  )}
                  {m === 'missing' && <span className="text-sm font-semibold text-red-700 dark:text-red-300">Not located</span>}
                </span>
                {!away && canLog && (
                  <button
                    type="button"
                    onClick={() => tap(c)}
                    aria-label={`${c.name}: ${m === 'ok' ? 'seen. Tap to mark not located' : m === 'missing' ? 'not located. Tap to clear' : 'tap to mark seen'}`}
                    className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-2 ${m === 'ok'
                      ? 'border-green-700 bg-green-700 text-white'
                      : m === 'missing'
                        ? 'border-red-700 bg-red-700 text-white'
                        : 'border-gray-400 bg-white dark:border-gray-500 dark:bg-gray-800'}`}
                  >
                    {m === 'ok' && <Check className="h-6 w-6" strokeWidth={3} aria-hidden="true" />}
                    {m === 'missing' && <X className="h-6 w-6" strokeWidth={3} aria-hidden="true" />}
                  </button>
                )}
              </div>
            )
          })}
        </Card>

        {!canLog && (
          <Alert color="gray">You can follow the round, but your account can&rsquo;t record it. Ask an admin for &ldquo;Add log entries&rdquo;.</Alert>
        )}
      </div>

      {canLog && (
        <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
          <label htmlFor="round-notes" className="sr-only">Notes for this round</label>
          <TextInput id="round-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes for this round (optional)" maxLength={500} />
          <Button onClick={finish} disabled={busy} size="lg" className="w-full">
            <Check className="mr-2 h-5 w-5" aria-hidden="true" />
            {stats.missing ? `Finish round · ${stats.missing} not located` : 'Finish round'}
          </Button>
        </div>
      )}
    </>
  )
}

function lastMarker(residents, marks) {
  let best = null
  for (const c of residents) {
    const m = marks.get(c.id)
    if (m && (!best || m.at > best.at)) best = m
  }
  return best ? shortName(best.by) : ''
}

function NoRound({ busy, onStart, canLog, reportOpen }) {
  const { snap, reload, toast } = useMobile()
  const last = snap.last_round
  const notLocated = openNotLocated(snap)

  async function found(m) {
    try {
      await api('POST', `/api/rounds/${last.id}/marks/${m.client_id}/found`, {})
      toast('Logged as found.', 'ok')
      await reload()
    } catch (e) { toast(`Not saved: ${e.message}`, 'error') }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      {!reportOpen && <Alert color="warning" icon={TriangleAlert}>No shift report is open. Start one on the desktop, then come back to do the round.</Alert>}

      {canLog && reportOpen && (
        <Button size="xl" onClick={onStart} disabled={busy} className="w-full">
          <CircleCheck className="mr-2 h-6 w-6" aria-hidden="true" />
          Start wellness round
        </Button>
      )}
      {!canLog && <Alert color="gray">Your account can follow rounds but not record them. Ask an admin for &ldquo;Add log entries&rdquo;.</Alert>}

      {notLocated.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="nl-h">
          <SectionTitle id="nl-h" count={notLocated.length}>Not located</SectionTitle>
          <Card className="overflow-hidden">
            {notLocated.map(m => (
              <div key={m.client_id} className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 last:border-b-0 dark:border-gray-700">
                <span className="w-10 shrink-0 font-mono text-sm font-bold text-gray-600 dark:text-gray-400">{m.resident?.room || ''}</span>
                <span className="min-w-0 flex-1 text-base font-semibold">{m.resident?.name || 'Resident'}</span>
                {canLog && reportOpen && <Button size="sm" color="light" onClick={() => found(m)}>Found</Button>}
              </div>
            ))}
          </Card>
        </section>
      )}

      {last && (
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-xs font-bold tracking-wider text-gray-500 dark:text-gray-400">LAST ROUND</span>
          <span className="text-[15px] font-bold">
            Finished {fmtClock(new Date(last.finished_at))} by {shortName(last.finished_by)}
          </span>
          {last.missing > 0 && <span className="text-sm font-semibold text-red-700 dark:text-red-300">{last.missing} not located</span>}
        </Card>
      )}
    </div>
  )
}

// ── Walkthrough ─────────────────────────────────────────────────────────────
function Walkthrough() {
  const { snap, hasPerm, toast, session, reload } = useMobile()
  const areas = snap.facility.walk_areas?.length ? snap.facility.walk_areas : DEFAULT_AREAS
  const [state, setState] = useState({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const canLog = hasPerm('log.add')
  const reportOpen = !!snap.report && !snap.report.is_closed

  const set = (a, v) => setState(s => ({ ...s, [a]: s[a] === v ? '' : v }))

  async function log() {
    const ok = areas.filter(a => state[a] === 'ok')
    const flagged = areas.filter(a => state[a] === 'flag')
    if (!ok.length && !flagged.length) { toast('Mark at least one area first.', 'warn'); return }
    let text = `Building walkthrough conducted by ${session.displayName}. `
    text += flagged.length
      ? `${ok.length ? `Clear: ${ok.join(', ')}. ` : ''}Issues noted: ${flagged.join(', ')}.`
      : `All areas clear: ${ok.join(', ')}.`
    if (notes.trim()) text += ` Notes: ${notes.trim()}`
    setBusy(true)
    try {
      await api('PATCH', '/api/data', { reportId: snap.report.id, log_entry: { time: fmtClock(new Date()), text } })
      setState({})
      setNotes('')
      toast('Walkthrough logged.', 'ok')
      await reload()
    } catch (e) {
      toast(`Not saved: ${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {!reportOpen && <Alert color="warning" icon={TriangleAlert}>No shift report is open. Start one on the desktop to log a walkthrough.</Alert>}
        <Card className="overflow-hidden">
          {areas.map(a => {
            const v = state[a] || ''
            return (
              <div key={a} className={`flex min-h-[60px] items-center gap-3 border-b border-gray-200 py-1.5 pl-4 pr-2.5 last:border-b-0 dark:border-gray-700 ${v === 'ok' ? 'bg-green-50 dark:bg-green-950/40' : v === 'flag' ? 'bg-amber-50 dark:bg-amber-950/40' : ''}`}>
                <span className="min-w-0 flex-1 text-base font-semibold">{a}</span>
                <button type="button" aria-pressed={v === 'ok'} aria-label={`${a}: all clear`} onClick={() => set(a, 'ok')} disabled={!canLog}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border ${v === 'ok' ? 'border-green-700 bg-green-700 text-white' : 'border-gray-300 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                  <Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" />
                </button>
                <button type="button" aria-pressed={v === 'flag'} aria-label={`${a}: issue noted`} onClick={() => set(a, 'flag')} disabled={!canLog}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border ${v === 'flag' ? 'border-amber-600 bg-amber-500 text-white' : 'border-gray-300 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                  <TriangleAlert className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </Card>
        {!canLog && <Alert color="gray">Your account can&rsquo;t add to the shift log. Ask an admin for &ldquo;Add log entries&rdquo;.</Alert>}
      </div>
      {canLog && reportOpen && (
        <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
          <label htmlFor="walk-notes" className="sr-only">Issues or notes</label>
          <TextInput id="walk-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Issues or notes (optional)" maxLength={500} />
          <Button onClick={log} disabled={busy} size="lg" className="w-full">Log walkthrough</Button>
        </div>
      )}
    </>
  )
}
