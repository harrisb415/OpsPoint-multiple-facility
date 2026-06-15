import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { Badge, Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'flowbite-react'

// — Panel: white card with optional title + right-aligned action slot ——————
export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`p-5 mb-4 bg-white border border-gray-200 shadow-sm rounded-xl ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

// — Stat tile (overview) ——————————————————————————————————————————————————
export function Tile({ label, value, hi = false }) {
  return (
    <div className={`rounded-xl border p-4 ${hi
      ? 'border-transparent bg-gradient-to-br from-primary-600 to-primary-800'
      : 'border-gray-200 bg-white shadow-sm'}`}>
      <div className={`text-2xl font-extrabold leading-tight ${hi ? 'text-primary-200' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className={`mt-1 text-xs font-medium uppercase tracking-wide ${hi ? 'text-primary-100' : 'text-gray-500'}`}>
        {label}
      </div>
    </div>
  )
}

// — Status pill ————————————————————————————————————————————————————————————
export function StatusPill({ status }) {
  const ok = status === 'active' || status === 'published'
  return <Badge color={ok ? 'success' : 'failure'} className="inline-flex w-fit">{status}</Badge>
}

// — Form field: label + control —————————————————————————————————————————————
export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block mb-1 text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

// — Inline error / status line ——————————————————————————————————————————————
export const ErrLine = ({ children }) =>
  <p className="min-h-[18px] mt-2 text-sm text-red-600">{children}</p>

// — Confirm dialog (promise-based replacement for window.confirm) ————————————
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
      <Modal show={!!state} size="md" onClose={() => close(false)} popup>
        <ModalHeader />
        <ModalBody>
          <h3 className="mb-2 text-lg font-semibold text-gray-900">{state?.title}</h3>
          {state?.body && <div className="text-sm text-gray-600 whitespace-pre-line">{state.body}</div>}
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
