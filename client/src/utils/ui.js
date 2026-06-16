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
