import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { generateStructuredOutput } from '../services/structured-output.service.js';

let server: Server;
let url: string;
const originalFetch = globalThis.fetch;
const originalKey = env.ANTHROPIC_API_KEY;
const output = {
  summary: 'Move three boxes of screws.',
  language: 'en',
  itemCount: 1,
  isUrgent: true,
  tags: ['move', 'screws'],
  items: [{ name: 'boxes of screws', quantity: 3 }],
  location: { source: 'aisle A', destination: 'warehouse 5' },
  notes: null,
};

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}/api/v1/structured-output`;
});
beforeEach(() => {
  env.ANTHROPIC_API_KEY = 'test-claude-key';
});
afterEach(() => {
  env.ANTHROPIC_API_KEY = originalKey;
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function request(body: unknown) {
  return originalFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function providerResponse(value: unknown) {
  return Response.json({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: env.ANTHROPIC_MODEL,
    content: [{ type: 'text', text: JSON.stringify(value) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 50 },
  });
}

void test('real AI SDK and Anthropic adapter return schema-validated JSON', async (context) => {
  const provider = context.mock.method(
    globalThis,
    'fetch',
    (input: unknown, options?: RequestInit) => {
      assert.equal(String(input), 'https://api.anthropic.com/v1/messages');
      assert.equal(
        new Headers(options?.headers).get('x-api-key'),
        'test-claude-key',
      );
      assert.ok(typeof options?.body === 'string');
      assert.match(options.body, /Move three boxes/);
      assert.match(options.body, /json_schema/);
      return Promise.resolve(providerResponse(output));
    },
  );
  const response = await request({ text: '  Move three boxes  ' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { success: true, data: output });
  assert.equal(provider.mock.callCount(), 1);
});

void test('rejects invalid input before contacting Claude', async (context) => {
  const provider = context.mock.method(globalThis, 'fetch', () => {
    throw new Error('Must not call provider');
  });
  for (const body of [
    {},
    { text: '   ' },
    { text: 123 },
    { text: 'x'.repeat(8_001) },
  ]) {
    assert.equal((await request(body)).status, 400);
  }
  assert.equal(provider.mock.callCount(), 0);
});

void test('handles malformed JSON, oversized bodies, and unsupported content types', async () => {
  const malformed = await originalFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{oops',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await request({ text: 'x'.repeat(40_000) })).status, 413);
  assert.equal(
    (await originalFetch(url, { method: 'POST', body: 'hello' })).status,
    415,
  );
});

void test('reports a missing key without breaking other routes', async () => {
  env.ANTHROPIC_API_KEY = undefined;
  const response = await request({ text: 'Move boxes' });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /ANTHROPIC_API_KEY/);
});

void test('rejects model output with the wrong field types', async (context) => {
  context.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(providerResponse({ ...output, isUrgent: 'yes' })),
  );
  const response = await request({ text: 'Move boxes' });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /expected format/);
});

void test('provider failures do not leak credentials or upstream response bodies', async (context) => {
  context.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(
      Response.json(
        {
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'private upstream details test-claude-key',
          },
        },
        { status: 401 },
      ),
    ),
  );
  const response = await request({ text: 'Move boxes' });
  assert.equal(response.status, 502);
  assert.doesNotMatch(
    await response.text(),
    /private upstream details|test-claude-key/,
  );
});

void test('cancellation aborts generation', async () => {
  await assert.rejects(
    generateStructuredOutput('Move boxes', AbortSignal.abort()),
    /timed out or was cancelled/,
  );
});
