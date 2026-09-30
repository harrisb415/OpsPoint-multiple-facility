'use strict';
/**
 * A stand-in for Azure's managed identity endpoint and a Key Vault, in a
 * process of its own: settings.loadSecrets() blocks the test's process while
 * its child reads the vault, so the vault can't live in the test's process.
 *
 * Prints {"port": N} once listening, then serves until it is killed.
 *   FAKE_VAULT_SECRETS  JSON object: secret name -> value
 *   FAKE_VAULT_MODE     ok (default) | forbidden
 *   FAKE_VAULT_PORT     a fixed port (default: any free one)
 * It checks what Azure would: the identity header and resource, the bearer
 * token and the API version.
 */
const http = require('http');

const SECRETS = JSON.parse(process.env.FAKE_VAULT_SECRETS || '{}');
const MODE = process.env.FAKE_VAULT_MODE || 'ok';
const TOKEN = 'fake-vault-token';

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (u.pathname === '/identity') {
    if (req.headers['x-identity-header'] !== 'fake-header' || u.searchParams.get('resource') !== 'https://vault.azure.net') {
      return send(400, { error: 'bad identity request' });
    }
    return send(200, { access_token: TOKEN, expires_on: String(Math.floor(Date.now() / 1000) + 3600) });
  }
  const m = /^\/secrets\/([^/]+)$/.exec(u.pathname);
  if (!m) return send(404, { error: { code: 'NotFound', message: 'no such route' } });
  if (req.headers.authorization !== `Bearer ${TOKEN}` || u.searchParams.get('api-version') !== '7.4') {
    return send(401, { error: { code: 'Unauthorized', message: 'bad token or API version' } });
  }
  if (MODE === 'forbidden') {
    return send(403, { error: { code: 'Forbidden', message: "The user, group or application does not have secrets get permission on key vault 'fake'." } });
  }
  const name = decodeURIComponent(m[1]);
  if (!Object.prototype.hasOwnProperty.call(SECRETS, name)) {
    return send(404, { error: { code: 'SecretNotFound', message: `A secret with (name/id) ${name} was not found in this key vault.` } });
  }
  send(200, { value: SECRETS[name], id: `https://fake.vault.azure.net/secrets/${name}/0001`, attributes: { enabled: true } });
});
server.listen(Number(process.env.FAKE_VAULT_PORT || 0), '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: server.address().port }) + '\n'));
