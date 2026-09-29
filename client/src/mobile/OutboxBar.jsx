import { useState } from 'react'
import { Button, Spinner } from 'flowbite-react'
import { CloudOff, CircleAlert, LogIn } from 'lucide-react'
import { useMobile } from './context.js'
import { Sheet } from './ui.jsx'
import { describe } from './outbox.js'
import { fmtClock } from './schedule.js'

const entries = (n) => (n === 1 ? '1 saved entry' : `${n} saved entries`)

// Above the tab bar: no connection (and how old the data on screen is),
// entries waiting to send, and any the server refused.
export default function OutboxBar() {
  const { box, offline, snap } = useMobile()
  const [showFailed, setShowFailed] = useState(false)
  const waiting = box.items.length
  const failed = box.failed.length
  const signin = box.net === 'signin' && waiting > 0
  if (!offline && !waiting && !failed) return null

  let row = null
  if (signin) {
    row = (
      <div className="flex items-center gap-3 px-4 py-2">
        <LogIn className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-semibold">Signed out. Sign in to send {entries(waiting)}.</p>
        <Button size="xs" onClick={() => { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname) }}>Sign in</Button>
      </div>
    )
  } else if (offline) {
    row = (
      <div className="flex items-center gap-3 px-4 py-2">
        <CloudOff className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">No connection{waiting ? ` · ${waiting} waiting to send` : ''}</span>
          {snap.loaded_at && <span className="block text-xs text-gray-600 dark:text-gray-300">Showing what was loaded at {fmtClock(new Date(snap.loaded_at))}</span>}
        </p>
      </div>
    )
  } else if (waiting) {
    row = (
      <div className="flex items-center gap-3 px-4 py-2">
        <Spinner size="sm" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-semibold">Sending {entries(waiting)}…</p>
      </div>
    )
  }

  return (
    <>
      <div role="status" aria-live="polite" className="shrink-0 border-t border-amber-200 bg-amber-50 text-gray-900 dark:border-amber-900 dark:bg-amber-950 dark:text-gray-100">
        {row}
        {failed > 0 && (
          <div className={`flex items-center gap-3 px-4 py-2 ${row ? 'border-t border-amber-200 dark:border-amber-900' : ''}`}>
            <CircleAlert className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm font-semibold text-red-800 dark:text-red-300">{failed === 1 ? '1 entry' : `${failed} entries`} couldn&rsquo;t be sent</p>
            <Button size="xs" color="light" onClick={() => setShowFailed(true)}>View</Button>
          </div>
        )}
      </div>
      <FailedSheet open={showFailed && failed > 0} onClose={() => setShowFailed(false)} />
    </>
  )
}

// What the server refused, and why. A log entry whose shift has closed can go
// to the shift open now; the rest belong to a round that has moved on.
function FailedSheet({ open, onClose }) {
  const { box, outbox, snap, hasPerm } = useMobile()
  const reportOpen = !!snap.report && !snap.report.is_closed
  const canLog = hasPerm('log.add')

  return (
    <Sheet open={open} onClose={onClose} title="Couldn’t be sent">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">These were saved on this phone without signal, and the server refused them when they were sent. Nothing was recorded for them.</p>
        <div className="flex flex-col">
          {box.failed.map(f => (
            <div key={f.id} className="flex flex-col gap-1 border-b border-gray-200 py-3 last:border-b-0 dark:border-gray-700">
              <p className="whitespace-pre-line break-words text-sm font-semibold">{describe(f, snap)}</p>
              <p className="text-xs font-semibold text-red-700 dark:text-red-400">{f.error}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Made at {fmtClock(new Date(f.createdAt))}</p>
              <div className="mt-1 flex gap-2">
                {f.kind === 'log' && reportOpen && canLog && (
                  <Button size="xs" onClick={() => outbox.resend(f.id, { body: { ...f.body, reportId: snap.report.id } })}>Add to this shift</Button>
                )}
                <Button size="xs" color="light" onClick={() => outbox.dismiss(f.id)}>Dismiss</Button>
              </div>
            </div>
          ))}
        </div>
        {box.failed.length > 1 && (
          <Button color="light" onClick={() => { box.failed.forEach(f => outbox.dismiss(f.id)); onClose() }}>Dismiss all</Button>
        )}
      </div>
    </Sheet>
  )
}
