import { useMemo } from 'react'
import { qrMatrix } from '../utils/qr.js'

// A QR code for a link, as an SVG: dark modules on white with the standard's
// four-module quiet zone, in any theme or dark mode (a scanner needs the
// contrast). `label` names it for screen readers.
export default function QrCode({ text, label, className = 'w-44 h-44' }) {
  const { size, path } = useMemo(() => {
    const { size, modules } = qrMatrix(text)
    let d = ''
    modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z` }))
    return { size: size + 8, path: d }
  }, [text])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label || 'QR code'} shapeRendering="crispEdges"
      className={`rounded-lg bg-white ring-1 ring-gray-200 dark:ring-gray-600 ${className}`}>
      <rect width={size} height={size} className="fill-white" />
      <path d={path} className="fill-black" />
    </svg>
  )
}
