import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'flowbite-react'
import { ArrowRight, CircleAlert, ListChecks } from 'lucide-react'
import { usePermission } from '../hooks/usePermission.js'
import { CARD_HEAD, CARD_HEAD_TITLE } from '../utils/ui.js'

// On the dashboard, for admins: while setup isn't finished, a way back into
// it; afterwards, what was skipped or still needs doing (server/modules/setup),
// until someone dismisses it.
export default function SetupChecklist() {
  const { hasPerm } = usePermission()
  const allowed = hasPerm('admin.settings')
  const navigate = useNavigate()
  const [shown, setShown] = useState(null)       // { mode: 'wizard', left } | { mode: 'list', items }
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!allowed) return undefined
    let off = false
    const get = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ;(async () => {
      const st = await get('/api/setup/status')
      if (off || !st) return
      if (st.state === 'wizard' && st.steps) { setShown({ mode: 'wizard', left: st.steps.filter((s) => !s.state).length }); return }
      if (st.state !== 'done') return
      const cl = await get('/api/setup/checklist')
      if (!off && cl && cl.show) setShown({ mode: 'list', items: cl.items })
    })()
    return () => { off = true }
  }, [allowed])

  async function dismiss() {
    setBusy(true)
    const r = await fetch('/api/setup/checklist/dismiss', { method: 'POST', credentials: 'include' }).catch(() => null)
    setBusy(false)
    if (r && r.ok) setShown(null)
  }

  if (!shown) return null
  if (shown.mode === 'wizard') {
    return (
      <div className="flex flex-col gap-3 p-4 border rounded-2xl sm:flex-row sm:items-center sm:justify-between border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-900/20">
        <p className="flex items-center gap-2 text-sm text-primary-900 dark:text-primary-100">
          <ListChecks className="w-5 h-5 shrink-0" />
          Setup isn't finished: {shown.left} step{shown.left === 1 ? '' : 's'} left.
        </p>
        <Button size="sm" onClick={() => navigate('/setup')}>Continue setup<ArrowRight className="w-4 h-4 ml-2" /></Button>
      </div>
    )
  }
  return (
    <section className="overflow-hidden bg-white border border-gray-200 shadow-sm rounded-2xl dark:bg-gray-800 dark:border-gray-700" aria-labelledby="setup-checklist-title">
      <div className={CARD_HEAD}>
        <h2 id="setup-checklist-title" className={CARD_HEAD_TITLE}>Setup checklist</h2>
        <Button size="xs" color="light" onClick={dismiss} disabled={busy}>Dismiss</Button>
      </div>
      <ul className="px-5 py-3 divide-y divide-gray-100 dark:divide-gray-700">
        {shown.items.map((it) => (
          <li key={it.id} className="flex items-start gap-3 py-2 text-sm text-gray-700 dark:text-gray-300">
            <CircleAlert className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
