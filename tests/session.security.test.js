// Regression tests for the session-security fixes:
//   1. cookie.secure:'auto' + trust proxy  -> Secure flag set behind a
//      TLS-terminating reverse proxy (previously derived from whether THIS
//      process held a certificate, so the hosted deployment shipped the
//      session cookie without Secure).
//   2. trust proxy -> req.ip is the real client, so audit rows and the per-IP
//      rate limiters stop seeing every request as 127.0.0.1.
//   3. the SQLite session store survives a process restart.
'use strict';
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const TMP_DB = path.join(os.tmpdir(), `opspoint_sess_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const request = require('supertest');
const { app, db } = require('../server');
const { createSessionStore, expiryOf } = require('../server/lib/sessionStore');
const dbConn = require('../server/db/connection');

const PW = 'Passw0rd!';
const USER = 'sessuser';

beforeAll(() => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    [USER, USER, 'admin', hash, salt, JSON.stringify(['admin.system'])]
  );
});

const cookiesOf = (res) => [].concat(res.headers['set-cookie'] || []).join('; ');

describe('session cookie Secure flag', () => {
  test('is set when a reverse proxy reports an HTTPS client leg', async () => {
    const r = await request(app)
      .post('/api/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: USER, password: PW });
    expect(r.status).toBe(200);
    expect(cookiesOf(r)).toMatch(/Secure/);
  });

  test('is omitted on a genuinely plaintext connection (LAN install)', async () => {
    const r = await request(app).post('/api/login').send({ username: USER, password: PW });
    expect(r.status).toBe(200);
    const c = cookiesOf(r);
    expect(c).not.toMatch(/Secure/);
    expect(c).toMatch(/HttpOnly/);      // the other flags must not regress
    expect(c).toMatch(/SameSite=Lax/);
  });
});

describe('client IP attribution (45 CFR 164.312(b))', () => {
  test('audit rows record the forwarded client address, not the proxy', async () => {
    const CLIENT_IP = '203.0.113.9';
    await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', CLIENT_IP)
      .set('X-Forwarded-Proto', 'https')
      .send({ username: USER, password: PW });

    const row = db.query1(
      `SELECT ip FROM audit_log WHERE action='auth.login' ORDER BY id DESC LIMIT 1`, []
    );
    expect(row).toBeTruthy();
    expect(row.ip).toBe(CLIENT_IP);
    expect(row.ip).not.toBe('127.0.0.1');
  });
});

describe('SQLite session store', () => {
  const store = () => createSessionStore(dbConn, 60_000);
  const sess = (ms) => ({ cookie: { expires: new Date(Date.now() + ms).toISOString(), originalMaxAge: ms },
                          userId: 42, username: USER });

  test('round-trips a session', (done) => {
    const s = store();
    s.set('sid-a', sess(60_000), (e1) => {
      expect(e1).toBeFalsy();
      s.get('sid-a', (e2, got) => {
        expect(e2).toBeFalsy();
        expect(got.userId).toBe(42);
        done();
      });
    });
  });

  test('a session written before a restart is readable by a fresh store', (done) => {
    store().set('sid-restart', sess(60_000), () => {
      store().get('sid-restart', (e, got) => {   // new instance == new process
        expect(got && got.userId).toBe(42);
        done();
      });
    });
  });

  test('an expired session reads as absent and is reaped', (done) => {
    const s = store();
    s.set('sid-old', sess(-1000), () => {
      s.get('sid-old', (e, got) => {
        expect(got).toBeNull();
        expect(dbConn.query1('SELECT sid FROM sessions WHERE sid=?', ['sid-old'])).toBeNull();
        done();
      });
    });
  });

  test('destroy removes the row', (done) => {
    const s = store();
    s.set('sid-del', sess(60_000), () => s.destroy('sid-del', () => {
      expect(dbConn.query1('SELECT sid FROM sessions WHERE sid=?', ['sid-del'])).toBeNull();
      done();
    }));
  });

  test('prune clears only expired rows', (done) => {
    const s = store();
    s.set('sid-live', sess(60_000), () => s.set('sid-dead', sess(-5000), () => {
      s.prune();
      expect(dbConn.query1('SELECT sid FROM sessions WHERE sid=?', ['sid-dead'])).toBeNull();
      expect(dbConn.query1('SELECT sid FROM sessions WHERE sid=?', ['sid-live'])).toBeTruthy();
      done();
    }));
  });

  test('expiryOf falls back when the cookie carries no expiry', () => {
    const t = expiryOf({ cookie: {} }, 5000);
    expect(t).toBeGreaterThan(Date.now() + 4000);
  });
});
