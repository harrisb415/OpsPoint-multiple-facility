import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Button, Spinner } from 'flowbite-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { applyTheme, storeTheme } from '../utils/themes.js'
import { MobileCtx } from './context.js'
import { useSnapshot } from './useSnapshot.js'
import { uiFlags } from './model.js'
import { createOutbox, withPending } from './outbox.js'
import { Toaster } from './ui.jsx'
import TabBar from './TabBar.jsx'
import OutboxBar from './OutboxBar.jsx'
import Home from './Home.jsx'
import Residents from './Residents.jsx'
import Resident from './Resident.jsx'
import Rounds from './Rounds.jsx'
import Log from './Log.jsx'
import More from './More.jsx'
import Staff from './Staff.jsx'
import Announcements from './Announcements.jsx'

// The mobile app (/m). Separate from the desktop AppShell: its own data
// snapshot, its own layout, and dark mode taken from the phone rather than
// the desktop's toggle.
export default function MobileApp() {
  const { session, refreshSession } = useAuth()
  const [toastState, setToastState] = useState(null)
  const [installPrompt, setInstallPrompt] = useState(null)
  const toastTimer = useRef(null)

  useSystemDark()

  useEffect(() => {
    // Opening this app makes it the one a phone lands on (see App.jsx).
    try { localStorage.setItem('opspoint-mobile', 'new') } catch { /* private mode */ }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/m-sw.js', { scope: '/m/' }).catch(() => {})
    const onPrompt = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); clearTimeout(toastTimer.current) }
  }, [])

  const onMessage = useCallback((msg) => {
    if (msg.type === 'permissions_updated' && (!msg.userId || msg.userId === session?.id)) refreshSession()
  }, [session?.id, refreshSession])
  const { snap, error, live, reload, patchSnap } = useSnapshot({ onMessage })

  const theme = snap?.facility?.theme
  useEffect(() => { if (theme) storeTheme(applyTheme(theme)) }, [theme])

  const toast = useCallback((message, tone = 'ok') => {
    setToastState({ message, tone })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastState(null), tone === 'error' ? 6000 : 3000)
  }, [])

  // Writes made without signal wait in the outbox (outbox.js); the screens
  // see the snapshot with them laid over.
  const outbox = useMemo(() => createOutbox(session?.id || 0), [session?.id])
  const box = useSyncExternalStore(outbox.subscribe, outbox.getState)
  useEffect(() => {
    outbox.start({
      onSettled: reload,
      onLater: ({ sent, failed }) => {
        if (failed) toast(`${failed === 1 ? 'A saved entry' : `${failed} saved entries`} couldn’t be sent. See the bar at the bottom.`, 'error')
        else toast(`Back online: ${sent === 1 ? '1 saved entry' : `${sent} saved entries`} sent.`, 'ok')
      },
    })
    return () => outbox.stop()
  }, [outbox, toast, reload])
  useEffect(() => { if (live) outbox.reachable() }, [live, outbox])
  const offline = useOffline(live, box.net)
  const view = useMemo(() => (snap ? withPending(snap, box, session?.displayName || '') : null), [snap, box, session?.displayName])

  const flags = useMemo(() => (snap ? uiFlags(snap) : null), [snap])
  const value = useMemo(() => ({
    snap: view, reload, patchSnap, live, session, toast, installPrompt, flags, outbox, box, offline,
    clearInstallPrompt: () => setInstallPrompt(null),
    hasPerm: (p) => !!session?.permissions?.includes(p),
  }), [view, reload, patchSnap, live, session, toast, installPrompt, flags, outbox, box, offline])

  return (
    <div className="flex h-dvh flex-col bg-gray-100 font-sans text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      {snap ? (
        <MobileCtx.Provider value={value}>
          {/* [&>*]:min-w-0 — a screen may not grow wider than the phone because
              of a row that scrolls sideways (flex items default to min-content). */}
          <main className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain [&>*]:min-w-0">
            <Routes>
              <Route index element={<Home />} />
              <Route path="residents" element={<Residents />} />
              <Route path="residents/:id" element={<Resident />} />
              {flags.roundsOn && <Route path="rounds" element={<Rounds />} />}
              <Route path="log" element={<Log />} />
              <Route path="more" element={<More />} />
              <Route path="staff" element={<Staff />} />
              <Route path="announcements" element={<Announcements />} />
              <Route path="*" element={<Navigate to="/m" replace />} />
            </Routes>
          </main>
          <OutboxBar />
          <TabBar roundsOn={flags.roundsOn} />
          <Toaster toast={toastState} />
        </MobileCtx.Provider>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          {error ? (
            <>
              <p className="text-base font-semibold">Couldn&rsquo;t load OpsPoint: {error.message}.</p>
              <Button onClick={reload}>Try again</Button>
            </>
          ) : (
            <Spinner size="xl" aria-label="Loading" />
          )}
        </div>
      )}
    </div>
  )
}

// No connection: the phone says so, the last send found no network, or the
// live connection has been down a while (a blip while the server restarts
// isn't worth a banner).
function useOffline(live, net) {
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const [liveDown, setLiveDown] = useState(false)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  useEffect(() => {
    if (live) return
    const t = setTimeout(() => setLiveDown(true), 8000)
    return () => { clearTimeout(t); setLiveDown(false) }
  }, [live])
  return !online || net === 'offline' || (!live && liveDown)
}

// Follow the phone's light/dark setting while this app is open, and match the
// browser chrome to the page. The desktop keeps its own toggle.
function useSystemDark() {
  useEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains('dark')
    const meta = document.querySelector('meta[name="theme-color"]')
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      root.classList.toggle('dark', mq.matches)
      if (meta) meta.setAttribute('content', mq.matches ? '#111827' : '#f3f4f6')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => { mq.removeEventListener('change', apply); root.classList.toggle('dark', hadDark) }
  }, [])
}
