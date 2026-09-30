// File storage (roadmap phase 3): one port, four backends. The local folder is
// tested for real; S3, Azure Blob and Cloud Storage against small fake servers
// in this process that check what each service would check (signatures,
// headers, tokens) — plus AWS's own published Signature V4 examples. The real
// services' emulators (MinIO, Azurite, fake-gcs-server) run the same adapters
// in tests/storage.emulators.test.js when they are available.
'use strict';
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { wrap, assertKey } = require('../server/storage');
const localStorage = require('../server/storage/local');
const s3Storage = require('../server/storage/s3');
const azureBlob = require('../server/storage/azureBlob');
const gcsStorage = require('../server/storage/gcs');
const settingsMod = require('../server/settings');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_storage_'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PNG = Buffer.from('89504E470D0A1A0A0000000D4948445200000001000000010806000000', 'hex');
const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');

// A throwaway HTTP server: handler(req, body, url) -> { status, headers, body }.
async function fakeServer(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const out = await handler(req, Buffer.concat(chunks), new URL(req.url, 'http://x'));
        res.writeHead(out.status, out.headers || {});
        res.end(out.body || '');
      } catch (e) { res.writeHead(500); res.end(String(e.stack || e)); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}

// The same checks for every backend: write, read back, list, overwrite, delete, probe.
async function exercise(store) {
  const st = wrap(store);
  await st.put('photos/client_7.jpg', PNG, { contentType: 'image/png' });
  expect(Buffer.compare(await st.get('photos/client_7.jpg'), PNG)).toBe(0);
  expect(await st.get('photos/missing.jpg')).toBeNull();
  await st.put('photos/ua_9_1.jpg', Buffer.from('second'), {});
  expect(await st.list('photos/')).toEqual(['photos/client_7.jpg', 'photos/ua_9_1.jpg']);
  await st.put('photos/client_7.jpg', Buffer.from('replaced'), {});
  expect((await st.get('photos/client_7.jpg')).toString()).toBe('replaced');
  await st.remove('photos/client_7.jpg');
  await st.remove('photos/client_7.jpg');                        // twice is fine
  expect(await st.get('photos/client_7.jpg')).toBeNull();
  expect(await st.probe()).toBeGreaterThanOrEqual(0);
  expect(await st.list('photos/')).toEqual(['photos/ua_9_1.jpg']);    // the probe cleaned up after itself
  expect(st.describe()).not.toMatch(/key|secret|password/i);
}

describe('keys', () => {
  test('only one folder word and one plain file name', () => {
    for (const ok of ['photos/client_12.jpg', 'photos/ua_4_1700000000000.jpg', 'photos/.probe-1-2.txt']) expect(() => assertKey(ok)).not.toThrow();
    for (const bad of ['photos/../secret.key', '../x', 'photos/..', 'photos/.', 'x', 'Photos/x', 'photos/a b', 'photos/a/b', '/photos/x', 'photos/x\\y']) {
      expect(() => assertKey(bad)).toThrow(/not a file name OpsPoint uses/);
    }
  });
});

describe('local folder', () => {
  test('does everything, and writes atomically (no temporary files left)', async () => {
    const dir = path.join(tmp, 'local');
    await exercise(localStorage({ dir }));
    expect(fs.readdirSync(path.join(dir, 'photos'))).toEqual(['ua_9_1.jpg']);
  });

  test('refuses a key that would leave the folder even if it slipped past the port', async () => {
    const st = localStorage({ dir: path.join(tmp, 'local2') });
    await expect(st.put('../outside.txt', Buffer.from('x'))).rejects.toThrow(/outside the storage folder/);
  });
});

describe('Amazon S3 (Signature V4)', () => {
  const creds = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
  const now = new Date(Date.UTC(2013, 4, 24));
  const empty = sha256hex('');
  const sig = (h) => h.authorization.split('Signature=')[1];

  // The worked examples in AWS's S3 documentation ("Signature Calculations for
  // the Authorization Header: Transferring Payload in a Single Chunk").
  test('reproduces AWS\'s published example signatures', () => {
    const { signV4 } = s3Storage;
    const host = 'examplebucket.s3.amazonaws.com';
    expect(sig(signV4({ method: 'GET', host, path: '/test.txt', headers: { range: 'bytes=0-9' }, payloadHash: empty, creds, region: 'us-east-1', now })))
      .toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(sig(signV4({ method: 'PUT', host, path: '/test%24file.text', headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      payloadHash: sha256hex('Welcome to Amazon S3.'), creds, region: 'us-east-1', now })))
      .toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
    expect(sig(signV4({ method: 'GET', host, path: '/', query: { lifecycle: '' }, payloadHash: empty, creds, region: 'us-east-1', now })))
      .toBe('fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
    expect(sig(signV4({ method: 'GET', host, path: '/', query: { 'max-keys': '2', prefix: 'J' }, payloadHash: empty, creds, region: 'us-east-1', now })))
      .toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });

  // A fake S3 (path-style, like MinIO) that re-signs every request with the
  // same credentials and refuses a mismatch; lists two keys per page.
  async function fakeS3({ expectToken = null } = {}) {
    const objects = new Map();
    const srv = await fakeServer((req, body, url) => {
      const auth = req.headers.authorization || '';
      const m = /Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})/.exec(auth);
      if (!m) return { status: 403, body: '<Error><Code>AccessDenied</Code><Message>no signature</Message></Error>' };
      if (req.headers['x-amz-content-sha256'] !== sha256hex(body)) return { status: 400, body: '<Error><Code>XAmzContentSHA256Mismatch</Code></Error>' };
      if (expectToken && req.headers['x-amz-security-token'] !== expectToken) return { status: 403, body: '<Error><Code>InvalidToken</Code></Error>' };
      const headers = {};
      for (const n of m[4].split(';')) if (n !== 'host' && n !== 'x-amz-date' && n !== 'x-amz-content-sha256' && n !== 'x-amz-security-token') headers[n] = req.headers[n];
      const query = Object.fromEntries(url.searchParams);
      const secret = expectToken ? 'temp-secret' : 'minio-secret';
      const again = s3Storage.signV4({ method: req.method, host: req.headers.host, path: url.pathname, query, headers,
        payloadHash: req.headers['x-amz-content-sha256'], creds: { accessKeyId: m[1], secretAccessKey: secret, sessionToken: req.headers['x-amz-security-token'] },
        region: m[3], now: new Date(req.headers['x-amz-date'].replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z')) });
      if (again.authorization !== auth) return { status: 403, body: '<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>' };
      const [, bucket, ...rest] = url.pathname.split('/');
      const key = rest.join('/');
      if (bucket !== 'opspoint-photos') return { status: 404, body: '<Error><Code>NoSuchBucket</Code></Error>' };
      if (req.method === 'PUT') { objects.set(key, body); return { status: 200 }; }
      if (req.method === 'DELETE') { objects.delete(key); return { status: 204 }; }
      if (req.method === 'GET' && key) return objects.has(key) ? { status: 200, body: objects.get(key) } : { status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' };
      const all = [...objects.keys()].filter((k) => k.startsWith(query.prefix || '')).sort();
      const start = query['continuation-token'] ? Number(query['continuation-token']) : 0;
      const page = all.slice(start, start + 2);
      const more = start + 2 < all.length;
      return { status: 200, body: `<ListBucketResult>${page.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ''}</ListBucketResult>` };
    });
    return { ...srv, objects };
  }

  test('works against an S3-compatible service with keys (path-style, paged listing)', async () => {
    const srv = await fakeS3();
    try {
      const store = s3Storage({ bucket: 'opspoint-photos', region: 'us-east-1', endpoint: srv.url, pathStyle: true, prefix: 'sunrise/',
        credentials: s3Storage.awsCredentials({ accessKeyId: 'minio', secretAccessKey: 'minio-secret' }) });
      await exercise(store);
      expect([...srv.objects.keys()]).toEqual(['sunrise/photos/ua_9_1.jpg']);   // the prefix is on the objects
      const wrong = s3Storage({ bucket: 'opspoint-photos', region: 'us-east-1', endpoint: srv.url, pathStyle: true,
        credentials: s3Storage.awsCredentials({ accessKeyId: 'minio', secretAccessKey: 'not-it' }) });
      await expect(wrap(wrong).put('photos/x.jpg', PNG)).rejects.toThrow(/^S3 refused it \(HTTP 403 SignatureDoesNotMatch\): The request signature we calculated does not match$/);
    } finally { await srv.close(); }
  });

  test('uses the ECS task role when there are no keys, with its session token', async () => {
    const srv = await fakeS3({ expectToken: 'session-token-1' });
    let asked = 0;
    const role = await fakeServer((req) => {
      asked++;
      if (req.headers.authorization !== 'ecs-auth') return { status: 401 };
      return { status: 200, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ AccessKeyId: 'ASIATEMP', SecretAccessKey: 'temp-secret', Token: 'session-token-1', Expiration: new Date(Date.now() + 3600e3).toISOString() }) };
    });
    try {
      const store = s3Storage({ bucket: 'opspoint-photos', region: 'us-west-2', endpoint: srv.url, pathStyle: true,
        credentials: s3Storage.awsCredentials({ env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: `${role.url}/creds`, AWS_CONTAINER_AUTHORIZATION_TOKEN: 'ecs-auth' } }) });
      await exercise(store);
      expect(asked).toBe(1);                                         // cached until it nears expiry
    } finally { await srv.close(); await role.close(); }
  });

  test('says where an object lives, in words', () => {
    const creds2 = s3Storage.awsCredentials({ accessKeyId: 'a', secretAccessKey: 'b' });
    expect(s3Storage({ bucket: 'photos-b', region: 'us-west-2', credentials: creds2 }).describe()).toBe('the S3 bucket photos-b in us-west-2');
  });
});

describe('Azure Blob Storage (Shared Key and managed identity)', () => {
  const KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

  // Shared Key as the Blob service documents it, written out plainly so the
  // test does not lean on the adapter's own code.
  function expectedAuth(req, url) {
    const h = req.headers;
    const len = h['content-length'] && h['content-length'] !== '0' ? h['content-length'] : '';
    const xms = Object.keys(h).filter((k) => k.startsWith('x-ms-')).sort().map((k) => `${k}:${h[k]}\n`).join('');
    let resource = `/devstoreaccount1${url.pathname}`;
    for (const k of [...url.searchParams.keys()].sort()) resource += `\n${k}:${url.searchParams.get(k)}`;
    const toSign = `${req.method}\n\n\n${len}\n\n${h['content-type'] || ''}\n\n\n\n\n\n\n${xms}${resource}`;
    return 'SharedKey devstoreaccount1:' + crypto.createHmac('sha256', Buffer.from(KEY, 'base64')).update(toSign, 'utf8').digest('base64');
  }

  async function fakeAzure({ bearer = null } = {}) {
    const blobs = new Map();
    const srv = await fakeServer((req, body, url) => {
      if (!req.headers['x-ms-version'] || !req.headers['x-ms-date']) return { status: 400 };
      if (bearer ? req.headers.authorization !== `Bearer ${bearer}` : req.headers.authorization !== expectedAuth(req, url)) {
        return { status: 403, body: '<Error><Code>AuthenticationFailed</Code><Message>Server failed to authenticate the request.</Message></Error>' };
      }
      const [, account, container, ...rest] = url.pathname.split('/');
      const name = decodeURIComponent(rest.join('/'));
      if (account !== 'devstoreaccount1' || container !== 'opspoint') return { status: 404, body: '<Error><Code>ContainerNotFound</Code></Error>' };
      if (req.method === 'PUT') {
        if (req.headers['x-ms-blob-type'] !== 'BlockBlob') return { status: 400 };
        blobs.set(name, body); return { status: 201 };
      }
      if (req.method === 'DELETE') return blobs.delete(name) ? { status: 202 } : { status: 404, body: '<Error><Code>BlobNotFound</Code></Error>' };
      if (req.method === 'GET' && name) return blobs.has(name) ? { status: 200, body: blobs.get(name) } : { status: 404, body: '<Error><Code>BlobNotFound</Code></Error>' };
      if (url.searchParams.get('comp') === 'list' && url.searchParams.get('restype') === 'container') {
        const p = url.searchParams.get('prefix') || '';
        return { status: 200, body: `<EnumerationResults><Blobs>${[...blobs.keys()].filter((k) => k.startsWith(p)).map((k) => `<Blob><Name>${k}</Name></Blob>`).join('')}</Blobs><NextMarker/></EnumerationResults>` };
      }
      return { status: 400 };
    });
    return { ...srv, blobs };
  }

  test('works with a connection string (Shared Key, the Azurite shape)', async () => {
    const srv = await fakeAzure();
    try {
      const store = azureBlob({ connectionString: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${KEY};BlobEndpoint=${srv.url}/devstoreaccount1;`, container: 'opspoint' });
      await exercise(store);
      const bad = azureBlob({ connectionString: `AccountName=devstoreaccount1;AccountKey=${Buffer.from('wrong').toString('base64')};BlobEndpoint=${srv.url}/devstoreaccount1`, container: 'opspoint' });
      await expect(wrap(bad).put('photos/x.jpg', PNG)).rejects.toThrow(/^Azure Blob Storage refused it \(HTTP 403 AuthenticationFailed\): Server failed to authenticate the request\.$/);
    } finally { await srv.close(); }
  });

  test('works with the app\'s managed identity (App Service / Container Apps)', async () => {
    const srv = await fakeAzure({ bearer: 'mi-token' });
    let asked = 0;
    const idp = await fakeServer((req, body, url) => {
      asked++;
      if (req.headers['x-identity-header'] !== 'id-secret' || url.searchParams.get('resource') !== 'https://storage.azure.com/') return { status: 400 };
      return { status: 200, body: JSON.stringify({ access_token: 'mi-token', expires_on: String(Math.floor(Date.now() / 1000) + 3600) }) };
    });
    try {
      const store = azureBlob({ account: 'devstoreaccount1', container: 'opspoint', endpoint: `${srv.url}/devstoreaccount1`,
        env: { IDENTITY_ENDPOINT: `${idp.url}/msi/token`, IDENTITY_HEADER: 'id-secret' } });
      await exercise(store);
      expect(asked).toBe(1);
    } finally { await srv.close(); await idp.close(); }
  });

  test('reads connection strings, including UseDevelopmentStorage', () => {
    expect(azureBlob.parseConnectionString('DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=a2V5;EndpointSuffix=core.windows.net'))
      .toEqual({ account: 'acme', key: 'a2V5', blobEndpoint: 'https://acme.blob.core.windows.net' });
    expect(azureBlob.parseConnectionString('UseDevelopmentStorage=true').blobEndpoint).toBe('http://127.0.0.1:10000/devstoreaccount1');
    expect(() => azureBlob.parseConnectionString('AccountName=acme')).toThrow(/AccountName and AccountKey/);
  });
});

describe('Google Cloud Storage (JSON API)', () => {
  async function fakeGcs({ token = null } = {}) {
    const objects = new Map();
    const srv = await fakeServer((req, body, url) => {
      if (token && req.headers.authorization !== `Bearer ${token}`) return { status: 401, body: JSON.stringify({ error: { message: 'Invalid Credentials' } }) };
      const up = /^\/upload\/storage\/v1\/b\/([^/]+)\/o$/.exec(url.pathname);
      if (up && req.method === 'POST' && url.searchParams.get('uploadType') === 'media') {
        objects.set(url.searchParams.get('name'), body);
        return { status: 200, body: JSON.stringify({ name: url.searchParams.get('name') }) };
      }
      const one = /^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
      if (one) {
        const name = decodeURIComponent(one[2]);
        if (req.method === 'GET') return objects.has(name) ? { status: 200, body: objects.get(name) } : { status: 404, body: JSON.stringify({ error: { message: 'No such object' } }) };
        if (req.method === 'DELETE') return objects.delete(name) ? { status: 204 } : { status: 404 };
      }
      if (/^\/storage\/v1\/b\/([^/]+)\/o$/.test(url.pathname)) {
        const p = url.searchParams.get('prefix') || '';
        return { status: 200, body: JSON.stringify({ items: [...objects.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }) };
      }
      return { status: 400 };
    });
    return { ...srv, objects };
  }

  test('works against an emulator (no token)', async () => {
    const srv = await fakeGcs();
    try { await exercise(gcsStorage({ bucket: 'opspoint', endpoint: srv.url })); }
    finally { await srv.close(); }
  });

  test('works with a service-account key: a signed JWT is exchanged for a token', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    let exchanged = 0;
    const tokenSrv = await fakeServer((req, body) => {
      const assertion = new URLSearchParams(body.toString()).get('assertion');
      const [h, c, s] = assertion.split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url'));
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      if (!ok || claims.iss !== 'opspoint@proj.iam.gserviceaccount.com' || !/devstorage\.read_write/.test(claims.scope)) return { status: 400 };
      exchanged++;
      return { status: 200, body: JSON.stringify({ access_token: 'sa-token', expires_in: 3600 }) };
    });
    const srv = await fakeGcs({ token: 'sa-token' });
    const keyFile = path.join(tmp, 'sa.json');
    fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'opspoint@proj.iam.gserviceaccount.com', token_uri: `${tokenSrv.url}/token`,
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
    try {
      await exercise(gcsStorage({ bucket: 'opspoint', endpoint: srv.url, keyFile }));
      expect(exchanged).toBe(1);
    } finally { await srv.close(); await tokenSrv.close(); }
  });
});

describe('photos through the port', () => {
  const photosMod = () => require('../server/storage/photos');
  const storageMod = require('../server/storage');
  afterEach(() => { storageMod.useStorage(null); photosMod()._clearCache(); });

  test('the image type comes from the bytes, not the name', () => {
    expect(photosMod().contentType(PNG, 'photos/ua_1_2.jpg')).toBe('image/png');
    expect(photosMod().contentType(Buffer.from('GIF89a......'), 'x')).toBe('image/gif');
    expect(photosMod().contentType(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]), 'x.png')).toBe('image/jpeg');
  });

  test('a cloud backend is read once, then from memory; a rewrite replaces what is remembered', async () => {
    const objects = new Map();
    let gets = 0;
    storageMod.useStorage(wrap({
      kind: 's3',
      put: async (k, b) => { objects.set(k, b); }, get: async (k) => { gets++; return objects.get(k) || null; },
      remove: async (k) => { objects.delete(k); }, list: async () => [...objects.keys()], describe: () => 'a fake bucket',
    }));
    const p = photosMod();
    const ref = await p.savePhoto('data:image/png;base64,' + PNG.toString('base64'), 'client_3.png');
    expect(ref).toBe('photos/client_3.png');
    p._clearCache();
    expect(await p.photoDataUri(ref)).toBe('data:image/png;base64,' + PNG.toString('base64'));
    await p.photoDataUri(ref);
    expect(gets).toBe(1);
    await p.savePhoto('data:image/png;base64,' + Buffer.from('new').toString('base64'), 'client_3.png');
    expect((await p.readPhoto(ref)).bytes.toString()).toBe('new');
    expect(gets).toBe(1);
    expect(await p.photoDataUris([ref, null, 'data:image/gif;base64,R0lG', 'photos/missing.jpg', '../etc/passwd']))
      .toEqual([expect.stringMatching(/^data:image\/jpeg;base64,/), null, 'data:image/gif;base64,R0lG', null, null]);
  });
});

describe('settings for storage', () => {
  const make = (env) => settingsMod.createSettings({ env, platform: 'linux', processZone: () => 'America/Chicago',
    readFile: () => { const e = new Error('none'); e.code = 'ENOENT'; throw e; } });
  const errors = (env) => make(env).check().filter((p) => p.level === 'error').map((p) => p.message);

  test('managed profiles default to their provider\'s storage and refuse the local disk', () => {
    expect(make({ OPSPOINT_PROFILE: 'azure' }).get('OPSPOINT_STORAGE')).toBe('azure-blob');
    expect(make({ OPSPOINT_PROFILE: 'aws' }).get('OPSPOINT_STORAGE')).toBe('s3');
    expect(make({ OPSPOINT_PROFILE: 'gcp' }).get('OPSPOINT_STORAGE')).toBe('gcs');
    expect(make({}).get('OPSPOINT_STORAGE')).toBe('local');
    expect(errors({ OPSPOINT_PROFILE: 'aws', OPSPOINT_STORAGE: 'local' })).toContain(
      "Profile aws can't use OPSPOINT_STORAGE=local, because the platform wipes its disk on every restart or redeploy, and the photos with it: set OPSPOINT_STORAGE=s3.");
  });

  test('each backend says what it is missing', () => {
    expect(errors({ OPSPOINT_STORAGE: 's3' })).toEqual(['OPSPOINT_STORAGE=s3 needs S3_BUCKET, the S3 bucket: set it in opspoint.config.json or the service environment.']);
    expect(errors({ OPSPOINT_STORAGE: 'gcs' })).toEqual(['OPSPOINT_STORAGE=gcs needs GCS_BUCKET, the Cloud Storage bucket: set it in opspoint.config.json or the service environment.']);
    expect(errors({ OPSPOINT_STORAGE: 'azure-blob' })[0]).toMatch(/^OPSPOINT_STORAGE=azure-blob needs AZURE_STORAGE_ACCOUNT \(reached with the app's managed identity\) or AZURE_STORAGE_CONNECTION_STRING/);
    expect(errors({ OPSPOINT_STORAGE: 'azure-blob', AZURE_STORAGE_CONNECTION_STRING: 'nonsense' })[0]).toMatch(/^AZURE_STORAGE_CONNECTION_STRING doesn't name an account/);
    expect(errors({ OPSPOINT_STORAGE: 's3', S3_BUCKET: 'b-1', AWS_ACCESS_KEY_ID: 'AKIA' })).toEqual([
      'AWS_ACCESS_KEY_ID is set without AWS_SECRET_ACCESS_KEY: set both, or neither to use the role the platform provides.']);
    expect(errors({ OPSPOINT_STORAGE: 's3', S3_BUCKET: 'Bad_Bucket' })[0]).toMatch(/^S3_BUCKET must be a bucket name/);
    expect(errors({ OPSPOINT_STORAGE: 's3', S3_BUCKET: 'b-1', S3_ENDPOINT: 'minio:9000' })[0]).toMatch(/^S3_ENDPOINT must be an address/);
    expect(make({ S3_ENDPOINT: 'http://127.0.0.1:9000/' }).get('S3_FORCE_PATH_STYLE')).toBe(true);
    expect(make({ AWS_REGION: 'eu-west-1' }).get('S3_REGION')).toBe('eu-west-1');
  });

  test('the local folder follows the database, as photos always did', () => {
    expect(make({ OPSPOINT_DB: path.join(tmp, 'x', 'o.db') }).get('OPSPOINT_STORAGE_DIR')).toBe(path.join(tmp, 'x'));
  });
});
