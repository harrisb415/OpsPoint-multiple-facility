import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'flowbite-react'
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
export function ColoredAvatar({ name, size = 'sm' }) {
  const dim = size === 'lg' ? 'w-11 h-11 text-sm' : 'w-9 h-9 text-xs'
  return (
    <span className={`flex items-center justify-center font-semibold rounded-full shrink-0 ${dim} ${avatarColor(name)}`}>
      {initials(name)}
    </span>
  )
}
