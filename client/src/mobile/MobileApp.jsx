import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Button, Spinner } from 'flowbite-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { applyTheme, storeTheme } from '../utils/themes.js'
import { MobileCtx } from './context.js'
import { useSnapshot } from './useSnapshot.js'
import { uiFlags } from './model.js'
import { Toaster } from './ui.jsx'
import TabBar from './TabBar.jsx'
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

  const flags = useMemo(() => (snap ? uiFlags(snap) : null), [snap])
  const value = useMemo(() => ({
    snap, reload, patchSnap, live, session, toast, installPrompt, flags,
    clearInstallPrompt: () => setInstallPrompt(null),
    hasPerm: (p) => !!session?.permissions?.includes(p),
  }), [snap, reload, patchSnap, live, session, toast, installPrompt, flags])

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
