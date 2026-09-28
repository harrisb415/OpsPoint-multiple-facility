import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Spinner, TextInput } from 'flowbite-react'
import { ChevronLeft, Phone, MessageSquare, Search } from 'lucide-react'
import { api } from './api.js'
import { Card, Initials } from './ui.jsx'

// A tel:/sms: target holds digits and a leading + only.
const dial = (n) => String(n || '').replace(/[^\d+]/g, '')

// The staff directory, grouped as on the desktop, with tap to call or text.
export default function Staff() {
  const [staff, setStaff] = useState(null)
  const [order, setOrder] = useState([])
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([api('GET', '/api/staff'), api('GET', '/api/staff/categories').catch(() => [])])
      .then(([list, cats]) => {
        if (cancelled) return
        setStaff(Array.isArray(list) ? list : [])
        setOrder(Array.isArray(cats) ? cats.map(c => (typeof c === 'string' ? c : c?.name)).filter(Boolean) : [])
      })
      .catch(e => { if (!cancelled) setError(e) })
    return () => { cancelled = true }
  }, [])

  const query = q.trim().toLowerCase()
  const groups = []
  for (const s of staff || []) {
    if (query && !`${s.name} ${s.category || ''} ${s.notes || ''}`.toLowerCase().includes(query)) continue
    const cat = s.category || 'Staff'
    let g = groups.find(x => x.label === cat)
    if (!g) groups.push(g = { label: cat, rows: [] })
    g.rows.push(s)
  }
  const rank = (label) => { const i = order.indexOf(label); return i < 0 ? order.length : i }
  groups.sort((a, b) => rank(a.label) - rank(b.label))

  return (
    <div className="flex min-w-0 flex-col pb-6">
      <header className="sticky top-0 z-10 flex flex-col gap-3 bg-gray-100 px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] dark:bg-gray-900">
        <Link to="/m/more" className="-ml-2 inline-flex h-11 items-center gap-1 self-start px-2 text-[15px] font-semibold text-primary-700 dark:text-primary-300">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />More
        </Link>
        <h1 className="font-display text-2xl font-bold tracking-tight">Staff directory</h1>
        <label htmlFor="staff-search" className="sr-only">Search staff</label>
        <TextInput id="staff-search" type="search" icon={Search} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or role" autoComplete="off" />
      </header>

      <div className="flex flex-col gap-4 px-4">
        {error && <Alert color="failure">Couldn&rsquo;t load the directory: {error.message}.</Alert>}
        {!staff && !error && <div className="flex justify-center py-10"><Spinner size="lg" aria-label="Loading" /></div>}
        {staff && groups.length === 0 && <p className="px-1 text-sm text-gray-600 dark:text-gray-400">{query ? 'No one matches.' : 'The directory is empty.'}</p>}
        {groups.map(g => (
          <section key={g.label} className="flex flex-col gap-2" aria-label={g.label}>
            <h2 className="px-1 text-sm font-bold text-gray-600 dark:text-gray-400">{g.label}</h2>
            <Card className="overflow-hidden">
              {g.rows.map(s => (
                <div key={s.id} className="flex items-center gap-3 border-b border-gray-200 px-3 py-2.5 last:border-b-0 dark:border-gray-700">
                  <Initials name={s.name} className="h-10 w-10 text-sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-semibold">{s.name}</span>
                    {s.notes && <span className="truncate text-[13px] text-gray-600 dark:text-gray-400">{s.notes}</span>}
                    {[s.phone, s.phone2].filter(Boolean).map(p => (
                      <span key={p} className="font-mono text-[13px] text-gray-600 dark:text-gray-400">{p}</span>
                    ))}
                  </span>
                  {dial(s.phone) && (
                    <span className="flex shrink-0 gap-2">
                      <a href={`sms:${dial(s.phone)}`} aria-label={`Text ${s.name}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-200">
                        <MessageSquare className="h-5 w-5" aria-hidden="true" />
                      </a>
                      <a href={`tel:${dial(s.phone)}`} aria-label={`Call ${s.name}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-700 text-white dark:bg-primary-600">
                        <Phone className="h-5 w-5" aria-hidden="true" />
                      </a>
                    </span>
                  )}
                </div>
              ))}
            </Card>
          </section>
        ))}
      </div>
    </div>
  )
}
