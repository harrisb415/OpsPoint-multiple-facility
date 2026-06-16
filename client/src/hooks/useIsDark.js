import { useState, useEffect } from 'react'

// Reactive read of the class-based dark mode (`.dark` on <html>, toggled by the
// AppShell theme switch). Components that render to canvas/JS — e.g. ApexCharts —
// can't use Tailwind `dark:` variants, so they read this to pick colors and
// re-render when the theme changes.
const isDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

export function useIsDark() {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDark()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}
