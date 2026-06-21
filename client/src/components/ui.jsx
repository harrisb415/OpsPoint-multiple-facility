import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'flowbite-react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { initials, avatarColor } from '../utils/ui.js'

// ── Form field: label + control (dark-aware) ───────────────────────────────
export function Field({ label, hint, htmlFor, children, className = '' }) {
  return (
    <div className={className}>
      {label && <label htmlFor={htmlFor} className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>}
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

// ── Inline error line ──────────────────────────────────────────────────────
export const ErrLine = ({ children }) =>
  children ? <p className="min-h-[18px] mt-2 text-sm text-red-600 dark:text-red-400">{children}</p> : null

// ── Promise-based confirm dialog (replaces window.confirm) ──────────────────
const ConfirmCtx = createContext(() => Promise.resolve(false))

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { title, body, confirmText, color }
  const resolver = useRef(null)

  const confirm = useCallback((opts) => {
    setState({ confirmText: 'Confirm', color: 'default', ...opts })
    return new Promise((resolve) => { resolver.current = resolve })
  }, [])

  const close = (result) => { setState(null); resolver.current?.(result); resolver.current = null }

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal show={!!state} size="md" popup onClose={() => close(false)}>
        <ModalHeader />
        <ModalBody>
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">{state?.title}</h3>
          {state?.body && <div className="text-sm text-gray-600 whitespace-pre-line dark:text-gray-300">{state.body}</div>}
        </ModalBody>
        <ModalFooter className="justify-end">
          <Button color="light" onClick={() => close(false)}>Cancel</Button>
          <Button color={state?.color} onClick={() => close(true)}>{state?.confirmText}</Button>
        </ModalFooter>
      </Modal>
    </ConfirmCtx.Provider>
  )
}

export const useConfirm = () => useContext(ConfirmCtx)

// ── Colored initials avatar (matches the design prototype) ─────────────────
// Shows a photo thumbnail when `photo` is provided (a data URI / URL), else the
// deterministic colored initials. Used everywhere a client/person avatar appears.
export function ColoredAvatar({ name, photo, size = 'sm' }) {
  const dim = size === 'lg' ? 'w-11 h-11' : 'w-9 h-9'
  const txt = size === 'lg' ? 'text-sm' : 'text-xs'
  if (photo) {
    return (
      <img src={photo} alt={name || ''} title={name || ''}
        className={`object-cover rounded-full shrink-0 ${dim}`} />
    )
  }
  return (
    <span className={`flex items-center justify-center font-semibold rounded-full shrink-0 ${dim} ${txt} ${avatarColor(name)}`}>
      {initials(name)}
    </span>
  )
}

// Prototype badge class map — accepts both flowbite color names and direct tone names.
const _BADGE_CLS = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  info:    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  failure: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  purple:  'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  pink:    'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  gray:    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  green:   'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  blue:    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  yellow:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  red:     'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  sky:     'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  orange:  'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
}

// ── Prototype-style status badge (rounded-md pill, replaces flowbite Badge) ──
export function StatusBadge({ color = 'gray', children, className = '' }) {
  return (
    <span className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-md whitespace-nowrap ${_BADGE_CLS[color] || _BADGE_CLS.gray} ${className}`}>
      {children}
    </span>
  )
}

// ── Prototype-style filter chip (replaces flowbite Button size="xs" filters) ─
export function FilterChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
        active
          ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-800'
          : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

// ── KPI card delta / trend row ────────────────────────────────────────────────
export function DeltaRow({ delta, label = 'vs prior period' }) {
  if (!delta) return (
    <div className="pt-3 mt-4 border-t border-gray-100 dark:border-gray-700">
      <span className="inline-flex items-center text-sm font-medium text-gray-400">
        <Minus className="w-4 h-4 mr-1" />{label}
      </span>
    </div>
  )
  const up = delta > 0
  return (
    <div className="pt-3 mt-4 border-t border-gray-100 dark:border-gray-700">
      <span className={`inline-flex items-center text-sm font-medium ${up ? 'text-green-500' : 'text-red-500'}`}>
        {up ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
        {up ? '+' : ''}{delta}
        <span className="ml-1.5 font-normal text-gray-400">{label}</span>
      </span>
    </div>
  )
}
