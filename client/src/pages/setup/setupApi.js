// Helpers for the setup wizard (pages/Setup.jsx, ./SetupSteps.jsx).

// One call to the server: the parsed answer, or an Error with its message.
export async function api(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, {
    method, credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || `The server said no (${r.status}).`); e.status = r.status; throw e }
  return data
}

// "201-220", "A1-A12" or "Floor 2: 201-220": one room per number, keeping
// whatever letters come before the digits. Null when it isn't a range (or is
// over 500 rooms).
export function roomRange(text) {
  const m = /^(?:[^:]*:\s*)?([A-Za-z-]*)(\d+)\s*[-–]\s*\1?(\d+)$/.exec(String(text).trim())
  if (!m) return null
  const [, prefix, a, b] = m
  const from = parseInt(a, 10), to = parseInt(b, 10)
  if (to < from || to - from > 499) return null
  const width = a.length === b.length && a.startsWith('0') ? a.length : 0
  return Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(width, '0')}`)
}

// Pasted or uploaded CSV: "room,name" per line (a header line is fine; quoted
// cells may hold commas).
export function parseRoomsCsv(text) {
  const rows = []
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"'))
    const [room, name = ''] = cells
    if (/^room$/i.test(room)) continue
    if (room) rows.push({ room, name })
  }
  return rows
}
