// Console (light-redesign) UI kit — faithful React port of the prototype's
// archetype renderers (prototype/archetypes.js + screen-facility.js atoms).
// Exact Tailwind classes preserved so converted screens match the handoff.
import { ChevronRight, Minus, TrendingUp, TrendingDown, MoreHorizontal, Search } from 'lucide-react'

export const CARD = 'p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 sm:p-5 dark:bg-gray-800'

/* ── Badge ──────────────────────────────────────────────────────────── */
const BADGE = {
  green:  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  blue:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  red:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  gray:   'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  sky:    'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
}
export function Badge({ tone = 'gray', children }) {
  return <span className={`${BADGE[tone] || BADGE.gray} text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap`}>{children}</span>
}

/* ── Avatar (initials + hash color) ─────────────────────────────────── */
const AV = {
  primary: 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300',
  sky:     'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
  green:   'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  purple:  'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  yellow:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300',
  red:     'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
}
const AVCYCLE = ['primary', 'sky', 'green', 'purple', 'yellow', 'red']
export function ini(n) {
  return String(n || '').replace(/[^A-Za-z. ]/g, '').split(/[. ]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
function pickAv(s) { return AVCYCLE[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVCYCLE.length] }
export function Avatar({ name, square }) {
  return (
    <span className={`flex items-center justify-center text-xs font-semibold shrink-0 w-9 h-9 ${square ? 'rounded-lg' : 'rounded-full'} ${AV[pickAv(name)]}`}>
      {ini(name)}
    </span>
  )
}

/* ── Page header (breadcrumb + title + sub + actions) ───────────────── */
export function Header({ crumb, title, sub, actions }) {
  return (
    <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {crumb && (
          <nav className="flex items-center mb-1 text-xs text-gray-400">
            <span>{crumb[0]}</span><ChevronRight className="w-3.5 h-3.5 mx-1" /><span className="text-gray-600 dark:text-gray-300">{crumb[1]}</span>
          </nav>
        )}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {sub && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{sub}</p>}
      </div>
      {actions && actions.length > 0 && (
        <div className="flex items-center gap-2">
          {actions.map((a, i) => (
            <button key={i} onClick={a.onClick}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg ${a.primary ? 'text-white shadow-sm bg-primary-600 hover:bg-primary-700' : 'text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>
              {a.Icon && <a.Icon className="w-4 h-4" />}{a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── KPI card (with delta footer) + row ─────────────────────────────── */
const TINT = {
  primary: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300',
  sky:     'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300',
  green:   'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300',
  yellow:  'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-300',
  red:     'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
}
function Delta({ d, label }) {
  if (!d) return <span className="inline-flex items-center text-sm font-medium text-gray-400"><Minus className="w-4 h-4 mr-1" />{label}</span>
  const up = d > 0
  const I = up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center text-sm font-medium ${up ? 'text-green-500' : 'text-red-500'}`}>
      <I className="w-4 h-4 mr-1" />{up ? '+' : ''}{d}<span className="ml-1.5 font-normal text-gray-400">{label}</span>
    </span>
  )
}
export function Kpi({ label, value, sub, delta = 0, deltaLabel = '', Icon, accent = 'primary' }) {
  return (
    <div className={CARD}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">{label}</h3>
          <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{value}</p>
          {sub && <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
        </div>
        {Icon && <div className={`flex items-center justify-center w-11 h-11 rounded-lg ${TINT[accent] || TINT.primary}`}><Icon className="w-5 h-5" /></div>}
      </div>
      <div className="pt-3 mt-4 border-t border-gray-100 dark:border-gray-700"><Delta d={delta} label={deltaLabel} /></div>
    </div>
  )
}
export function KpiRow({ children }) {
  return <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
}

/* ── Toolbar (filter chips + count + search) ────────────────────────── */
export function Toolbar({ filters = [], active = 0, onFilter, count, search, onSearch, searchPlaceholder = 'Filter…' }) {
  return (
    <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f, i) => (
          <button key={f} onClick={() => onFilter?.(i)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${i === active ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-800' : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'}`}>
            {f}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {count != null && <span className="text-sm text-gray-400">{count} records</span>}
        {onSearch && (
          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none"><Search className="w-4 h-4 text-gray-400" /></div>
            <input type="text" value={search} onChange={e => onSearch(e.target.value)} placeholder={searchPlaceholder}
              className="block w-full py-2 pl-9 pr-3 text-sm text-gray-900 border border-gray-200 rounded-lg sm:w-56 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white" />
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Table (wrapper + header) + cells ───────────────────────────────── */
export const TH = 'p-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase dark:text-gray-300'
export function Table({ headers = [], children }) {
  return (
    <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl dark:bg-gray-800 dark:border-gray-700">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-700">
          <tr>{headers.map((h, i) => <th key={i} className={`${TH} ${h.right ? 'text-right' : ''}`}>{h.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">{children}</tbody>
      </table>
    </div>
  )
}
export const rowCls = (i, clickable) => `${i % 2 ? 'bg-gray-50 dark:bg-gray-700/40' : 'bg-white dark:bg-gray-800'}${clickable ? ' hover:bg-primary-50/60 dark:hover:bg-gray-700 cursor-pointer' : ''}`

export function NameCell({ name, sub, onClick, square }) {
  return (
    <td className="p-3 whitespace-nowrap">
      <div className="flex items-center gap-3">
        <Avatar name={name} square={square} />
        <div>
          {onClick
            ? <button onClick={onClick} className="text-sm font-semibold text-left text-gray-900 dark:text-white hover:text-primary-700 hover:underline">{name}</button>
            : <p className="text-sm font-semibold text-gray-900 dark:text-white">{name}</p>}
          {sub && <p className="font-mono text-xs text-gray-400">{sub}</p>}
        </div>
      </div>
    </td>
  )
}
export const BadgeCell = ({ tone, label, children }) => <td className="p-3 whitespace-nowrap"><Badge tone={tone}>{label ?? children}</Badge></td>
export const TextCell  = ({ children }) => <td className="p-3 text-sm text-gray-700 whitespace-nowrap dark:text-gray-200">{children}</td>
export const MutedCell = ({ children }) => <td className="p-3 text-sm text-gray-500 dark:text-gray-400">{children}</td>
export const MonoCell  = ({ children }) => <td className="p-3 font-mono text-sm text-gray-500 whitespace-nowrap dark:text-gray-400">{children}</td>
export const StrongCell = ({ children }) => <td className="p-3 text-sm font-semibold text-gray-900 whitespace-nowrap dark:text-white">{children}</td>
export const DaysCell  = ({ children }) => <td className="p-3 whitespace-nowrap"><span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{children}</span><span className="ml-1 text-xs text-gray-400">days</span></td>
export const ActionsCell = ({ children }) => <td className="p-3 text-right whitespace-nowrap">{children || <button className="p-1.5 text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"><MoreHorizontal className="w-4 h-4" /></button>}</td>
