'use strict';
/** Security response headers + CORS. Scoped for the local-network app. */
const { getLocalIP } = require('../lib/net');

function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self)');
  // CSP: scoped for local-network app (VULN-15). script-src has no unsafe-eval
  // (VULN-11) / unsafe-inline (VULN-8).
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self' ws: wss:; " +
    "worker-src blob:; " +
    "object-src 'none'; frame-src 'none';"
  );
  next();
}

// Only same-host origins (localhost variants + current LAN IP). Allowlist is
// built per-request so a DHCP IP change needs no restart. Port is the app's
// canonical 3000 (preserved from the original inline middleware).
function cors(req, res, next) {
  const origin = req.headers.origin;
  const localIP = getLocalIP();
  const allowed = new Set([
    'http://localhost:3000', 'https://localhost:3000',
    'http://127.0.0.1:3000', 'https://127.0.0.1:3000',
    'http://' + localIP + ':3000', 'https://' + localIP + ':3000',
  ]);
  if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
}

module.exports = { securityHeaders, cors };
