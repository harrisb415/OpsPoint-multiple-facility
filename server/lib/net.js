'use strict';
/** Network helpers. Pure — no app state. */
const os = require('os');

// First non-internal IPv4 address (used for the LAN URL + CORS allowlist).
function getLocalIP() {
  try {
    for (const iface of Object.values(os.networkInterfaces()).flat())
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  } catch (e) {}
  return 'localhost';
}

// This machine's address on the facility network, for a link another device
// opens: a private address (10/8, 172.16/12, 192.168/16) first, and never a
// self-assigned 169.254 one, which no other device can reach.
function lanAddress(interfaces = os.networkInterfaces()) {
  const all = [];
  try { for (const i of Object.values(interfaces).flat()) if (i && i.family === 'IPv4' && !i.internal) all.push(i.address); } catch (e) { /* none */ }
  const usable = all.filter((a) => !/^169\.254\./.test(a));
  const lan = usable.find((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a));
  return lan || usable[0] || 'localhost';
}

/**
 * The origin to put in a link someone opens on another device (an invite, the
 * phone app's QR code): the address the request came in on, unless that is
 * this machine's loopback, which means nothing to a phone; then this
 * machine's LAN address on the same port.
 */
function reachableOrigin(req, interfaces) {
  const host = String(req.get('host') || '');
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!/^(localhost|127\.\d+\.\d+\.\d+|::1)$/i.test(name)) return `${req.protocol}://${host}`;
  const port = (/:(\d+)$/.exec(host) || [])[1];
  return `${req.protocol}://${lanAddress(interfaces)}${port ? `:${port}` : ''}`;
}

module.exports = { getLocalIP, lanAddress, reachableOrigin };
