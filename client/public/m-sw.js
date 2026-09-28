/* OpsPoint mobile service worker (scope /m/).
 *
 * Push alerts, and a plain "no connection" page when a page load fails.
 * It deliberately caches nothing: resident information never lands in a
 * phone's cache, where it would outlive signing out.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>OpsPoint</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;
font-family:system-ui,-apple-system,sans-serif;background:#f3f4f6;color:#111827;text-align:center}
@media (prefers-color-scheme:dark){body{background:#111827;color:#f3f4f6}}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 20px;line-height:1.5}
button{font:inherit;font-weight:600;padding:12px 22px;border-radius:12px;border:0;background:#4338ca;color:#fff}
</style></head><body><main><h1>No connection</h1>
<p>OpsPoint needs WiFi or data. Move somewhere with a signal, then try again.</p>
<button type="button" onclick="location.reload()">Try again</button></main></body></html>`;

// Page loads only; API calls and assets go straight to the network.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() =>
    new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

self.addEventListener('push', (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'OpsPoint', {
    body: data.body || '',
    tag: data.tag || 'opspoint',
    renotify: true,
    icon: '/static/icons/icon-192.png',
    badge: '/static/icons/icon-192.png',
    data: { url: data.url || '/m/' },
  }));
});

// Open the app at the alert's screen, reusing a window that is already open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/m/', self.location.origin);
  if (target.origin !== self.location.origin || !target.pathname.startsWith('/m')) target.pathname = '/m/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).pathname.startsWith('/m')) {
        await w.focus();
        if ('navigate' in w) { try { await w.navigate(target.href); } catch { /* keep the focused window */ } }
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
