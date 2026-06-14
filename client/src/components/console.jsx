// Shared Console (light-redesign) UI primitives — used across the converted
// facility screens so tables/headers/cards stay consistent. Pure presentational.
import { ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react'

export const CARD = 'bg-white border border-gray-200 shadow-sm rounded-xl dark:bg-gray-800 dark:border-gray-700'
// Console table header cell
export const TH = 'px-4 py-2.5 text-[11px] font-semibold tracking-wider text-left uppercase text-gray-500 dark:text-gray-300'

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

const STAT_TONE = {
  blue:   'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
  green:  'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400',
  orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400',
  purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400',
  red:    'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
  gray:   'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}
export function StatCard({ label, value, tone = 'blue', Icon }) {
  return (
    <div className={`${CARD} p-4 flex items-center gap-3`}>
      {Icon && (
        <span className={`flex items-center justify-center w-10 h-10 rounded-lg shrink-0 ${STAT_TONE[tone] || STAT_TONE.blue}`}>
          <Icon className="w-5 h-5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none text-gray-900 dark:text-white font-mono tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</p>
      </div>
    </div>
  )
}

const PILL_TONE = {
  green:  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  blue:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  red:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  gray:   'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}
export function Pill({ tone = 'gray', children }) {
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${PILL_TONE[tone] || PILL_TONE.gray}`}>{children}</span>
}

export function SortHeader({ col, sortKey, sortDir, onSort, children, className = '' }) {
  const active = sortKey === col
  const Icon = !active ? ChevronsUpDown : (sortDir === 'asc' ? ChevronUp : ChevronDown)
  return (
    <th onClick={() => onSort(col)} className={`${TH} cursor-pointer select-none whitespace-nowrap ${className}`}>
      <span className="inline-flex items-center gap-1">
        {children}<Icon className={`w-3 h-3 ${active ? 'text-primary-600' : 'text-gray-300'}`} />
      </span>
    </th>
  )
}
