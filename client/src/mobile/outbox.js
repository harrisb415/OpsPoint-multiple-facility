// Writes that wait for signal. Walking a round, a phone loses Wi-Fi in
// stairwells and basements; a round mark, a finished round, a "found" or a
// log entry made then is kept here and sent, in order, when the connection is
// back. Each carries an Idempotency-Key, so a resend after a lost answer
// can't write twice (server/middleware/idempotency.js), and the time it was
// made. The server has the last word: whatever it refuses lands in `failed`
// for staff to see, never silently dropped.
//
// Kept in localStorage per account, so it survives closing the app and waits
// through the idle sign-out (sent after the PIN or password). Signing out on
// purpose deletes it; More warns first.

import { fmtClock } from './schedule.js'

const SEND_TIMEOUT_MS = 10000
const RETRY_MS = [5000, 10000, 20000, 30000]
const SENT_KEEP_MS = 60000

const storeKey = (uid) => `opspoint-outbox-${uid}`

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 15) | 64
  b[8] = (b[8] & 63) | 128
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function load(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return { items: Array.isArray(v?.items) ? v.items : [], failed: Array.isArray(v?.failed) ? v.failed : [] }
  } catch {
    return { items: [], failed: [] }
  }
}

async function send(it) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(it.url, {
      method: it.method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': it.id },
      body: JSON.stringify(it.body),
      signal: ctl.signal,
    })
    return { status: res.status, data: await res.json().catch(() => ({})) }
  } catch {
    return { status: 0, data: {} }   // no answer: it may or may not have arrived
  } finally {
    clearTimeout(timer)
  }
}

// One queue per signed-in account. getState() is immutable, for
// useSyncExternalStore: { items, failed, sent, net } where net is
// 'ok' | 'offline' | 'retry' | 'signin' — how the last attempt went.
export function createOutbox(uid) {
  const key = storeKey(uid)
  let state = { ...load(key), sent: [], net: 'ok' }
  const listeners = new Set()
  const waiting = new Map()        // id -> resolve, for enqueue() callers still on screen
  let handlers = {}
  let running = false
  let started = false
  let failures = 0
  let timer = null
  let sentLater = 0     // sent or refused after the person moved on; told
  let failedLater = 0   // once the queue is empty

  function save() {
    try {
      if (state.items.length || state.failed.length) localStorage.setItem(key, JSON.stringify({ items: state.items, failed: state.failed }))
      else localStorage.removeItem(key)
    } catch { /* full or private mode: it still lives in memory */ }
  }
  function set(patch, persist = true) {
    const now = Date.now()
    state = { ...state, ...patch }
    if (state.sent.some((s) => now - s.sentAt > SENT_KEEP_MS)) state = { ...state, sent: state.sent.filter((s) => now - s.sentAt <= SENT_KEEP_MS) }
    if (persist) save()
    listeners.forEach((l) => l())
  }
  function settle(id, result) {
    const resolve = waiting.get(id)
    if (resolve) { waiting.delete(id); resolve(result) }
  }
  function settleWaiting(result) {
    for (const id of [...waiting.keys()]) settle(id, result)
  }
  function retryLater() {
    clearTimeout(timer)
    if (!started || !state.items.length || state.net === 'signin') return
    timer = setTimeout(flush, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)])
  }

  async function flush() {
    if (running || !started) return
    running = true
    clearTimeout(timer)
    let settled = 0
    try {
      while (state.items.length) {
        const it = state.items[0]
        if (navigator.onLine === false) {
          set({ net: 'offline' }, false)
          settleWaiting({ queued: true })
          break
        }
        const r = await send(it)
        if (!started) break
        if (r.status >= 200 && r.status < 300) {
          failures = 0
          if (!waiting.has(it.id)) sentLater++
          set({ items: state.items.filter((x) => x.id !== it.id), sent: [...state.sent, { ...it, sentAt: Date.now(), result: r.data }], net: 'ok' })
          settle(it.id, { sent: true, data: r.data })
          settled++
          continue
        }
        if (r.status === 401) {
          set({ net: 'signin' }, false)
          settleWaiting({ queued: true })
          break
        }
        if (r.status === 0 || r.status >= 500 || r.status === 429 || (r.status === 409 && r.data.in_progress)) {
          failures++
          const tries = (it.tries || 0) + 1
          set({ items: state.items.map((x) => (x.id === it.id ? { ...x, tries } : x)), net: r.status === 0 ? 'offline' : 'retry' })
          settleWaiting({ queued: true })
          break
        }
        // Refused. Whoever is still looking at the form hears it there;
        // anything sent later is kept to be seen.
        failures = 0
        settled++
        const error = r.data.error || `the server refused it (${r.status})`
        const rest = state.items.filter((x) => x.id !== it.id)
        if (waiting.has(it.id)) {
          set({ items: rest, net: 'ok' })
          settle(it.id, { failed: true, error })
        } else {
          failedLater++
          set({ items: rest, failed: [...state.failed, { ...it, error, failedAt: new Date().toISOString() }], net: 'ok' })
        }
      }
    } finally {
      running = false
      if (settled) handlers.onSettled?.()   // fetch the server's copy
      if (!state.items.length && (sentLater || failedLater)) {
        handlers.onLater?.({ sent: sentLater, failed: failedLater })
        sentLater = 0
        failedLater = 0
      }
      retryLater()
    }
  }

  function onOnline() { reachable() }
  function reachable() {
    failures = 0
    if (state.net === 'offline' || state.net === 'retry') set({ net: 'ok' }, false)
    flush()
  }
  function onVisible() { if (document.visibilityState === 'visible') flush() }
  function onStorage(e) {
    // Another tab of the app on this phone changed the queue.
    if (e.key === key) set({ ...load(key) }, false)
  }

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    getState() { return state },

    // Queue a write and try to send it. Resolves once it's settled for the
    // person waiting: { sent, data } | { queued } | { failed, error }.
    enqueue({ kind, method, url, body, meta = {} }) {
      const it = { id: uuid(), kind, method, url, body, meta, createdAt: new Date().toISOString(), tries: 0 }
      const done = new Promise((resolve) => waiting.set(it.id, resolve))
      set({ items: [...state.items, it] })
      flush()   // or, mid-flush, the loop reaches it
      return done
    },

    // A refused entry sent again, perhaps somewhere else (a log entry whose
    // shift closed goes to the shift now open).
    resend(id, change = {}) {
      const f = state.failed.find((x) => x.id === id)
      if (!f) return
      const it = { ...f, ...change, id: uuid(), tries: 0 }
      delete it.error
      delete it.failedAt
      set({ failed: state.failed.filter((x) => x.id !== id), items: [...state.items, it] })
      flush()
    },
    dismiss(id) { set({ failed: state.failed.filter((x) => x.id !== id) }) },
    clear() {
      settleWaiting({ failed: true, error: 'signed out' })
      sentLater = 0
      failedLater = 0
      set({ items: [], failed: [], sent: [] })
    },
    // Something else just reached the server (the live connection is back):
    // try now rather than waiting out the retry delay.
    reachable,

    start(h = {}) {
      handlers = h
      if (started) return
      started = true
      window.addEventListener('online', onOnline)
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('storage', onStorage)
      flush()
    },
    stop() {
      started = false
      clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('storage', onStorage)
      settleWaiting({ queued: true })
    },
  }
}

// ── What the screens show: the server's snapshot with the queue laid over ──
// Entries sent but not yet in the snapshot on screen stay too (sentAt after
// the snapshot was requested), so nothing blinks out between the answer and
// the next reload; the server's own copy is recognised by its id.

function hasLine(report, id) {
  return id != null && (report.log_entries || []).some((e) => e.id === id)
}

export function withPending(snap, box, me) {
  const loadedAt = snap.loaded_at || 0
  const queue = [...box.sent.filter((s) => s.sentAt >= loadedAt), ...box.items]
  if (!queue.length) return snap
  let { round, last_round: last, report } = snap
  const lines = []
  const names = new Map(snap.residents.map((c) => [c.id, c]))

  for (const it of queue) {
    const pending = !it.sentAt
    const at = it.body?.at || it.createdAt
    if (it.kind === 'mark' && round?.id === it.meta.roundId) {
      const others = round.marks.filter((m) => m.client_id !== it.meta.clientId)
      round = { ...round, marks: it.body.mark ? [...others, { client_id: it.meta.clientId, mark: it.body.mark, by: me, at, pending }] : others }
    } else if (it.kind === 'finish' && round?.id === it.meta.roundId) {
      last = { ...round, status: 'finished', finished_at: at, finished_by: me, missing: round.marks.filter((m) => m.mark === 'missing').length, pending }
      round = null
      if (pending || !(report && hasLine(report, it.result?.logEntry?.id))) {
        lines.push({ id: `q-${it.id}`, time: fmtAt(at), text: `Wellness check conducted by ${me}. ${it.meta.summary || ''}`.trim(), pending })
      }
    } else if (it.kind === 'found' && last?.id === it.meta.roundId) {
      last = { ...last, marks: last.marks.map((m) => (m.client_id === it.meta.clientId && !m.found_at ? { ...m, found_at: at, found_by: me } : m)) }
      if (pending || !(report && hasLine(report, it.result?.logEntry?.id))) {
        const c = names.get(it.meta.clientId)
        lines.push({ id: `q-${it.id}`, time: fmtAt(at), text: `${c ? `Rm. ${c.room} ${c.name}` : 'Resident'} located at ${fmtAt(at)}, reported by ${me}.`, pending })
      }
    } else if (it.kind === 'log' && report?.id === it.body.reportId && !hasLine(report, it.result?.log_entry_id)) {
      lines.push({ id: `q-${it.id}`, time: it.body.log_entry.time, text: it.body.log_entry.text, pending })
    }
  }
  if (lines.length && report) report = { ...report, log_entries: [...(report.log_entries || []), ...lines] }
  return { ...snap, round, last_round: last, report }
}

const fmtAt = (iso) => fmtClock(new Date(iso))

// A queued entry in words, for the list of ones the server refused.
export function describe(it, snap) {
  const c = it.meta?.clientId != null ? snap.residents.find((r) => r.id === it.meta.clientId) : null
  const who = c ? `Rm ${c.room} ${c.name}` : 'a resident'
  if (it.kind === 'mark') return it.body.mark === 'ok' ? `Round: ${who} seen` : it.body.mark === 'missing' ? `Round: ${who} not located` : `Round: ${who} cleared`
  if (it.kind === 'finish') return 'Finishing the wellness round'
  if (it.kind === 'found') return `${who} found`
  if (it.kind === 'log') return `Log ${it.body.log_entry.time}: ${it.body.log_entry.text}`
  return 'An entry'
}
