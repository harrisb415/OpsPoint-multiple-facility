import { useState } from 'react'
import { Alert, Button, Textarea, TextInput } from 'flowbite-react'
import { CloudOff, TriangleAlert } from 'lucide-react'
import { useMobile } from './context.js'
import { Card, ScreenHeader } from './ui.jsx'
import { nowHHMM, toLogTime } from './schedule.js'
import { voidNote } from '../utils/logLines.js'

// The active shift report's log, newest first, with a quick entry form. An
// entry made without signal waits on the phone (outbox.js) and shows here,
// marked, until it's sent.
export default function Log() {
  const { snap, hasPerm, toast, outbox } = useMobile()
  const [time, setTime] = useState(nowHHMM)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const report = snap.report
  const reportOpen = !!report && !report.is_closed
  const canLog = hasPerm('log.add')
  const entries = [...(report?.log_entries || [])].reverse()

  async function add(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    const r = await outbox.enqueue({
      kind: 'log', method: 'PATCH', url: '/api/data',
      body: { reportId: report.id, log_entry: { time: toLogTime(time), text: text.trim() } },
    })
    setBusy(false)
    if (r.failed) { toast(`Not saved: ${r.error}`, 'error'); return }
    setText('')
    setTime(nowHHMM())
    toast(r.queued ? 'No signal. Saved on this phone; it’ll be sent when you’re back online.' : 'Entry added.', r.queued ? 'warn' : 'ok')
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenHeader title="Shift log" subtitle={report ? `${report.shift || 'Shift'} · ${report.report_date}` : 'No shift report open'} />
      <div className="flex flex-col gap-4 px-4">
        {!reportOpen && <Alert color="warning" icon={TriangleAlert}>No shift report is open. Start one on the desktop to add entries.</Alert>}

        {reportOpen && canLog && (
          <Card>
            <form onSubmit={add} className="flex flex-col gap-2 p-3">
              <div className="flex gap-2">
                <label htmlFor="log-time" className="sr-only">Time</label>
                <TextInput id="log-time" type="time" value={time} onChange={e => setTime(e.target.value)} className="w-32 shrink-0" required />
                <span className="self-center text-sm text-gray-500 dark:text-gray-400">Adds to {report.shift || 'the shift'}</span>
              </div>
              <label htmlFor="log-text" className="sr-only">Log entry</label>
              <Textarea id="log-text" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="What happened?" maxLength={2000} required />
              <Button type="submit" disabled={busy || !text.trim()} className="w-full">Add entry</Button>
            </form>
          </Card>
        )}
        {reportOpen && !canLog && <Alert color="gray">You can read the shift log, but your account can&rsquo;t add to it.</Alert>}

        {report && (
          <Card className="overflow-hidden">
            {entries.length === 0 && <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Nothing logged yet this shift.</p>}
            {entries.map(e => (
              <div key={e.id} className="flex gap-3 border-b border-gray-200 px-4 py-3 last:border-b-0 dark:border-gray-700">
                <span className="w-16 shrink-0 pt-0.5 font-mono text-xs font-semibold text-primary-700 dark:text-primary-300">{e.time}</span>
                <span className="min-w-0 whitespace-pre-line text-sm">
                  <span className={e.voided_at ? 'text-gray-400 line-through dark:text-gray-500' : e.pending ? 'text-gray-600 dark:text-gray-300' : ''}>{e.text}</span>
                  {e.voided_at && <span className="block text-xs font-semibold text-red-700 dark:text-red-400">{voidNote(e)}</span>}
                  {e.pending && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                      <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />Waiting to send
                    </span>
                  )}
                </span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
