import { useMemo, lazy, Suspense } from 'react'
import { Button } from 'flowbite-react'
import { useData } from '../contexts/DataContext.jsx'
import { allStatuses, statusList, offSiteStatuses, TONE_HEX, TONE_BADGE } from '../utils/statuses.js'
import { usePermission } from '../hooks/usePermission.js'
import { useIsDark } from '../hooks/useIsDark.js'
import { classifyLogEntry } from '../utils/printLog.js'
import { ColoredAvatar } from '../components/ui.jsx'
import {
  MapPin, DoorOpen, HeartPulse, AlertTriangle, FileText, Footprints,
} from 'lucide-react'

// Activity-feed styling (matches the design prototype's timeline). Each log
// entry is classified by type → a tone that drives the dot + badge colors.
const FEED_TONE = {
  Wellness: 'green', Walkthrough: 'blue', UA: 'yellow', Lunch: 'gray',
  'Room Search': 'sky', Mail: 'blue', Infraction: 'red', Group: 'blue',
  Intake: 'green', Discharge: 'gray', Note: 'gray',
}
const FEED_DOT = {
  green: 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-md', blue: 'bg-blue-500', yellow: 'bg-yellow-400',
  red: 'bg-gradient-to-br from-rose-400 to-pink-500 text-white shadow-md', sky: 'bg-sky-500', gray: 'bg-gray-400',
}
const FEED_BADGE = {
  green:  'bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-md',
  blue:   'bg-gradient-to-br from-primary-400 to-accent-500 text-white shadow-md',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  red:    'bg-gradient-to-br from-rose-400 to-pink-500 text-white shadow-md',
  sky:    'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  gray:   'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

// ApexCharts is heavy (~135 kB gzip) and only used here — load it as a
// separate async chunk so it doesn't bloat the main bundle.
const Chart = lazy(() => import('react-apexcharts'))
const ChartFallback = () => <div className="flex items-center justify-center h-[260px] text-sm text-gray-400">Loading chart…</div>

// Resident status → label + chart color + badge tone
const STATUS_META = {
  building: { label: 'In Building', color: '#22c55e', badge: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  work:     { label: 'At Work',     color: '#3b82f6', badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  pass:     { label: 'On Pass',     color: '#f59e0b', badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  bhc:      { label: 'BHC',         color: '#8b5cf6', badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  efc:      { label: 'EFC',         color: '#ec4899', badge: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300' },
  hospital: { label: 'Hospital',    color: '#ef4444', badge: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  out:      { label: 'Out / Other', color: '#f97316', badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
}
const STATUS_ORDER = ['building', 'work', 'pass', 'bhc', 'efc', 'hospital', 'out']

// Live status metadata, derived from the configured list so a renamed or
// recoloured status flows through to the census donut and the roster badges.
// Falls back to STATUS_META for any key not in the list (e.g. a status
// retired before archiving existed).
function metaFrom(data) {
  const m = {}
  for (const st of allStatuses(data)) {
    m[st.key] = {
      label: st.label,
      color: TONE_HEX[st.tone] || TONE_HEX.gray,
      badge: TONE_BADGE[st.tone] || TONE_BADGE.gray,
    }
  }
  return { ...STATUS_META, ...m }
}
// Census order follows the admin's ordering, with any legacy key appended.
function orderFrom(data) {
  const live = statusList(data).map(s => s.key)
  return [...live, ...STATUS_ORDER.filter(k => !live.includes(k))]
}

// Parse an hour (0–23) from a log time like "14:30" or "2:30 PM"
function parseHour(t) {
  if (!t) return null
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const ap = m[3] ? m[3].toLowerCase().replace(/\./g, '') : null
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return (h >= 0 && h <= 23) ? h : null
}
const fmtHour = h => { const ap = h < 12 ? 'a' : 'p'; const hr = h % 12 || 12; return `${hr}${ap}` }

// Literal class strings (Tailwind JIT can't see dynamically-built names)
const KPI_TONE = {
  green:  'bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-md',
  orange: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md',
  blue:   'bg-gradient-to-br from-primary-400 to-accent-500 text-white shadow-md',
  red:    'bg-gradient-to-br from-rose-400 to-pink-500 text-white shadow-md',
}
function Kpi({ label, value, sub, Icon, tone }) {
  return (
    <div className="p-5 bg-white border border-gray-200 shadow-sm rounded-2xl dark:bg-gray-800 dark:border-gray-700 sm:p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:border-primary-200 dark:hover:border-primary-800">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-2 font-display text-[2.6rem] leading-none font-semibold tracking-tight tabular-nums bg-gradient-to-br from-gray-900 to-primary-700 bg-clip-text text-transparent dark:from-white dark:to-primary-300">{value}</p>
        </div>
        <span className={`flex items-center justify-center w-12 h-12 rounded-xl shrink-0 ${KPI_TONE[tone] || KPI_TONE.blue}`}>
          <Icon className="w-5 h-5" />
        </span>
      </div>
      {sub && <p className="mt-3 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

export default function DashboardHome({ onNavigate, globalSearch = '' }) {
  const { data, notif, openProfile } = useData()
  const { hasPerm } = usePermission()
  const dark = useIsDark()
  // Dark-aware chart colors (ApexCharts is JS-rendered — no Tailwind dark: here)
  const axisColor = '#9ca3af'                       // gray-400, legible on both
  const gridColor = dark ? '#374151' : '#e5e7eb'    // gray-700 / gray-200
  const labelColor = dark ? '#9ca3af' : '#6b7280'
  const chartTheme = dark ? 'dark' : 'light'

  const report   = data?.reports?.find(r => r.id === data?.active_report_id)
  const statuses = report?.statuses || {}
  const logs     = report?.log_entries || []
  const issues   = report?.issues || []
  const facility = data?.facility_name || 'OpsPoint'

  // Clients on active passes should always show "pass" regardless of what
  // statuses says — mirrors the passOverride logic in ReportTab.jsx
  const passOverride = useMemo(() => {
    const po = {}
    ;(data?.passes || []).filter(p => p.status === 'Out' || p.status === 'Extended').forEach(p => { po[p.client_id] = 'pass' })
    return po
  }, [data?.passes])

  const resolveStatus = (id) => passOverride[id] ?? statuses[String(id)] ?? statuses[id] ?? 'building'

  const allResidents = useMemo(
    () => (data?.clients || []).filter(c => c.is_active && !c.is_special && c.name !== 'VACANT'),
    [data]
  )
  const gq = globalSearch.trim().toLowerCase()
  const residents = useMemo(
    () => !gq ? allResidents : allResidents.filter(r => r.name.toLowerCase().includes(gq) || String(r.room || '').includes(gq)),
    [allResidents, gq]
  )
  const total = allResidents.length

  const census = useMemo(() => {
    const c = { building: 0, work: 0, pass: 0, bhc: 0, efc: 0, hospital: 0, out: 0 }
    allResidents.forEach(r => { const s = resolveStatus(r.id); if (c[s] != null) c[s]++ })
    return c
  }, [allResidents, statuses, passOverride])

  const onSite       = census.building
  const offSite      = total - onSite
  const wellnessCnt  = logs.filter(l => (l.text || '').toLowerCase().startsWith('wellness check')).length
  const walkCnt      = logs.filter(l => (l.text || '').toLowerCase().includes('walkthrough')).length
  const pendingUA    = notif?.uaRequests?.length || 0
  const openItems    = pendingUA + issues.length

  // Activity per hour (log entries)
  const activity = useMemo(() => {
    const buckets = {}
    logs.forEach(l => { const h = parseHour(l.time); if (h != null) buckets[h] = (buckets[h] || 0) + 1 })
    const hrs = Object.keys(buckets).map(Number).sort((a, b) => a - b)
    if (hrs.length === 0) return { cats: [], series: [] }
    const lo = hrs[0], hi = hrs[hrs.length - 1]
    const cats = [], series = []
    for (let h = lo; h <= hi; h++) { cats.push(fmtHour(h)); series.push(buckets[h] || 0) }
    return { cats, series }
  }, [logs])

  // Status metadata/order from the configured list, so renames and colour
  // changes in Admin flow straight through to the donut and roster badges.
  // Declared before `donut` — its callback runs during render, so a later
  // const would be in the temporal dead zone.
  const statusMeta  = useMemo(() => metaFrom(data), [data])
  const statusOrder = useMemo(() => orderFrom(data), [data])
  const offSiteLbl  = useMemo(() => {
    const names = offSiteStatuses(data).map(s => s.label)
    if (!names.length) return 'no off-site statuses'
    return names.length > 3 ? `${names.slice(0, 3).join(' · ')} +${names.length - 3}` : names.join(' · ')
  }, [data])

  const donut = useMemo(() => {
    const labels = [], series = [], colors = []
    statusOrder.forEach(k => { const mt = statusMeta[k]; if (mt && census[k] > 0) { labels.push(mt.label); series.push(census[k]); colors.push(mt.color) } })
    return { labels, series, colors }
  }, [census, statusMeta, statusOrder])

  const recentAll = logs.slice(-8).reverse()
  const recent = !gq ? recentAll : recentAll.filter(l => (l.text || '').toLowerCase().includes(gq))
  const lastWellness = [...logs].reverse().find(l => (l.text || '').toLowerCase().startsWith('wellness check'))
  const lastWalk     = [...logs].reverse().find(l => (l.text || '').toLowerCase().includes('walkthrough'))
const cardCls = 'bg-white border border-gray-200 shadow-sm rounded-2xl dark:bg-gray-800 dark:border-gray-700 transition-shadow duration-200 hover:shadow-lg'

  return (
    <div className="flex-1 min-h-0 p-5 space-y-4 overflow-y-auto">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[2rem] font-semibold tracking-tight text-gray-900 dark:text-white">Dashboard</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {report?.shift ? `${report.shift} · ` : ''}{facility}
            {report?.report_date ? <span className="font-mono"> · {report.report_date}</span> : ''}
            {report?.mod_name ? ` · PA ${report.mod_name}` : ''}
          </p>
        </div>
        <Button onClick={() => onNavigate?.('report')}>
          <FileText className="w-4 h-4 mr-2" /> Open Report
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="On Site" value={`${onSite}/${total}`} sub="residents in building" Icon={MapPin} tone="green" />
        <Kpi label="Off Site" value={offSite} sub={offSiteLbl} Icon={DoorOpen} tone="orange" />
        <Kpi label="Wellness Checks" value={wellnessCnt} sub={`${walkCnt} walkthrough${walkCnt === 1 ? '' : 's'} logged`} Icon={HeartPulse} tone="blue" />
        <Kpi label="Open Items" value={openItems} sub={`${pendingUA} UA · ${issues.length} issue${issues.length === 1 ? '' : 's'}`} Icon={AlertTriangle} tone="red" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`${cardCls} p-4 sm:p-5 lg:col-span-2`}>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Activity over the shift</h2>
          <p className="text-xs text-gray-400">Log entries per hour</p>
          {activity.series.length > 0 ? (
            <Suspense fallback={<ChartFallback />}>
            <Chart
              type="area" height={260}
              series={[{ name: 'Log entries', data: activity.series }]}
              options={{
                chart: { toolbar: { show: false }, fontFamily: 'inherit', sparkline: { enabled: false }, background: 'transparent' },
                theme: { mode: chartTheme },
                colors: ['#2563eb'],
                dataLabels: { enabled: false },
                stroke: { curve: 'smooth', width: 2 },
                fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05 } },
                grid: { borderColor: gridColor, strokeDashArray: 4 },
                xaxis: { categories: activity.cats, labels: { style: { colors: axisColor } }, axisBorder: { show: false }, axisTicks: { show: false } },
                yaxis: { labels: { style: { colors: axisColor } }, min: 0, forceNiceScale: true },
                tooltip: { theme: chartTheme },
              }}
            />
            </Suspense>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-sm text-gray-400">No log activity yet this shift.</div>
          )}
        </div>

        <div className={`${cardCls} p-4 sm:p-5`}>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Census by status</h2>
          <p className="text-xs text-gray-400">{total} active residents</p>
          {donut.series.length > 0 ? (
            <Suspense fallback={<ChartFallback />}>
            <Chart
              type="donut" height={260}
              series={donut.series}
              options={{
                labels: donut.labels, colors: donut.colors,
                chart: { fontFamily: 'inherit', background: 'transparent' },
                theme: { mode: chartTheme },
                legend: { position: 'bottom', labels: { colors: labelColor } },
                dataLabels: { enabled: false },
                stroke: { width: 0 },
                plotOptions: { pie: { donut: { size: '72%', labels: { show: true, total: { show: true, label: 'Total', color: labelColor, formatter: () => String(total) } } } } },
                tooltip: { theme: chartTheme },
              }}
            />
            </Suspense>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-sm text-gray-400">No residents to chart.</div>
          )}
        </div>
      </div>

      {/* Roster + activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Roster */}
        <div className={`${cardCls} lg:col-span-2 overflow-hidden flex flex-col`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Roster</h2>
            <button onClick={() => onNavigate?.('clients')} className="text-xs font-medium text-primary-600 hover:text-primary-700">View all</button>
          </div>
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-5 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase dark:text-gray-300">Resident</th>
                  <th className="px-3 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase dark:text-gray-300">Case Manager</th>
                  <th className="px-5 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase dark:text-gray-300">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {residents.map(r => {
                  const meta = statusMeta[resolveStatus(r.id)] || statusMeta.building || STATUS_META.building
                  return (
                    <tr key={r.id} className="hover:bg-primary-50/60 dark:hover:bg-gray-700/40">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <ColoredAvatar name={r.name} photo={r.photo} />
                          <div>
                            <button onClick={() => openProfile(r.id)} className="text-sm font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 text-left">{r.name}</button>
                            <div className="text-xs text-gray-400 font-mono">Rm {r.room}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">{r.case_manager || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-md whitespace-nowrap ${meta.badge}`}>{meta.label}</span>
                      </td>
                    </tr>
                  )
                })}
                {residents.length === 0 && (
                  <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-400">No active residents.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Reminders + recent activity */}
        <div className="space-y-4 lg:min-h-[460px]">
          {hasPerm('reminders.view') && (
            <div className={`${cardCls} p-4 sm:p-5`}>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Reminders</h2>
              <div className="mt-3 space-y-2.5 text-sm">
                <div className="flex items-center gap-2.5">
                  <HeartPulse className="w-4 h-4 text-blue-500 shrink-0" />
                  <span className="flex-1 text-gray-600 dark:text-gray-300">Last wellness check</span>
                  <span className="font-mono text-gray-500">{lastWellness?.time || '—'}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Footprints className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="flex-1 text-gray-600 dark:text-gray-300">Last walkthrough</span>
                  <span className="font-mono text-gray-500">{lastWalk?.time || '—'}</span>
                </div>
              </div>
            </div>
          )}

          <div className={`${cardCls} p-4 sm:p-5`}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Recent activity</h2>
            {recent.length === 0
              ? <p className="mt-3 text-sm text-gray-400">No entries yet.</p>
              : (
                <ol className="relative mt-4 ml-2 border-l border-gray-200 dark:border-gray-700">
                  {recent.map(l => {
                    const type = classifyLogEntry(l.text)
                    const tone = FEED_TONE[type] || 'gray'
                    return (
                      <li key={l.id} className="mb-4 ml-5 last:mb-0">
                        <span className={`absolute w-3 h-3 -left-1.5 mt-1.5 rounded-full ring-4 ring-white dark:ring-gray-800 ${FEED_DOT[tone]}`}></span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-gray-400">{l.time}</span>
                          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap ${FEED_BADGE[tone]}`}>{type}</span>
                        </div>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{l.text}</p>
                      </li>
                    )
                  })}
                </ol>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
