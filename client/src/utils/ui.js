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
