// Push alerts on this phone: what the browser supports, and turning alerts on
// or off. The service worker (/m-sw.js, scope /m/) shows the alerts; the
// server keeps one subscription per phone (routes in server/modules/push).
import { api } from './api.js'

export function pushSupport() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  return {
    supported,
    ios,
    standalone,
    // iPhone only delivers web push to an app added to the Home Screen.
    needsInstall: ios && !standalone,
    permission: 'Notification' in window ? Notification.permission : 'default',
  }
}

function keyBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function sameKey(buffer, bytes) {
  if (!buffer) return false
  const a = new Uint8Array(buffer)
  return a.length === bytes.length && a.every((v, i) => v === bytes[i])
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration('/m/')) || null
}

export async function currentSubscription() {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

// Ask permission (must follow a tap), subscribe, and register with the server.
export async function enableAlerts(publicKey) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'alerts are blocked for OpsPoint in this browser’s settings'
      : 'alerts were not allowed')
  }
  const reg = await navigator.serviceWorker.ready
  const key = keyBytes(publicKey)
  let sub = await reg.pushManager.getSubscription()
  // A subscription made under an older server key can't be reused.
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => {})
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const r = await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() })
  return { endpoint: sub.endpoint, prefs: r.prefs || {} }
}

// Stop alerts on this phone: tell the server, then drop the browser's side.
export async function disableAlerts() {
  const sub = await currentSubscription()
  if (!sub) return
  await api('DELETE', '/api/push/subscribe', { endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}
