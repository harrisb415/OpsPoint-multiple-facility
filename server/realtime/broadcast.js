'use strict';
/**
 * Real-time fan-out. Today this is an in-process WebSocket broadcast.
 *
 * It is deliberately a thin module behind a stable API (setWss / broadcast) so
 * that for multi-instance cloud deploys the transport can be swapped for a
 * pub/sub backplane (e.g. Redis) WITHOUT touching the ~75 call sites that just
 * call broadcast({...}). That seam is the whole point of this file.
 */
const WebSocket = require('ws');

let _wss = null;

// Register the live WebSocket.Server instance created in server.js.
function setWss(wss) { _wss = wss; }

// Fan a JSON message out to every connected, open client.
function broadcast(msg) {
  if (!_wss) return;
  const s = JSON.stringify(msg);
  _wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(s); });
}

module.exports = { setWss, broadcast };
