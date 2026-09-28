// Every request the mobile app makes: cookies, JSON both ways, and an error
// whose message can be shown to staff as it is. A 401 means the session ended
// (the idle timeout), so go to the login page and come back here after.

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function api(method, url, body) {
  let res
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'no connection to the server')
  }
  if (res.status === 401) {
    window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search)
    throw new ApiError(401, 'signed out')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error || `server error ${res.status}`)
  return data
}
