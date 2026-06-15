import { useMemo, lazy, Suspense } from 'react'
import { useData } from '../contexts/DataContext.jsx'
import { usePermission } from '../hooks/usePermission.js'
import {
  MapPin, DoorOpen, HeartPulse, AlertTriangle, FileText, Clock, Footprints,
} from 'lucide-react'

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
  green:  'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400',
  orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400',
  blue:   'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
  red:    'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
}
function Kpi({ label, value, sub, Icon, tone }) {
  return (
    <div className="p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:bg-gray-800 dark:border-gray-700 sm:p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white font-mono tabular-nums">{value}</p>
        </div>
        <span className={`flex items-center justify-center w-11 h-11 rounded-lg shrink-0 ${KPI_TONE[tone] || KPI_TONE.blue}`}>
          <Icon className="w-5 h-5" />
        </span>
      </div>
      {sub && <p className="mt-3 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

export default function DashboardHome({ onNavigate }) {
  const { data, notif } = useData()
  const { hasPerm } = usePermission()

  const report   = data?.reports?.find(r => r.id === data?.active_report_id)
  const statuses = report?.statuses || {}
  const logs     = report?.log_entries || []
  const issues   = report?.issues || []
  const facility = data?.facility_name || 'OpsPoint'

  const residents = useMemo(
    () => (data?.clients || []).filter(c => c.is_active && !c.is_special && c.name !== 'VACANT'),
    [data]
  )
  const total = residents.length

  const census = useMemo(() => {
    const c = { building: 0, work: 0, pass: 0, bhc: 0, efc: 0, hospital: 0, out: 0 }
    residents.forEach(r => { const s = statuses[r.id] || 'building'; if (c[s] != null) c[s]++ })
    return c
  }, [residents, statuses])

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

  const donut = useMemo(() => {
    const labels = [], series = [], colors = []
    STATUS_ORDER.forEach(s => { if (census[s] > 0) { labels.push(STATUS_META[s].label); series.push(census[s]); colors.push(STATUS_META[s].color) } })
    return { labels, series, colors }
  }, [census])

  const recent = logs.slice(-8).reverse()
  const lastWellness = [...logs].reverse().find(l => (l.text || '').toLowerCase().startsWith('wellness check'))
  const lastWalk     = [...logs].reverse().find(l => (l.text || '').toLowerCase().includes('walkthrough'))

  const cardCls = 'bg-white border border-gray-200 shadow-sm rounded-xl dark:bg-gray-800 dark:border-gray-700'

  return (
    <div className="flex-1 min-h-0 p-5 space-y-4 overflow-y-auto">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {report?.shift ? `${report.shift} · ` : ''}{facility}
            {report?.report_date ? <span className="font-mono"> · {report.report_date}</span> : ''}
            {report?.mod_name ? ` · PA ${report.mod_name}` : ''}
          </p>
        </div>
        <button
          onClick={() => onNavigate?.('report')}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-white rounded-lg bg-primary-600 hover:bg-primary-700"
        >
          <FileText className="w-4 h-4" /> Open Report
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="On Site" value={`${onSite}/${total}`} sub="residents in building" Icon={MapPin} tone="green" />
        <Kpi label="Off Site" value={offSite} sub="pass · work · appointment" Icon={DoorOpen} tone="orange" />
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
                chart: { toolbar: { show: false }, fontFamily: 'inherit', sparkline: { enabled: false } },
                colors: ['#2563eb'],
                dataLabels: { enabled: false },
                stroke: { curve: 'smooth', width: 2 },
                fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05 } },
                grid: { borderColor: '#e5e7eb', strokeDashArray: 4 },
                xaxis: { categories: activity.cats, labels: { style: { colors: '#9ca3af' } }, axisBorder: { show: false }, axisTicks: { show: false } },
                yaxis: { labels: { style: { colors: '#9ca3af' } }, min: 0, forceNiceScale: true },
                tooltip: { theme: 'light' },
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
                chart: { fontFamily: 'inherit' },
                legend: { position: 'bottom', labels: { colors: '#6b7280' } },
                dataLabels: { enabled: false },
                stroke: { width: 0 },
                plotOptions: { pie: { donut: { size: '72%', labels: { show: true, total: { show: true, label: 'Total', color: '#6b7280', formatter: () => String(total) } } } } },
                tooltip: { theme: 'light' },
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
        <div className={`${cardCls} lg:col-span-2 overflow-hidden`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Roster</h2>
            <button onClick={() => onNavigate?.('clients')} className="text-xs font-medium text-primary-600 hover:text-primary-700">View all</button>
          </div>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  <th className="px-5 py-2.5 font-semibold text-left">Resident</th>
                  <th className="px-3 py-2.5 font-semibold text-left">Case Manager</th>
                  <th className="px-5 py-2.5 font-semibold text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {residents.map(r => {
                  const meta = STATUS_META[statuses[r.id] || 'building'] || STATUS_META.building
                  return (
                    <tr key={r.id} className="hover:bg-primary-50/60 dark:hover:bg-gray-700/40">
                      <td className="px-5 py-2.5">
                        <div className="font-semibold text-gray-900 dark:text-white">{r.name}</div>
                        <div className="text-xs text-gray-400 font-mono">Rm {r.room}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">{r.case_manager || '—'}</td>
                      <td className="px-5 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${meta.badge}`}>{meta.label}</span>
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
        <div className="space-y-4">
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
            <div className="mt-3 space-y-3">
              {recent.length === 0 && <p className="text-sm text-gray-400">No entries yet.</p>}
              {recent.map(l => (
                <div key={l.id} className="flex gap-2.5">
                  <Clock className="w-3.5 h-3.5 mt-0.5 text-gray-300 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700 dark:text-gray-200">{l.text}</p>
                    <p className="text-xs text-gray-400 font-mono">{l.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
