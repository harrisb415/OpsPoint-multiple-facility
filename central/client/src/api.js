// Thin fetch wrapper — same-origin cookies, JSON in/out. Mirrors the helper
// the old vanilla console used so the server contract is unchanged.
export async function api(path, opts = {}) {
  const body = opts.body
  const isJson = body != null && typeof body !== 'string'
  const r = await fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: isJson ? JSON.stringify(body) : body,
  })
  let json = null
  try { json = await r.json() } catch { /* empty / non-JSON body */ }
  return { ok: r.ok, status: r.status, body: json }
}

// Pull a human-readable error message out of an api() result.
export const errOf = (r, fallback = 'Something went wrong') =>
  (r.body && r.body.error) || fallback
