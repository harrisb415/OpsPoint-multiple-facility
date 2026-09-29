'use strict';
/**
 * Idempotency-Key: replay-safe writes for the mobile app's offline queue.
 *
 * A phone in a dead zone can't tell whether a request it sent arrived: the
 * write may have happened and only the answer been lost. The queue resends
 * with the same Idempotency-Key header, and a repeat gets the first answer
 * back instead of running the write again, so a shaky connection can't log a
 * round or an entry twice.
 *
 * Opt-in: a request without the header is untouched. Keys are per user (one
 * account can't read another's answers) and bound to the method and path they
 * were first used with. Answers are kept 48 hours, except 5xx and 429 — those
 * are worth retrying, so the key is released and the retry runs the write.
 *
 * Goes after requireAuth and the permission check, just before the handler,
 * and only on routes that answer with res.json.
 */
const c = require('../db/connection');

const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
const KEEP_MS = 48 * 3600000;
// A key still unanswered after this long belongs to a request that died
// (a restart mid-write); the next retry runs it again.
const ABANDONED_MS = 2 * 60000;
const PRUNE_EVERY_MS = 3600000;
let lastPrune = 0;

function prune(now) {
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  Promise.resolve(c.run('DELETE FROM idempotency_keys WHERE created_at < ?', [new Date(now - KEEP_MS).toISOString()]))
    .catch(e => console.error('[idempotency] prune:', e.message));
}

function idempotent(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (key === undefined) return next();
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Invalid Idempotency-Key' });
  const userId = req.session && req.session.userId;
  if (!userId) return next();
  claim(req, res, next, key, userId).catch(e => res.status(500).json({ error: e.message }));
}

async function claim(req, res, next, key, userId) {
  const route = `${req.method} ${req.originalUrl}`.slice(0, 300);
  const now = Date.now();
  prune(now);
  const ins = await c.run(
    `INSERT INTO idempotency_keys (user_id, key, route, status, body, created_at) VALUES (?,?,?,0,'',?)
     ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, key, route, new Date(now).toISOString()]);
  if (!ins.changes) {
    const row = await c.query1('SELECT route, status, body, created_at FROM idempotency_keys WHERE user_id=? AND key=?', [userId, key]);
    if (!row) return res.status(409).json({ error: 'That request is still being processed. Try again shortly.', in_progress: true });
    if (row.route !== route) return res.status(422).json({ error: 'This Idempotency-Key was already used for a different request.' });
    if (row.status) {
      res.set('Idempotent-Replayed', 'true');
      return res.status(row.status).type('application/json').send(row.body || '{}');
    }
    if (now - Date.parse(row.created_at) < ABANDONED_MS) {
      return res.status(409).json({ error: 'That request is still being processed. Try again shortly.', in_progress: true });
    }
    const took = await c.run('UPDATE idempotency_keys SET created_at=? WHERE user_id=? AND key=? AND status=0 AND created_at=?',
      [new Date(now).toISOString(), userId, key, row.created_at]);
    if (!took.changes) return res.status(409).json({ error: 'That request is still being processed. Try again shortly.', in_progress: true });
  }

  // Keep the answer before sending it: if the phone never hears it, the
  // retry must find it stored.
  const send = res.json.bind(res);
  let answered = false;
  res.json = (body) => {
    if (answered) return send(body);
    answered = true;
    const status = res.statusCode;
    const done = status < 500 && status !== 429
      ? c.run('UPDATE idempotency_keys SET status=?, body=? WHERE user_id=? AND key=?', [status, JSON.stringify(body === undefined ? null : body), userId, key])
      : c.run('DELETE FROM idempotency_keys WHERE user_id=? AND key=?', [userId, key]);
    Promise.resolve(done)
      .catch(e => console.error('[idempotency] store:', e.message))
      .then(() => send(body));
    return res;
  };
  next();
}

module.exports = { idempotent };
