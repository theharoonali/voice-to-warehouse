import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { app } from '../app.js';
import { env } from '../config/env.js';

let server: Server;
let baseUrl: string;
const originalKey = env.ELEVENLABS_API_KEY;
const originalFetch = globalThis.fetch;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1/transcription/token`;
});
after(async () => {
  env.ELEVENLABS_API_KEY = originalKey;
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

void test('token endpoint protects credentials and handles provider failures', async (context) => {
  const request = () =>
    originalFetch(baseUrl, {
      method: 'POST',
      headers: { 'X-Transcription-Client': 'web' },
    });
  env.ELEVENLABS_API_KEY = undefined;
  const missing = await request();
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get('cache-control'), 'no-store');

  env.ELEVENLABS_API_KEY = 'test-server-only-key';
  const rejected = await originalFetch(baseUrl, { method: 'POST' });
  assert.equal(rejected.status, 403);

  context.mock.method(
    globalThis,
    'fetch',
    (_url: unknown, options: RequestInit) => {
      assert.deepEqual(options.headers, {
        'xi-api-key': 'test-server-only-key',
      });
      return Promise.resolve(
        Response.json({
          token: 'single-use-test-token',
          private: 'must not be forwarded',
        }),
      );
    },
  );
  const success = await request();
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { token: 'single-use-test-token' });

  context.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(
      Response.json({ detail: 'private provider error' }, { status: 401 }),
    ),
  );
  const failure = await request();
  assert.equal(failure.status, 502);
  assert.doesNotMatch(
    await failure.text(),
    /private provider error|test-server-only-key/,
  );

  context.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(Response.json({ token: '' })),
  );
  assert.equal((await request()).status, 502);
});
