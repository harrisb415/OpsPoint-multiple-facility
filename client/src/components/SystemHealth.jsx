import { useEffect, useState } from 'react'
import { Alert, Badge, Button } from 'flowbite-react'
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from 'lucide-react'
import { useConfirm } from './ui.jsx'

// Admin › System › System health: the same checks as /healthz and
// `node server/cli/opspoint.js doctor` (server/health), with what each one
// found and how to fix a failure. Every status is also a word, never colour
// alone.
const TONE = {
  pass: { Icon: CircleCheck,   cls: 'text-green-600 dark:text-green-400', word: 'Pass' },
  warn: { Icon: TriangleAlert, cls: 'text-amber-500 dark:text-amber-400', word: 'Needs attention' },
  fail: { Icon: CircleX,       cls: 'text-red-600 dark:text-red-400',     word: 'Fail' },
  skip: { Icon: CircleMinus,   cls: 'text-gray-400 dark:text-gray-500',   word: 'Not used here' },
}

function checkedAgo(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (!Number.isFinite(mins)) return ''
  if (mins < 1) return 'just now'
  if (mins < 90) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleString()
}

export default function SystemHealth() {
  const confirm = useConfirm()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')      // '' | 'run' | 'key'
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/system/health', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('The health check could not be loaded.'))))
      .then((j) => { if (alive) setData(j) }, (e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [])

  async function post(url, which) {
    setBusy(which); setErr('')
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'The health check could not run.')
      setData(j)
    } catch (e) { setErr(e.message || 'Network error.') }
    finally { setBusy('') }
  }

  async function confirmKey() {
    const ok = await confirm({
      title: 'Is the key stored somewhere else?',
      body: 'Confirm only after the database key file is copied off this machine: a password manager, or a USB key kept apart from the backups. Without it the database and every backup of it are unreadable.',
      confirmText: 'It is stored elsewhere',
    })
    if (ok) post('/api/system/health/dbkey-confirmed', 'key')
  }

  const used = data ? data.results.filter((x) => x.status !== 'skip').length : 0
  const attention = data ? data.results.filter((x) => x.status === 'fail' || x.status === 'warn').length : 0
  const failing = data ? data.results.some((x) => x.status === 'fail') : false

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        {data
          ? (attention === 0
            ? <Badge color="success">All {used} checks pass</Badge>
            : <Badge color={failing ? 'failure' : 'warning'}>{attention} need{attention === 1 ? 's' : ''} attention</Badge>)
          : !err && <span className="text-sm text-gray-500 dark:text-gray-400">Checking…</span>}
        {data && <span className="text-xs text-gray-500 dark:text-gray-400">Checked {checkedAgo(data.at)}</span>}
        <Button size="xs" color="light" className="ml-auto" onClick={() => post('/api/system/health/run', 'run')} disabled={!!busy}>
          {busy === 'run' ? 'Checking…' : 'Run checks now'}
        </Button>
      </div>
      {err && <Alert color="failure" className="mb-3">{err}</Alert>}
      {data && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {data.results.map((x) => {
            const { Icon, cls, word } = TONE[x.status] || TONE.skip
            return (
              <li key={x.id} className="flex gap-3 py-2.5">
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${cls}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{x.label}</span>
                    <span className={`text-xs font-medium ${cls}`}>{word}</span>
                  </div>
                  <p className="text-sm text-gray-600 break-words dark:text-gray-300">{x.says}</p>
                  {x.fix && (x.status === 'fail' || x.status === 'warn') && (
                    <p className="mt-0.5 text-xs text-gray-500 break-words dark:text-gray-400">Fix: {x.fix}</p>
                  )}
                  {x.action === 'dbkey-confirm' && (
                    <Button size="xs" className="mt-2" onClick={confirmKey} disabled={!!busy}>
                      {busy === 'key' ? 'Saving…' : 'Key stored elsewhere'}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
