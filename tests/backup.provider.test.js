// On Postgres OpsPoint makes no backups of its own. With OPSPOINT_BACKUPS=provider (the cloud
// templates) the platform's point-in-time restore has them, and the boot log says so instead of
// asking for pg_dump.
let mockBackups;   // "mock" prefix: jest.mock factories may read it
jest.mock('../server/db/connection', () => ({ isPg: true }));
jest.mock('../server/settings', () => ({ get: (name) => (name === 'OPSPOINT_BACKUPS' ? mockBackups : undefined) }));
const backup = require('../server/lib/backup');

function bootLog(value) {
  mockBackups = value;
  const lines = [];
  const log = jest.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
  const warn = jest.spyOn(console, 'warn').mockImplementation((...a) => lines.push(a.join(' ')));
  return backup.start({}).then(() => { log.mockRestore(); warn.mockRestore(); return lines.join('\n'); });
}

test('provider backups: the platform has them, nothing asks for pg_dump', async () => {
  const out = await bootLog('provider');
  expect(out).toMatch(/point-in-time restore \(OPSPOINT_BACKUPS=provider\)/);
  expect(out).not.toMatch(/pg_dump|NOT scheduled/);
});

test('recorded backups on Postgres: still says to schedule pg_dump', async () => {
  const out = await bootLog('recorded');
  expect(out).toMatch(/NOT scheduled[\s\S]*pg_dump/);
});
