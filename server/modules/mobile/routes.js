'use strict';
/**
 * Mobile app routes: its data snapshot, and the /m pages themselves.
 *
 * The pages get the install tags (manifest, home-screen icon, theme colour,
 * a viewport that reaches under the notch) that the desktop pages must not
 * have: on the desktop a manifest would offer to install an app that opens
 * the phone UI.
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const service = require('./service');

const MOBILE_HEAD = [
  '<link rel="manifest" href="/m.webmanifest">',
  '<meta name="theme-color" content="#4338ca">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="OpsPoint">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<link rel="apple-touch-icon" href="/static/icons/icon-192.png">',
].join('\n    ');

function mobileHtml() {
  const html = fs.readFileSync(path.join(config.REACT_DIST, 'index.html'), 'utf8');
  return html
    .replace(/<meta name="viewport"[^>]*>/i, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
    .replace('</head>', `    ${MOBILE_HEAD}\n  </head>`);
}

function register(app) {
  app.get('/api/m/snapshot', requireAuth, requirePermission('mobile.access'), async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await service.snapshot());
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Signed out, go to the login page and come back here afterwards. An
  // installed app launches straight into /m/, and without `next` the login
  // would land on the desktop's home page.
  function signedIn(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }

  app.get(['/m', '/m/*'], signedIn, requireAuth, requirePermission('mobile.access'), (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(mobileHtml());
  });
}

module.exports = { register, _mobileHtml: mobileHtml };
