// Settings (roadmap phase 1): one schema, six profiles, layered sources, and a
// startup check that stops on a missing or contradictory setting with one
// sentence. Everything here runs against injected environments and files —
// never this process's own environment, never a real settings file.
'use strict';
const fs = require('fs');
const path = require('path');

const settings = require('../server/settings');
const { createSettings, parseValue, SettingsError } = settings;
const { SETTINGS, PROFILES, PROFILE_NAMES, BY_NAME, INTERNAL_ENV } = require('../server/settings/schema');
const webpush = require('../server/lib/webpush');

const BASE = path.join(path.sep, 'srv', 'opspoint');
const noFile = () => { const e = new Error('no file'); e.code = 'ENOENT'; throw e; };

// A settings instance for a made-up machine: its environment, settings file,
// platform and clock zone are all given, nothing is read from this one.
function make({ env = {}, file, platform = 'linux', zone = 'America/Los_Angeles', app = 'facility', exists, mode } = {}) {
  return createSettings({
    app, env, base: BASE, platform,
    readFile: file === undefined ? noFile : () => (typeof file === 'string' ? file : JSON.stringify(file)),
    statFile: () => ({ mode: mode === undefined ? 0o100600 : mode }),
    exists: exists || (() => true),
    processZone: () => zone,
  });
}
const errors = (s) => s.check().filter((p) => p.level === 'error').map((p) => p.message);
const warnings = (s) => s.check().filter((p) => p.level === 'warning').map((p) => p.message);
const pair = () => webpush.generateKeys();

describe('the schema', () => {
  test('declares every setting once, with what the docs and checks need', () => {
    const names = SETTINGS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    const types = ['enum', 'int', 'bool', 'string', 'path', 'timezone', 'pgurl', 'trustProxy', 'host', 'size'];
    for (const s of SETTINGS) {
      expect(types).toContain(s.type);
      expect(['shared', 'facility', 'central', 'per-app']).toContain(s.scope);
      expect(s.group).toBeTruthy();
      expect(s.noun).toBeTruthy();
      expect(s.summary).toMatch(/\.$/);
      for (const p of s.requiredIn || []) expect(PROFILE_NAMES).toContain(p);
      if (s.requiredWhen) expect(BY_NAME[s.requiredWhen[0]]).toBeTruthy();
      if (s.pairWith) expect(BY_NAME[s.pairWith].pairWith).toBe(s.name);
      if (s.onlyIn) for (const v of s.onlyIn.values) expect(parseValue(s, v).error).toBeUndefined();
      if (typeof s.default === 'function') expect(s.defaultText).toBeTruthy();
    }
  });

  test('every built-in and profile default is itself a valid value', () => {
    for (const app of ['facility', 'central']) {
      for (const p of PROFILE_NAMES) {
        const s = make({ app, env: { OPSPOINT_PROFILE: p, TZ: 'America/Chicago' }, zone: 'America/Chicago' });
        for (const def of SETTINGS) expect(() => s.get(def.name)).not.toThrow();
      }
    }
    for (const p of PROFILE_NAMES) {
      for (const [k, v] of Object.entries(PROFILES[p].defaults)) expect(parseValue(BY_NAME[k], v).error).toBeUndefined();
    }
  });

  test('internal environment variables are not settings', () => {
    for (const k of INTERNAL_ENV) expect(BY_NAME[k]).toBeUndefined();
  });
});

describe('defaults keep every existing install as it was', () => {
  test('no settings on Windows: windows-local, SQLite, port 3000, a browser opened', () => {
    const s = make({ platform: 'win32' });
    expect(s.profile()).toMatchObject({ name: 'windows-local', inferred: true });
    expect(s.get('PORT')).toBe(3000);
    expect(s.get('OPSPOINT_DB_DRIVER')).toBe('sqlite');
    expect(s.get('OPSPOINT_TRUST_PROXY')).toBe('loopback');
    expect(s.get('OPSPOINT_BIND')).toBe('0.0.0.0');
    expect(s.get('OPSPOINT_UPDATES')).toBe('in-app');
    expect(s.get('OPSPOINT_OPEN_BROWSER')).toBe(true);
    expect(s.get('OPSPOINT_ENCRYPT')).toBe(true);
    expect(s.get('PGSSLMODE')).toBe('verify-full');
    expect(s.get('OPSPOINT_IDLE_MINS')).toBe(30);
    expect(s.get('OPSPOINT_JSON_LIMIT')).toBe('50mb');
    expect(s.get('VAPID_SUBJECT')).toBe('mailto:opspoint@localhost');
    expect(errors(s)).toEqual([]);
  });

  test('no settings on Linux: linux-local and no browser', () => {
    const s = make();
    expect(s.profile()).toMatchObject({ name: 'linux-local', inferred: true });
    expect(s.get('OPSPOINT_OPEN_BROWSER')).toBe(false);
    expect(errors(s)).toEqual([]);
  });

  test('paths follow the data folder the way server/config.js always did', () => {
    const s = make({ env: { OPSPOINT_DATA: '/var/lib/opspoint' } });
    expect(s.get('OPSPOINT_DATA')).toBe('/var/lib/opspoint');
    expect(s.get('OPSPOINT_DB')).toBe(path.join('/var/lib/opspoint', 'opspoint.db'));
    expect(s.get('OPSPOINT_SECRET_FILE')).toBe(path.join('/var/lib/opspoint', 'secret.key'));
    expect(make().get('OPSPOINT_DATA')).toBe(path.join(BASE, 'data'));
    expect(make({ app: 'central' }).get('CENTRAL_DATA')).toBe(path.join(BASE, 'central', 'data'));
  });

  test('HQ listens on 4000 unless told otherwise', () => {
    expect(make({ app: 'central' }).get('PORT')).toBe(4000);
    expect(make({ app: 'central', env: { PORT: '4100' } }).get('PORT')).toBe(4100);
  });

  test('an empty variable counts as unset, as `process.env.X || default` did', () => {
    const s = make({ env: { PORT: '', OPSPOINT_DATA: '', OPSPOINT_DB_DRIVER: '' } });
    expect(s.get('PORT')).toBe(3000);
    expect(s.get('OPSPOINT_DB_DRIVER')).toBe('sqlite');
  });

  test('the web-hestia shape (Postgres, loopback bind, TZ set) starts with one warning', () => {
    const env = {
      OPSPOINT_DB_DRIVER: 'pg', DATABASE_URL: 'postgresql://opspoint:pw@db-mnemosyne:5432/opspoint',
      CENTRAL_DATABASE_URL: 'postgresql://opspoint:pw@db-mnemosyne:5432/opscentral', PGSSLMODE: 'disable',
      TZ: 'America/Los_Angeles', OPSPOINT_BIND: '127.0.0.1', CENTRAL_BIND: '127.0.0.1', ...pairEnv(),
    };
    for (const app of ['facility', 'central']) {
      const s = make({ app, env });
      expect(errors(s)).toEqual([]);
      expect(warnings(s)).toEqual([expect.stringMatching(/^PGSSLMODE=disable sends database traffic unencrypted/)]);
    }
  });
});
function pairEnv() { const k = pair(); return { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey }; }

describe('layers: default, then profile, then the settings file, then the environment', () => {
  test('each later layer wins, and says where the value came from', () => {
    expect(make().source('OPSPOINT_TRUST_PROXY')).toBe('default');
    const aws = make({ env: { OPSPOINT_PROFILE: 'aws' } });
    expect(aws.get('OPSPOINT_TRUST_PROXY')).toBe(1);
    expect(aws.source('OPSPOINT_TRUST_PROXY')).toBe('profile aws');
    const file = make({ env: { OPSPOINT_PROFILE: 'aws' }, file: { OPSPOINT_TRUST_PROXY: 'uniquelocal' } });
    expect(file.get('OPSPOINT_TRUST_PROXY')).toBe('uniquelocal');
    expect(file.source('OPSPOINT_TRUST_PROXY')).toBe('opspoint.config.json');
    const env = make({ env: { OPSPOINT_PROFILE: 'aws', OPSPOINT_TRUST_PROXY: '10.0.0.0/8' }, file: { OPSPOINT_TRUST_PROXY: 'uniquelocal' } });
    expect(env.get('OPSPOINT_TRUST_PROXY')).toBe('10.0.0.0/8');
    expect(env.source('OPSPOINT_TRUST_PROXY')).toBe('environment');
  });

  test('the profile itself can come from the file', () => {
    const s = make({ file: { OPSPOINT_PROFILE: 'docker' } });
    expect(s.profile()).toMatchObject({ name: 'docker', source: 'opspoint.config.json' });
    expect(s.get('OPSPOINT_DB_DRIVER')).toBe('pg');
    expect(s.get('OPSPOINT_UPDATES')).toBe('platform');
  });

  test('file values may be JSON numbers and booleans', () => {
    const s = make({ file: { PORT: 3100, OPSPOINT_OPEN_BROWSER: true, OPSPOINT_ENCRYPT: false } });
    expect(s.get('PORT')).toBe(3100);
    expect(s.get('OPSPOINT_OPEN_BROWSER')).toBe(true);
    expect(s.get('OPSPOINT_ENCRYPT')).toBe(false);
  });

  test('the top level is the facility\'s; "central" holds HQ\'s own values', () => {
    const file = { PORT: 3100, TZ: 'America/Chicago', CENTRAL_BIND: '127.0.0.1', central: { PORT: 4100 } };
    const facility = make({ file, zone: 'America/Chicago' });
    const hq = make({ app: 'central', file, zone: 'America/Chicago' });
    expect(facility.get('PORT')).toBe(3100);
    expect(hq.get('PORT')).toBe(4100);
    expect(hq.get('TZ')).toBe('America/Chicago');            // shared settings reach HQ from the top level
    expect(hq.get('CENTRAL_BIND')).toBe('127.0.0.1');        // and so do HQ's own names
    expect(make({ app: 'central', file: { PORT: 3100 } }).get('PORT')).toBe(4000);   // not the facility's port
    expect(make({ app: 'central', file: { TZ: 'UTC', central: { TZ: 'America/Denver' } }, zone: 'America/Denver' }).get('TZ')).toBe('America/Denver');
  });

  test('OPSPOINT_CONFIG names the file, or "none" ignores it', () => {
    let asked = null;
    const s = createSettings({ env: { OPSPOINT_CONFIG: '/etc/opspoint/opspoint.config.json' }, base: BASE, platform: 'linux',
      readFile: (p) => { asked = p; return '{"PORT": 3200}'; }, statFile: () => ({ mode: 0o100600 }), processZone: () => 'America/Chicago' });
    expect(s.get('PORT')).toBe(3200);
    expect(asked).toBe(path.resolve('/etc/opspoint/opspoint.config.json'));
    const none = createSettings({ env: { OPSPOINT_CONFIG: 'none' }, base: BASE, readFile: () => { throw new Error('read'); } });
    expect(none.get('PORT')).toBe(3000);
    expect(none.describe().file).toEqual({ disabled: true });
  });
});

describe('values are parsed, never guessed', () => {
  test('a hop count is a number (Express would read "1" as the address 0.0.0.1)', () => {
    expect(make({ env: { OPSPOINT_TRUST_PROXY: '1' } }).get('OPSPOINT_TRUST_PROXY')).toBe(1);
    expect(make({ env: { OPSPOINT_TRUST_PROXY: 'false' } }).get('OPSPOINT_TRUST_PROXY')).toBe(false);
    expect(make({ env: { OPSPOINT_TRUST_PROXY: 'loopback, 10.0.0.0/8' } }).get('OPSPOINT_TRUST_PROXY')).toBe('loopback, 10.0.0.0/8');
  });

  test('a bad value throws instead of falling back to a default', () => {
    expect(() => make({ env: { OPSPOINT_DB_DRIVER: 'postgres' } }).get('OPSPOINT_DB_DRIVER')).toThrow(SettingsError);
    expect(() => make({ env: { PORT: '30x0' } }).get('PORT')).toThrow(/PORT must be a whole number from 1 to 65535 \(got '30x0'\)/);
    expect(make({ env: { OPSPOINT_DB_DRIVER: 'PG', DATABASE_URL: 'postgresql://u:p@h/d' } }).get('OPSPOINT_DB_DRIVER')).toBe('pg');
  });

  test('OPSPOINT_ENCRYPT takes 1 or 0 only: "false" used to mean encrypted', () => {
    expect(make({ env: { OPSPOINT_ENCRYPT: '0' } }).get('OPSPOINT_ENCRYPT')).toBe(false);
    expect(make({ env: { OPSPOINT_ENCRYPT: '1' } }).get('OPSPOINT_ENCRYPT')).toBe(true);
    expect(errors(make({ env: { OPSPOINT_ENCRYPT: 'false' } }))).toEqual(["OPSPOINT_ENCRYPT must be 1 or 0 (got 'false')."]);
  });

  test('trusting every hop is refused', () => {
    expect(errors(make({ env: { OPSPOINT_TRUST_PROXY: 'true' } }))[0]).toMatch(/^OPSPOINT_TRUST_PROXY can't be true/);
    expect(errors(make({ env: { OPSPOINT_TRUST_PROXY: 'my-proxy' } }))[0]).toMatch(/^OPSPOINT_TRUST_PROXY must be loopback/);
  });

  test('unknown values get a suggestion', () => {
    expect(errors(make({ env: { OPSPOINT_PROFILE: 'azur' } }))).toContain(
      "OPSPOINT_PROFILE must be windows-local, linux-local, azure, aws, gcp or docker (got 'azur'; did you mean azure?).");
    expect(errors(make({ env: { PGSSLMODE: 'prefer' } }))).toContain(
      "PGSSLMODE must be disable, require, verify-ca or verify-full (got 'prefer').");
  });

  test('a value in the settings file names the file', () => {
    expect(errors(make({ file: { PORT: 'ninety' } }))).toEqual(["PORT in opspoint.config.json must be a whole number from 1 to 65535 (got 'ninety')."]);
    expect(errors(make({ file: { PORT: [3000] } }))[0]).toMatch(/^PORT in opspoint.config.json must be a single value/);
  });
});

describe('each problem is one plain sentence', () => {
  test('a bare aws deployment is told exactly what it needs', () => {
    expect(errors(make({ env: { OPSPOINT_PROFILE: 'aws' }, zone: 'UTC' }))).toEqual([
      "OPSPOINT_DB_DRIVER=pg needs DATABASE_URL, the facility's Postgres connection string: set it in the ECS task definition.",
      'Profile aws needs SESSION_SECRET, the key that signs sign-in cookies (at least 32 random characters): set it in the ECS task definition.',
      'Profile aws needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, the push alert keys (make a pair with `node server/cli/opspoint.js keys`): set them in the ECS task definition, since keys made on the fly change at every restart and cut off every phone.',
      "Profile aws needs TZ, the facility's time zone (for example America/Chicago): set it in the ECS task definition.",
    ]);
  });

  test('a complete aws deployment starts', () => {
    const s = make({ zone: 'America/Chicago', env: {
      OPSPOINT_PROFILE: 'aws', TZ: 'America/Chicago', DATABASE_URL: 'postgresql://app:pw@db.cluster.rds.amazonaws.com:5432/opspoint',
      SESSION_SECRET: 'x'.repeat(64), ...pairEnv(),
    } });
    expect(errors(s)).toEqual([]);
    expect(warnings(s)).toEqual([expect.stringMatching(/^Photos are still saved in the data folder/)]);
  });

  test('every message is a single sentence ending in a full stop', () => {
    const messy = make({ zone: 'UTC', file: { PROT: 1, central: { CENTRL_DATA: 'x' } }, env: {
      OPSPOINT_PROFILE: 'gcp', OPSPOINT_DB_DRIVER: 'sqlite', OPSPOINT_BIND: '127.0.0.1', OPSPOINT_UPDATES: 'in-app',
      PGTZ: 'Europe/Paris', VAPID_PUBLIC_KEY: 'abc', OPSPOINT_DB_DRIVR: 'pg', PORT: 'x',
    } });
    const all = messy.check();
    expect(all.length).toBeGreaterThan(6);
    for (const p of all) {
      expect(p.message).not.toMatch(/\n/);
      expect(p.message).toMatch(/[.?)]$/);
    }
  });
});

describe('what a profile cannot use', () => {
  test('SQLite, the in-app updater and a loopback address on a managed platform', () => {
    const e = errors(make({ zone: 'America/Chicago', env: {
      OPSPOINT_PROFILE: 'azure', TZ: 'America/Chicago', OPSPOINT_DB_DRIVER: 'sqlite', OPSPOINT_UPDATES: 'in-app',
      OPSPOINT_BIND: '127.0.0.1', SESSION_SECRET: 'y'.repeat(40), ...pairEnv(),
    } }));
    expect(e).toEqual([
      "Profile azure can't use OPSPOINT_UPDATES=in-app, because the platform replaces the app's files on every deploy, so an update installed in place would be lost: set OPSPOINT_UPDATES=platform.",
      "Profile azure can't use OPSPOINT_DB_DRIVER=sqlite, because a SQLite file on the platform's disk would be lost on every restart or redeploy: set OPSPOINT_DB_DRIVER=pg.",
      "Profile azure must listen on every interface (OPSPOINT_BIND=0.0.0.0): on 127.0.0.1 the platform can't reach the app.",
    ]);
  });

  test('docker may keep SQLite on its volume, but not the in-app updater', () => {
    const e = errors(make({ zone: 'Europe/Berlin', env: { OPSPOINT_PROFILE: 'docker', TZ: 'Europe/Berlin', OPSPOINT_DB_DRIVER: 'sqlite', OPSPOINT_UPDATES: 'in-app' } }));
    expect(e).toEqual([expect.stringMatching(/^Profile docker can't use OPSPOINT_UPDATES=in-app/)]);
  });

  test('a managed platform never talks to Postgres unencrypted, except over a local socket', () => {
    const base = { OPSPOINT_PROFILE: 'gcp', TZ: 'America/New_York', SESSION_SECRET: 'z'.repeat(32), PGSSLMODE: 'disable', ...pairEnv() };
    expect(errors(make({ zone: 'America/New_York', env: { ...base, DATABASE_URL: 'postgresql://u:p@10.1.2.3:5432/opspoint' } }))).toEqual([
      'Profile gcp needs an encrypted database connection, because its Postgres is reached over the network: set PGSSLMODE=require or verify-full.',
    ]);
    expect(errors(make({ zone: 'America/New_York', env: { ...base, DATABASE_URL: 'postgresql://u:p@/opspoint?host=/cloudsql/proj:us-east1:db' } }))).toEqual([]);
  });

  test('on-premises, plaintext to another host is a warning, to this host nothing', () => {
    const env = { OPSPOINT_DB_DRIVER: 'pg', PGSSLMODE: 'disable', TZ: 'America/Chicago' };
    expect(warnings(make({ zone: 'America/Chicago', env: { ...env, DATABASE_URL: 'postgresql://u:p@db.lan/opspoint' } }))).toHaveLength(1);
    expect(warnings(make({ zone: 'America/Chicago', env: { ...env, DATABASE_URL: 'postgresql://u:p@localhost/opspoint' } }))).toEqual([]);
  });
});

describe('time zone', () => {
  test('an implicit UTC clock is refused; an explicit TZ=UTC is a choice', () => {
    expect(errors(make({ zone: 'Etc/UTC' }))).toEqual([
      "OpsPoint needs TZ, the facility's time zone (for example America/Chicago), because this machine's clock is on UTC and would file evening entries under the next day: set it in opspoint.config.json or the service environment.",
    ]);
    expect(errors(make({ zone: 'UTC', env: { TZ: 'UTC' } }))).toEqual([]);
    expect(errors(make({ zone: 'America/Chicago' }))).toEqual([]);       // the machine's own real zone is fine
  });

  test('a zone Node does not know (it would quietly run on UTC) is refused, with a suggestion', () => {
    expect(errors(make({ env: { TZ: 'America/LosAngeles' }, zone: 'Etc/Unknown' }))).toEqual([
      "TZ isn't a time zone OpsPoint knows (got 'America/LosAngeles'; did you mean America/Los_Angeles?).",
    ]);
  });

  test('the process clock must actually run in TZ', () => {
    expect(errors(make({ env: { TZ: 'America/Chicago' }, zone: 'America/Denver' }))).toEqual([
      'TZ is America/Chicago but this process\'s clock runs in America/Denver: start OpsPoint with TZ=America/Chicago in its environment.',
    ]);
    expect(errors(make({ env: { TZ: 'US/Central' }, zone: 'America/Chicago' }))).toEqual([]);   // an alias of the same zone
  });

  test('PGTZ must agree with TZ; abbreviations are warned about', () => {
    expect(errors(make({ env: { TZ: 'America/Chicago', PGTZ: 'UTC' }, zone: 'America/Chicago' }))[0]).toMatch(/^PGTZ \(UTC\) and TZ \(America\/Chicago\) disagree/);
    expect(errors(make({ env: { TZ: 'America/Chicago', PGTZ: 'US/Central' }, zone: 'America/Chicago' }))).toEqual([]);
    expect(warnings(make({ env: { TZ: 'EST' }, zone: 'America/Panama' }))[0]).toMatch(/^TZ=EST is an abbreviation/);
  });

  test('timeZone() says which zone the app runs in and why', () => {
    expect(make({ zone: 'America/Denver' }).timeZone()).toEqual({ name: 'America/Denver', source: 'this machine', explicit: false });
    expect(make({ env: { TZ: 'US/Pacific' }, zone: 'America/Los_Angeles' }).timeZone()).toEqual({ name: 'America/Los_Angeles', source: 'environment', explicit: true });
  });
});

describe('push keys', () => {
  test('one without the other is refused', () => {
    const k = pair();
    expect(errors(make({ env: { VAPID_PUBLIC_KEY: k.publicKey } }))).toEqual([
      'VAPID_PUBLIC_KEY is set without VAPID_PRIVATE_KEY: set both push alert keys, or neither to use the pair in the data folder.',
    ]);
  });

  test('two halves of different pairs are refused (loadKeys alone accepts them)', () => {
    const a = pair(), b = pair();
    expect(errors(make({ env: { VAPID_PUBLIC_KEY: a.publicKey, VAPID_PRIVATE_KEY: b.privateKey } }))).toEqual([
      'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not one key pair: make a new pair with `node server/cli/opspoint.js keys`.',
    ]);
    expect(errors(make({ env: { VAPID_PUBLIC_KEY: a.publicKey, VAPID_PRIVATE_KEY: a.privateKey } }))).toEqual([]);
  });
});

describe('Postgres', () => {
  test('driver pg needs a connection string; a bad one never echoes its password', () => {
    expect(errors(make({ env: { OPSPOINT_DB_DRIVER: 'pg' } }))).toEqual([
      "OPSPOINT_DB_DRIVER=pg needs DATABASE_URL, the facility's Postgres connection string: set it in opspoint.config.json or the service environment.",
    ]);
    const e = errors(make({ env: { OPSPOINT_DB_DRIVER: 'pg', DATABASE_URL: 'mysql://root:hunter2@db/x' } }));
    expect(e).toEqual(["DATABASE_URL isn't a Postgres connection string (postgresql://user:password@host:5432/database)."]);
    expect(e.join(' ')).not.toContain('hunter2');
  });

  test('PGSSLROOTCERT must exist', () => {
    const s = make({ exists: () => false, env: { OPSPOINT_DB_DRIVER: 'pg', DATABASE_URL: 'postgresql://u:p@db/x', PGSSLROOTCERT: '/etc/ssl/rds.pem' } });
    expect(errors(s)).toEqual(["PGSSLROOTCERT points at /etc/ssl/rds.pem, which doesn't exist."]);
  });

  test('HQ needs its own database, though its own schema of the same one will do', () => {
    const env = { OPSPOINT_DB_DRIVER: 'pg', DATABASE_URL: 'postgresql://u:p@db:5432/opspoint' };
    expect(errors(make({ app: 'central', env }))).toEqual([
      "OPSPOINT_DB_DRIVER=pg needs CENTRAL_DATABASE_URL, HQ's own Postgres connection string (not the facility's): set it in opspoint.config.json or the service environment.",
    ]);
    expect(errors(make({ app: 'central', env: { ...env, CENTRAL_DATABASE_URL: 'postgresql://other:pw@DB/opspoint' } }))[0])
      .toMatch(/^CENTRAL_DATABASE_URL points at the same database as DATABASE_URL/);
    expect(errors(make({ app: 'central', env: { ...env, CENTRAL_DATABASE_URL: 'postgresql://u:p@db:5432/opspoint?options=-c%20search_path%3Dcentral_test' } }))).toEqual([]);
  });

  test('a connection string left over after going back to SQLite is only a warning', () => {
    const s = make({ env: { DATABASE_URL: 'postgresql://u:p@db/x' } });
    expect(errors(s)).toEqual([]);
    expect(warnings(s)).toEqual(['DATABASE_URL is set but the database driver is sqlite, so it is ignored.']);
  });
});

describe('the settings file', () => {
  test('unknown keys stop startup, with a suggestion; comments and $schema are fine', () => {
    expect(errors(make({ file: { PROT: 3000, _comment: 'hi', $schema: './x.json', central: { CENTRL_DATA: 'x' } } }))).toEqual([
      "opspoint.config.json has a setting OpsPoint doesn't know: PROT (did you mean PORT?).",
      "opspoint.config.json has a setting OpsPoint doesn't know: central.CENTRL_DATA (did you mean CENTRAL_DATA?).",
    ]);
  });

  test('broken files say what is wrong', () => {
    expect(errors(make({ file: '{ "PORT": 3000, }' }))[0]).toMatch(/^opspoint.config.json isn't valid JSON/);
    expect(errors(make({ file: '[1,2]' }))).toEqual(['opspoint.config.json must hold one JSON object of settings, such as {"TZ": "America/Chicago"}.']);
    expect(errors(make({ file: { OPSPOINT_CONFIG: 'x' } }))).toEqual(['OPSPOINT_CONFIG can only be set in the environment, not in opspoint.config.json.']);
    const missing = createSettings({ env: { OPSPOINT_CONFIG: '/nope/settings.json' }, readFile: noFile, processZone: () => 'America/Chicago' });
    expect(missing.check().map((p) => p.message)).toEqual([`OPSPOINT_CONFIG points at ${path.resolve('/nope/settings.json')}, which doesn't exist.`]);
  });

  test('a byte-order mark is fine (Notepad writes one)', () => {
    expect(make({ file: '\uFEFF{"PORT": 3300}' }).get('PORT')).toBe(3300);
  });

  test('secrets in a file other accounts can read are warned about (not on Windows)', () => {
    const file = { SESSION_SECRET: 's'.repeat(40) };
    expect(warnings(make({ file, mode: 0o100644 }))).toEqual([`opspoint.config.json holds secrets and other accounts can read it: run chmod 600 ${path.join(BASE, 'opspoint.config.json')}.`]);
    expect(warnings(make({ file, mode: 0o100600 }))).toEqual([]);
    expect(warnings(make({ file, mode: 0o100644, platform: 'win32' }))).toEqual([]);
  });
});

describe('typos in the environment', () => {
  test('an OPSPOINT_ variable that is not a setting is warned about', () => {
    expect(warnings(make({ env: { OPSPOINT_DB_DRIVR: 'pg' } }))).toEqual([
      "OPSPOINT_DB_DRIVR isn't a setting OpsPoint knows, so it is ignored (did you mean OPSPOINT_DB_DRIVER?).",
    ]);
    const internal = Object.fromEntries(INTERNAL_ENV.map((k) => [k, '1']));
    expect(warnings(make({ env: internal }))).toEqual([]);
  });
});

describe('secrets stay secret', () => {
  test('describe() and the problems never contain a secret value', () => {
    const k = pair();
    const secretValues = ['p4ssw0rd-db', 'S'.repeat(12), k.privateKey, 'hq-first-pw'];
    const s = make({ app: 'facility', env: {
      OPSPOINT_DB_DRIVER: 'pg', DATABASE_URL: `postgresql://opspoint:${secretValues[0]}@db/opspoint`,
      SESSION_SECRET: secretValues[1], VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey,
      CENTRAL_ADMIN_PW: secretValues[3], TZ: 'America/Chicago',
    }, zone: 'America/Chicago' });
    const out = JSON.stringify(s.describe()) + JSON.stringify(make({ app: 'central', env: { CENTRAL_ADMIN_PW: secretValues[3] } }).describe());
    for (const v of secretValues) expect(out).not.toContain(v);
    expect(out).toContain('(set, hidden)');
    expect(s.check().map((p) => p.message)).toContain('SESSION_SECRET must be at least 32 characters.');
  });
});

describe('docs/SETTINGS.md', () => {
  test('matches the schema (regenerate: node server/cli/opspoint.js settings docs > docs/SETTINGS.md)', () => {
    const { renderDocs } = require('../server/settings/docs');
    const committed = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SETTINGS.md'), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(renderDocs());
  });
});

describe('the code reads settings through server/settings', () => {
  test('no app file reads a declared setting from process.env directly', () => {
    const root = path.join(__dirname, '..');
    const files = ['server.js', 'db.js', 'updater.js', 'central/server.js', 'central/db.js', 'central/updater.js'];
    (function walk(dir) {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (e.name.endsWith('.js') && !rel.startsWith(path.join('server', 'settings'))) files.push(rel);
      }
    })('server');
    const offenders = [];
    for (const f of files) {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      for (const m of text.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g)) {
        const name = m[1] || m[2];
        if (BY_NAME[name]) offenders.push(`${f}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
