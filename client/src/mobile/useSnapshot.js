import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

// Server events that change something the phone shows. Any of them reloads
// the snapshot (debounced), which is small enough to simply fetch again.
const RELOAD_ON = new Set([
  'data_saved', 'patched', 'passes_updated', 'settings_updated', 'round_updated',
])

// The mobile app's data (GET /api/m/snapshot), kept current by the WebSocket
// and refreshed whenever the phone wakes or comes back online.
export function useSnapshot({ onMessage } = {}) {
  const [snap, setSnap] = useState(null)
  const [error, setError] = useState(null)
  const [live, setLive] = useState(false)
  const timer = useRef(null)
  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])

  const reload = useCallback(async () => {
    try {
      const s = await api('GET', '/api/m/snapshot')
      setSnap(s)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [])

  const reloadSoon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(reload, 250)
  }, [reload])

  // First load from a timer, so no state is set in the effect body itself.
  useEffect(() => {
    timer.current = setTimeout(reload, 0)
    return () => clearTimeout(timer.current)
  }, [reload])

  useEffect(() => {
    let ws
    let retry
    let closed = false
    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      try { ws = new WebSocket(`${proto}//${window.location.host}`) } catch { return }
      ws.onopen = () => { setLive(true); reloadSoon() }
      ws.onclose = () => {
        setLive(false)
        if (!closed) retry = setTimeout(connect, 4000)
      }
      ws.onmessage = (ev) => {
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        if (RELOAD_ON.has(msg.type)) reloadSoon()
        onMessageRef.current?.(msg)
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      try { ws?.close() } catch { /* already closed */ }
    }
  }, [reloadSoon])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', reload)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', reload)
    }
  }, [reload])

  // Optimistic change ahead of the server's echo; a reload replaces it.
  const patchSnap = useCallback((fn) => setSnap((s) => (s ? fn(s) : s)), [])

  return { snap, error, live, reload, patchSnap }
}

export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
