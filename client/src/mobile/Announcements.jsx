import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Spinner, Textarea } from 'flowbite-react'
import { ChevronLeft, Megaphone } from 'lucide-react'
import { useMobile } from './context.js'
import { api } from './api.js'
import { Card } from './ui.jsx'
import { markAnnouncementsSeen, fmtSent } from './model.js'

// The last week of announcements, and sending one for those allowed to.
export default function Announcements() {
  const { hasPerm, toast } = useMobile()
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const canSend = hasPerm('broadcast.send')

  const load = useCallback(async () => {
    try {
      const rows = await api('GET', '/api/broadcasts?hours=168')
      setList(rows)
      setError(null)
      markAnnouncementsSeen(rows)
    } catch (e) { setError(e) }
  }, [])
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  async function send(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      await api('POST', '/api/broadcasts', { message: text.trim() })
      setText('')
      toast('Announcement sent.', 'ok')
      await load()
    } catch (err) {
      toast(`Not sent: ${err.message}`, 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-6">
      <header className="flex flex-col gap-1 px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Link to="/m/more" className="-ml-2 inline-flex h-11 items-center gap-1 self-start px-2 text-[15px] font-semibold text-primary-700 dark:text-primary-300">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />More
        </Link>
        <h1 className="font-display text-2xl font-bold tracking-tight">Announcements</h1>
      </header>

      <div className="flex flex-col gap-4 px-4">
        {canSend && (
          <Card>
            <form onSubmit={send} className="flex flex-col gap-2 p-3">
              <label htmlFor="bc-text" className="text-sm font-semibold">Send to all staff</label>
              <Textarea id="bc-text" rows={3} maxLength={500} value={text} onChange={e => setText(e.target.value)} placeholder="Keep resident details out of announcements." required />
              <Button type="submit" disabled={busy || !text.trim()} className="w-full">
                <Megaphone className="mr-2 h-4 w-4" aria-hidden="true" />Send announcement
              </Button>
            </form>
          </Card>
        )}

        {error && <Alert color="failure">Couldn&rsquo;t load announcements: {error.message}.</Alert>}
        {!list && !error && <div className="flex justify-center py-10"><Spinner size="lg" aria-label="Loading" /></div>}
        {list && list.length === 0 && <p className="px-1 text-sm text-gray-600 dark:text-gray-400">No announcements in the last week.</p>}
        {list && list.length > 0 && (
          <Card className="overflow-hidden">
            {list.map(b => (
              <article key={b.id} className="flex flex-col gap-1 border-b border-gray-200 px-4 py-3 last:border-b-0 dark:border-gray-700">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold">{b.sender_name}</span>
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{fmtSent(b.created_at)}</span>
                </div>
                <p className="whitespace-pre-line text-[15px] leading-snug">{b.message}</p>
              </article>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
