'use strict';
/**
 * One HTTP call for the cloud storage backends: Node's own fetch, a timeout,
 * and the body as a Buffer. Never throws on an HTTP status — the backend
 * decides what a 404 or a 403 means — only when the service can't be reached.
 */
async function request(method, url, { headers = {}, body = null, timeoutMs = 20000 } = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  } catch (e) {
    const why = e && e.name === 'TimeoutError' ? `no answer in ${Math.round(timeoutMs / 1000)} seconds`
      : (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || 'network error';
    const err = new Error(`can't reach ${new URL(url).host}: ${why}`);
    err.code = 'UNREACHABLE';
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body: buf };
}

// A service's own words for a failed call: S3 and Azure answer in XML
// (<Code>, <Message>), Google in JSON ({ error: { message } }).
function serviceError(service, r) {
  const text = r.body.toString('utf8');
  let code = '', message = '';
  const c = /<Code>([^<]+)<\/Code>/.exec(text), m = /<Message>([^<]+)<\/Message>/.exec(text);
  if (c) code = c[1];
  if (m) message = m[1].split('\n')[0];
  if (!c) { try { const j = JSON.parse(text); message = (j.error && (j.error.message || j.error)) || ''; } catch (e) { /* not JSON */ } }
  const err = new Error(`${service} refused it (HTTP ${r.status}${code ? ` ${code}` : ''})${message ? `: ${String(message).trim()}` : ''}`);
  err.status = r.status;
  return err;
}

module.exports = { request, serviceError };
