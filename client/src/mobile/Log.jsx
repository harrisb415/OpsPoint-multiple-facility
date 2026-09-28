import { useState } from 'react'
import { Alert, Button, Textarea, TextInput } from 'flowbite-react'
import { TriangleAlert } from 'lucide-react'
import { useMobile } from './context.js'
import { api } from './api.js'
import { Card, ScreenHeader } from './ui.jsx'
import { nowHHMM, toLogTime } from './schedule.js'

// The active shift report's log, newest first, with a quick entry form.
export default function Log() {
  const { snap, hasPerm, toast, reload } = useMobile()
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
    try {
      await api('PATCH', '/api/data', { reportId: report.id, log_entry: { time: toLogTime(time), text: text.trim() } })
      setText('')
      setTime(nowHHMM())
      toast('Entry added.', 'ok')
      await reload()
    } catch (err) {
      toast(`Not saved: ${err.message}`, 'error')
    } finally { setBusy(false) }
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
                <span className="min-w-0 whitespace-pre-line text-sm">{e.text}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
