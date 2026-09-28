// Small building blocks shared by the mobile screens.
import { Toast } from 'flowbite-react'
import { CircleCheck, TriangleAlert, CircleAlert } from 'lucide-react'
import { initials } from '../utils/ui.js'

export function Card({ className = '', children, ...rest }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${className}`} {...rest}>
      {children}
    </section>
  )
}

export function SectionTitle({ children, count, id }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <h2 id={id} className="text-base font-bold text-gray-900 dark:text-white">{children}</h2>
      {count != null && (
        <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary-100 px-2 text-xs font-bold text-primary-800 dark:bg-primary-900 dark:text-primary-200">
          {count}
        </span>
      )}
    </div>
  )
}

// A progress bar on the native element (it carries the semantics), styled
// through its pseudo-elements. `onHero` is for the coloured hero card.
export function Bar({ value, max, onHero = false, label }) {
  const skin = onHero
    ? '[&::-webkit-progress-bar]:bg-white/25 [&::-webkit-progress-value]:bg-white [&::-moz-progress-bar]:bg-white bg-white/25'
    : '[&::-webkit-progress-bar]:bg-gray-200 [&::-webkit-progress-value]:bg-primary-600 [&::-moz-progress-bar]:bg-primary-600 bg-gray-200 dark:[&::-webkit-progress-bar]:bg-gray-700 dark:bg-gray-700 dark:[&::-webkit-progress-value]:bg-primary-400 dark:[&::-moz-progress-bar]:bg-primary-400'
  return (
    <progress
      value={Math.max(0, Math.min(value, max))}
      max={max || 1}
      aria-label={label}
      className={`block h-2 w-full appearance-none overflow-hidden rounded-full border-0 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full ${skin}`}
    />
  )
}

export function Initials({ name, className = '' }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-primary-100 font-bold text-primary-800 dark:bg-primary-900 dark:text-primary-200 ${className}`}>
      {initials(name).slice(0, 2).toUpperCase() || '?'}
    </span>
  )
}

const TOAST = {
  ok: { Icon: CircleCheck, cls: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200' },
  warn: { Icon: TriangleAlert, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200' },
  error: { Icon: CircleAlert, cls: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200' },
}

export function Toaster({ toast }) {
  if (!toast) return null
  const { Icon, cls } = TOAST[toast.tone] || TOAST.ok
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))]" role="status" aria-live="polite">
      <Toast className="pointer-events-auto w-full max-w-sm shadow-lg">
        <div className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cls}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="ml-3 text-sm font-medium text-gray-800 dark:text-gray-100">{toast.message}</div>
      </Toast>
    </div>
  )
}

// Top of a screen, clear of the notch on an installed app.
export function ScreenHeader({ title, subtitle, right }) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="min-w-0">
        <h1 className="truncate font-display text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{title}</h1>
        {subtitle && <p className="truncate text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>}
      </div>
      {right}
    </header>
  )
}
