'use strict';
/**
 * Starting a signed-in session. Shared by the password login and the mobile
 * app's PIN unlock, so the two set up exactly the same session.
 */
const service = require('./service');

// A new session id (no fixation), who is signed in, their permissions, and
// the forced-password-change flag; saved before resolving { mustChangePw }.
function establishSession(req, u) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(async (err) => {
      if (err) return reject(err);
      try {
        req.session.userId = u.id;
        req.session.username = u.username;
        req.session.displayName = u.display_name;
        req.session.role = u.role;
        req.session.permissions = await service.loginPermissions(u.id, u.role);
        if (u.must_change_pw) req.session.must_change_pw = true;
        req.session.save((e) => (e ? reject(e) : resolve({ mustChangePw: !!u.must_change_pw })));
      } catch (e) { reject(e); }
    });
  });
}

module.exports = { establishSession };
