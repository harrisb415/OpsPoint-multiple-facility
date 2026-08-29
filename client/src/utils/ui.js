// Small presentational helpers shared across pages (not a component kit —
// the UI is built directly from flowbite-react components inline).

// Two-letter initials from a name, e.g. "Jane M. Doe" → "JD".
export const initials = (n) =>
  String(n || '')
    .replace(/[^A-Za-z. ]/g, '')
    .split(/[. ]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

// Deterministic avatar color from name (cycles through 6 palette entries).
// Matches the prototype's AVCYCLE pick() function exactly.
const _AV = [
  'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
  'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300',
  'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
]
export const avatarColor = (name) =>
  _AV[[...String(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % _AV.length]

// ── Card / panel header strip ─────────────────────────────────────────
// One treatment so every header reads the same. Before this, table heads
// and Admin sections carried a tint while ReportTab panels and the
// dashboard cards were plain white, which made the tint look accidental.
// Identical gradient stops everywhere — a gradient that varies by width
// reads as inconsistent, so these are fixed.
export const CARD_HEAD =
  'flex items-center justify-between gap-2 px-5 py-3.5 border-b ' +
  'bg-gradient-to-r from-primary-50 to-primary-100/60 border-primary-100 ' +
  'dark:from-gray-700/50 dark:to-gray-700/30 dark:border-gray-700'

export const CARD_HEAD_TITLE =
  'font-display text-[.95rem] font-semibold tracking-tight text-gray-900 dark:text-white'

// Same strip for cards that keep their own padding — bleeds to the card
// edges with negative margins instead of restructuring the card.
export const CARD_HEAD_INSET =
  CARD_HEAD + ' -mx-4 -mt-4 mb-4 sm:-mx-5 sm:-mt-5 sm:mb-5'
