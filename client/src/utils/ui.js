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
  'flex flex-col gap-2 px-5 py-3.5 border-b sm:flex-row sm:items-center sm:justify-between ' +
  'bg-gradient-to-r from-primary-100 via-primary-50 to-accent-100 border-primary-200 ' +
  'dark:from-gray-700/50 dark:via-gray-700/40 dark:to-gray-700/30 dark:border-gray-700'

export const CARD_HEAD_TITLE =
  'font-display text-[.95rem] font-semibold tracking-tight text-gray-900 dark:text-white'

// Same strip for cards that keep their own padding — bleeds to the card
// edges with negative margins instead of restructuring the card.
export const CARD_HEAD_INSET =
  CARD_HEAD + ' -mx-4 -mt-4 mb-4 sm:-mx-5 sm:-mt-5 sm:mb-5'

// Variant for flowbite <Card>, whose theme uses p-6 rather than the p-4/p-5
// of the app's own card class — the bleed margins have to match the padding
// or the strip sits inset from the card edge.
export const CARD_HEAD_INSET_LG =
  CARD_HEAD + ' -mx-6 -mt-6 mb-2'

// Standalone section header — a heading that labels the block beneath it but
// is NOT inside a padded card, so it must not use the bleed margins. Rounds
// and borders itself so it reads as a band rather than a clipped strip.
export const CARD_HEAD_BAND =
  'flex flex-col gap-2 px-5 py-3.5 mb-3 rounded-xl border ' +
  'bg-gradient-to-r from-primary-100 via-primary-50 to-accent-100 border-primary-200 ' +
  'sm:flex-row sm:items-center sm:justify-between ' +
  'dark:from-gray-700/50 dark:via-gray-700/40 dark:to-gray-700/30 dark:border-gray-700'

// ── Navigation rail ───────────────────────────────────────────────────
// The app sidebar, the Admin rail and the Clinical rail were byte-identical
// strings in three files. Shared here so a theme change lands in one place —
// the gradient stops and the on-rail foregrounds are tokens now, not hex.
// Width is NOT included: the app sidebar is w-64, the other two are w-60.
// Dark mode must override all three gradient stops: `bg-gray-800` sets
// background-color, which does not cover a gradient's background-image —
// the Clinical rail was doing that and stayed purple in dark mode.
export const RAIL_SHELL =
  'bg-gradient-to-b from-rail-top via-rail-mid to-rail-bot ' +
  'border-r border-rail-top/60 ' +
  'dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 dark:border-gray-700'

// Active nav item — brand gradient, white text.
export const RAIL_ITEM_ON =
  'bg-gradient-to-r from-primary-500 to-accent-500 text-white shadow-lg ' +
  'shadow-primary-900/40 dark:from-primary-600 dark:to-accent-600'

// Inactive nav item, and its icon (dimmer than the label).
export const RAIL_ITEM_OFF =
  'text-rail-fg/80 hover:bg-white/10 hover:text-white ' +
  'dark:text-gray-300 dark:hover:bg-gray-700'
export const RAIL_ICON_OFF = 'text-rail-fg-dim/70 group-hover:text-white'

