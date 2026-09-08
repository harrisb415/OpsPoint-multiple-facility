'use strict';
/**
 * Make an Express 4 app safe for async route handlers.
 *
 * Express 4 predates async functions. It calls a handler and ignores the return
 * value, so a handler that returns a rejected promise never reaches the error
 * middleware: the request simply hangs until the client times out, and the
 * process logs an unhandled rejection. A *synchronous* throw is caught and
 * turned into a 500 — so converting handlers to async silently downgrades error
 * behaviour from "500" to "hang".
 *
 * That matters here because the Postgres port made every database call async,
 * and roughly 80 of the ~190 handlers have no try/catch of their own; they
 * relied on Express catching a synchronous throw.
 *
 * Rather than wrap 190 call sites, patch the registration methods once: any
 * handler that returns a thenable gets `.catch(next)` attached, which routes the
 * failure into normal Express error handling exactly as a sync throw used to.
 * Handlers that return undefined (the overwhelming majority, including every
 * synchronous one) are passed through untouched.
 *
 * Express 5 does this natively; when OP-14 lands this module can be deleted.
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'use'];

function wrap(fn) {
  // Only wrap request handlers. Anything that isn't a function (a path string,
  // a router, an options object) is returned as-is.
  if (typeof fn !== 'function') return fn;

  // Error-handling middleware is identified by arity 4. Its signature must be
  // preserved or Express stops recognising it as an error handler.
  if (fn.length === 4) {
    const wrapped = function (err, req, res, next) {
      let out;
      try { out = fn.call(this, err, req, res, next); } catch (e) { return next(e); }
      if (out && typeof out.then === 'function') out.then(undefined, next);
      return out;
    };
    Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true });
    return wrapped;
  }

  const wrapped = function (req, res, next) {
    let out;
    try { out = fn.call(this, req, res, next); } catch (e) { return next(e); }
    if (out && typeof out.then === 'function') out.then(undefined, next);
    return out;
  };
  // Some middleware is looked up by name, and arity is load-bearing in Express
  // (3 vs 4 selects normal vs error handling), so both are preserved above.
  Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true });
  return wrapped;
}

/**
 * Patch an Express app (or Router) in place. Call once, immediately after
 * creating it and before registering any routes.
 */
function patchApp(app) {
  if (app.__asyncRoutesPatched) return app;
  for (const m of METHODS) {
    const orig = app[m];
    if (typeof orig !== 'function') continue;
    app[m] = function (...args) {
      return orig.apply(this, args.map(wrap));
    };
  }
  Object.defineProperty(app, '__asyncRoutesPatched', { value: true, enumerable: false });
  return app;
}

module.exports = { patchApp, wrap };
