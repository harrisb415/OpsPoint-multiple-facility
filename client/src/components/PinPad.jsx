import { useState } from 'react'
import { Delete } from 'lucide-react'

// A 6-digit PIN keypad: dots for what's entered, big keys, and onComplete
// once all six are in. Shared by the login page (quick unlock) and the mobile
// app's PIN setup. The pad clears itself after each six digits; the parent
// shows any error.
export default function PinPad({ onComplete, busy = false, label = 'PIN' }) {
  const [pin, setPin] = useState('')

  function press(d) {
    if (busy || pin.length >= 6) return
    const next = pin + d
    setPin(next)
    if (next.length === 6) {
      setTimeout(() => { setPin(''); onComplete(next) }, 120)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div role="status" aria-label={`${label}: ${pin.length} of 6 digits entered`} className="flex gap-3.5">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full border-2 ${i < pin.length
              ? 'border-primary-700 bg-primary-700 dark:border-primary-400 dark:bg-primary-400'
              : 'border-gray-400 dark:border-gray-500'}`}
          />
        ))}
      </div>
      <div className="grid w-[264px] grid-cols-3 gap-x-5 gap-y-3.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            disabled={busy}
            className="h-16 rounded-full border border-gray-200 bg-white font-display text-3xl font-semibold text-gray-900 active:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:active:bg-gray-700"
          >{d}</button>
        ))}
        <span />
        <button
          type="button"
          onClick={() => press('0')}
          disabled={busy}
          className="h-16 rounded-full border border-gray-200 bg-white font-display text-3xl font-semibold text-gray-900 active:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:active:bg-gray-700"
        >0</button>
        <button
          type="button"
          aria-label="Delete last digit"
          onClick={() => setPin(p => p.slice(0, -1))}
          disabled={busy || !pin}
          className="flex h-16 items-center justify-center rounded-full text-gray-600 disabled:opacity-40 dark:text-gray-300"
        >
          <Delete className="h-7 w-7" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
