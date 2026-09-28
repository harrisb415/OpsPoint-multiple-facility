import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { TextInput } from 'flowbite-react'
import { Search, ChevronRight } from 'lucide-react'
import { useMobile } from './context.js'
import { Card, Initials } from './ui.jsx'
import { countStatuses, censusKeys, statusLabel, statusBadge } from '../utils/statuses.js'
import { statusData, currentStatuses, floorOf, fmtBack } from './model.js'

// Everyone on the roster: search, filter by status, grouped by floor.
export default function Residents() {
  const { snap } = useMobile()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const sd = statusData(snap)
  const statuses = currentStatuses(snap)
  const counts = countStatuses(sd, snap.residents, statuses)
  const keys = censusKeys(sd, counts).filter(k => counts[k] > 0)
  const filter = params.get('status') && counts[params.get('status')] ? params.get('status') : 'all'
  const passes = useMemo(() => new Map(snap.passes.map(p => [p.client_id, p])), [snap.passes])
  const uaPending = useMemo(() => new Set(snap.ua_pending || []), [snap.ua_pending])

  const query = q.trim().toLowerCase()
  const shown = snap.residents.filter(c =>
    (filter === 'all' || (statuses[c.id] || 'building') === filter) &&
    (!query || c.name.toLowerCase().includes(query) || String(c.room).toLowerCase().includes(query)))
  const groups = []
  for (const c of shown) {
    const f = floorOf(c.room)
    let g = groups.find(x => x.label === f)
    if (!g) groups.push(g = { label: f, rows: [] })
    g.rows.push(c)
  }

  const pick = (k) => setParams(k === 'all' ? {} : { status: k }, { replace: true })

  return (
    <div className="flex min-w-0 flex-col pb-6">
      <header className="sticky top-0 z-10 flex flex-col gap-3 bg-gray-100 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] dark:bg-gray-900">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display text-2xl font-bold tracking-tight">Residents</h1>
          <span className="text-sm text-gray-600 dark:text-gray-400">{snap.residents.length} on the roster</span>
        </div>
        <label htmlFor="res-search" className="sr-only">Search residents</label>
        <TextInput id="res-search" type="search" icon={Search} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or room" autoComplete="off" />
        <div role="group" aria-label="Filter by status" className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[['all', 'All', snap.residents.length], ...keys.map(k => [k, statusLabel(sd, k), counts[k]])].map(([k, label, n]) => {
            const on = filter === k
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => pick(k)}
                className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold ${on
                  ? 'border-primary-700 bg-primary-700 text-white dark:border-primary-500 dark:bg-primary-600'
                  : 'border-gray-300 bg-white text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'}`}
              >
                {label}
                <span className={on ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}>{n}</span>
              </button>
            )
          })}
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4">
        {groups.length === 0 && <p className="px-1 text-sm text-gray-600 dark:text-gray-400">No residents match.</p>}
        {groups.map(g => (
          <section key={g.label} className="flex flex-col gap-2" aria-label={g.label}>
            <h2 className="flex items-baseline gap-2 px-1 text-sm font-bold text-gray-600 dark:text-gray-400">
              {g.label}<span className="font-medium">{g.rows.length}</span>
            </h2>
            <Card className="overflow-hidden">
              {g.rows.map(c => {
                const st = statuses[c.id] || 'building'
                const pass = passes.get(c.id)
                const note = [pass?.return_date && `Back ${fmtBack(pass.return_date)}`, uaPending.has(c.id) && 'UA requested'].filter(Boolean).join(' · ')
                return (
                  <Link key={c.id} to={`/m/residents/${c.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-gray-200 px-3 py-2 last:border-b-0 dark:border-gray-700">
                    <Initials name={c.name} className="h-10 w-10 text-sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-semibold">{c.name}</span>
                      <span className="truncate text-[13px] text-gray-600 dark:text-gray-400">
                        <span className="font-mono font-medium">{c.room}</span>{note && ` · ${note}`}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge(sd, st)}`}>{statusLabel(sd, st)}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  </Link>
                )
              })}
            </Card>
          </section>
        ))}
      </div>
    </div>
  )
}
