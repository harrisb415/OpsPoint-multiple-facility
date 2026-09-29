// Sends a delete or void with its reason; throws the server's message.
export async function sendWithReason(method, url, reason) {
  const r = await fetch(url, {
    method, credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'That didn’t go through.')
  return r.json().catch(() => ({}))
}
