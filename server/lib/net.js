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

module.exports = { getLocalIP };
