// The storage backends against the real services' emulators: MinIO (S3),
// Azurite (Azure Blob) and fake-gcs-server (Cloud Storage). Each part runs only
// when its emulator is named, so a plain `npm test` skips them:
//
//   OPSPOINT_TEST_S3_ENDPOINT=http://127.0.0.1:9000   (+ _S3_KEY, _S3_SECRET, _S3_BUCKET; default minioadmin/minioadmin/opspoint-test)
//   OPSPOINT_TEST_AZURITE=http://127.0.0.1:10000/devstoreaccount1   (container opspoint-test is created if missing)
//   OPSPOINT_TEST_GCS_ENDPOINT=http://127.0.0.1:4443   (bucket opspoint-test is created if missing)
//
// These go straight to each emulator; none of it touches a real cloud account.
'use strict';
const crypto = require('crypto');
const { wrap } = require('../server/storage');
const s3Storage = require('../server/storage/s3');
const azureBlob = require('../server/storage/azureBlob');
const gcsStorage = require('../server/storage/gcs');
const { request } = require('../server/storage/http');

const E = process.env;
const run = (on) => (on ? test : test.skip);

async function roundTrip(store) {
  const st = wrap(store);
  const key = `photos/emulator-${Date.now()}.jpg`;
  const bytes = crypto.randomBytes(2048);
  await st.put(key, bytes, { contentType: 'image/jpeg' });
  expect(Buffer.compare(await st.get(key), bytes)).toBe(0);
  expect(await st.list('photos/')).toContain(key);
  await st.remove(key);
  expect(await st.get(key)).toBeNull();
  expect(await st.probe()).toBeGreaterThanOrEqual(0);
}

run(E.OPSPOINT_TEST_S3_ENDPOINT)('MinIO: S3 with keys, path-style, a prefix', async () => {
  const bucket = E.OPSPOINT_TEST_S3_BUCKET || 'opspoint-test';
  const credentials = s3Storage.awsCredentials({ accessKeyId: E.OPSPOINT_TEST_S3_KEY || 'minioadmin', secretAccessKey: E.OPSPOINT_TEST_S3_SECRET || 'minioadmin' });
  // Create the bucket (PUT /bucket) through the same signer; 409 = it exists.
  const creds = await credentials();
  const url = new URL(E.OPSPOINT_TEST_S3_ENDPOINT);
  const headers = s3Storage.signV4({ method: 'PUT', host: url.host, path: `/${bucket}`, payloadHash: crypto.createHash('sha256').update('').digest('hex'), creds, region: 'us-east-1' });
  delete headers.host;
  const made = await request('PUT', `${E.OPSPOINT_TEST_S3_ENDPOINT}/${bucket}`, { headers });
  expect([200, 409]).toContain(made.status);
  await roundTrip(s3Storage({ bucket, region: 'us-east-1', endpoint: E.OPSPOINT_TEST_S3_ENDPOINT, pathStyle: true, prefix: 'sunrise/', credentials }));
});

run(E.OPSPOINT_TEST_AZURITE)('Azurite: Azure Blob with the development account (Shared Key)', async () => {
  const cs = `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=${E.OPSPOINT_TEST_AZURITE};`;
  const { sharedKey, parseConnectionString } = azureBlob;
  const c = parseConnectionString(cs);
  const path = `${new URL(c.blobEndpoint).pathname}/opspoint-test`;
  const headers = { 'x-ms-date': new Date().toUTCString(), 'x-ms-version': '2021-08-06' };
  headers.authorization = sharedKey({ account: c.account, key: c.key, method: 'PUT', path, query: { restype: 'container' }, headers });
  const made = await request('PUT', `${new URL(c.blobEndpoint).origin}${path}?restype=container`, { headers });
  expect([201, 409]).toContain(made.status);
  await roundTrip(azureBlob({ connectionString: cs, container: 'opspoint-test' }));
});

run(E.OPSPOINT_TEST_GCS_ENDPOINT)('fake-gcs-server: Cloud Storage JSON API', async () => {
  const made = await request('POST', `${E.OPSPOINT_TEST_GCS_ENDPOINT}/storage/v1/b?project=test`, {
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'opspoint-test' }) });
  expect([200, 409]).toContain(made.status);
  await roundTrip(gcsStorage({ bucket: 'opspoint-test', endpoint: E.OPSPOINT_TEST_GCS_ENDPOINT, prefix: 'sunrise/' }));
});
