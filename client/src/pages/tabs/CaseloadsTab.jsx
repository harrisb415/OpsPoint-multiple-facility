import { useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Users, UserCheck, UserX, Calendar } from 'lucide-react'
import { Breadcrumb, BreadcrumbItem } from 'flowbite-react'
import { useData } from '../../contexts/DataContext.jsx'
import { StatusBadge } from '../../components/ui.jsx'

const STATUS_LABEL = {
  building: 'In Building', work: 'Work', pass: 'Weekend Pass',
  out: 'Out / Other', bhc: 'BHC', efc: 'EFC', hospital: 'Hospital',
}
const STATUS_BADGE = {
  building: 'success', work: 'info', pass: 'warning',
  out: 'gray', bhc: 'purple', efc: 'purple', hospital: 'failure',
}
// Column icon-tile tints (literal class strings — Tailwind JIT can't see dynamic names)
const COL_TINT = [
  'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300',
  'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300',
  'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300',
  'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-300',
  'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
]
const GRID = { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4' }

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function formatPhone(raw) {
  if (!raw) return ''
  const d = String(raw).replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

function ResidentCard({ c, status }) {
  const phone = formatPhone(c.phone)
  return (
    <div className="p-3 bg-white border border-gray-200 rounded-lg shadow-sm dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{c.name}</p>
        <StatusBadge color={STATUS_BADGE[status] || 'gray'} className="shrink-0">{STATUS_LABEL[status] || status}</StatusBadge>
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Rm {c.room}{phone ? ' · ' + phone : ''}</p>
      {c.intake_date && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-400">
          <Calendar className="w-3.5 h-3.5" /><span className="font-mono">Intake {fmtDate(c.intake_date)}</span>
        </div>
      )}
    </div>
  )
}

function Column({ Icon, title, tint, count, children, empty }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`flex items-center justify-center w-6 h-6 rounded-lg shrink-0 ${tint}`}><Icon className="w-3.5 h-3.5" /></span>
          <h3 className="text-sm font-semibold text-gray-900 whitespace-nowrap dark:text-white">{title}</h3>
        </div>
        <span className="px-2 text-xs font-medium text-gray-500 bg-gray-100 rounded-full shrink-0 dark:bg-gray-700 dark:text-gray-300">{count}</span>
      </div>
      <div className="space-y-2">
        {children}
        {empty}
      </div>
    </div>
  )
}

export default function CaseloadsTab() {
  const { data } = useData()
  const clients = data?.clients || []
  const reports = data?.reports || []
  const activeId = data?.active_report_id
  const { globalSearch = '' } = useOutletContext() || {}

  const activeReport = reports.find(r => r.id === activeId)
  const statuses = activeReport?.statuses || {}

  const match = c => {
    const q = globalSearch.trim().toLowerCase()
    return !q || `${c.name} ${c.room} ${c.case_manager || ''}`.toLowerCase().includes(q)
  }

  const grouped = useMemo(() => {
    const active = clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT' && c.case_manager)
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0))
    const map = new Map()
    active.forEach(c => {
      const cm = c.case_manager || 'Unassigned'
      if (!map.has(cm)) map.set(cm, [])
      map.get(cm).push(c)
    })
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [clients])

  const unassigned = useMemo(() =>
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT' && !c.case_manager)
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [clients]
  )

  const assignedTotal = grouped.reduce((n, [, list]) => n + list.length, 0)

  // Build column descriptors
  const columns = grouped.map(([cm, list], i) => ({
    Icon: Users, title: cm, tint: COL_TINT[i % COL_TINT.length], count: list.length, list,
  }))
  if (unassigned.length > 0) {
    columns.push({ Icon: UserX, title: 'No Case Manager', tint: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', count: unassigned.length, list: unassigned })
  }
  const n = Math.min(columns.length, 4) || 1

  const kpis = [
    { label: 'Case Managers', value: grouped.length, sub: 'with assignments', Icon: UserCheck, tint: COL_TINT[0] },
    { label: 'Assigned', value: assignedTotal, sub: 'residents on a caseload', Icon: Users, tint: COL_TINT[2] },
    { label: 'Unassigned', value: unassigned.length, sub: 'no case manager', Icon: UserX, tint: COL_TINT[4] },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <Breadcrumb className="mb-1">
          <BreadcrumbItem>People</BreadcrumbItem>
          <BreadcrumbItem>Caseloads</BreadcrumbItem>
        </Breadcrumb>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Caseloads</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Active residents grouped by case manager</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map(k => (
          <div key={k.label} className="p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 sm:p-5 dark:bg-gray-800">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">{k.label}</h3>
                <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{k.value}</p>
                <p className="mt-2 text-xs text-gray-400">{k.sub}</p>
              </div>
              <div className={`flex items-center justify-center rounded-lg w-11 h-11 ${k.tint}`}><k.Icon className="w-5 h-5" /></div>
            </div>
          </div>
        ))}
      </div>

      {columns.length === 0 ? (
        <div className="p-8 text-sm text-center text-gray-400 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 dark:bg-gray-800">
          No active residents with case managers assigned.
        </div>
      ) : (
        <div className={`grid gap-4 sm:grid-cols-2 ${GRID[n]}`}>
          {columns.map((col, i) => {
            const visible = col.list.filter(match)
            return (
              <Column key={i} Icon={col.Icon} title={col.title} tint={col.tint} count={col.count}
                empty={visible.length === 0 ? <div className="p-3 text-xs text-center text-gray-400 border border-gray-200 border-dashed rounded-lg dark:border-gray-700">No matches</div> : null}>
                {visible.map(c => <ResidentCard key={c.id} c={c} status={statuses[c.id] || 'building'} />)}
              </Column>
            )
          })}
        </div>
      )}
    </div>
  )
}
