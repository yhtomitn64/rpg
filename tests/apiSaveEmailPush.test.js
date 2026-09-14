import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/save/email/push.js';

function fakeKvNamespace(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value, opts) { store.set(key, value); store.set(`${key}:ttl`, opts?.expirationTtl); },
  };
}

function fakeEnv(kv) {
  return { SAVES: kv };
}

function fakeRequest(body, ip = '1.2.3.4') {
  return {
    headers: { get: (name) => (name === 'CF-Connecting-IP' ? ip : null) },
    text: async () => JSON.stringify(body),
  };
}

test('push overwrites the value and resets the TTL to 24h for an existing code', async () => {
  const kv = fakeKvNamespace({ 'emailcode:abcd2345': JSON.stringify({ data: { level: 1 }, savedAt: 'earlier' }) });
  const env = fakeEnv(kv);
  const request = fakeRequest({ code: 'abcd2345', data: { level: 2 } });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 200);
  const stored = JSON.parse(kv.store.get('emailcode:abcd2345'));
  assert.deepEqual(stored.data, { level: 2 });
  assert.equal(kv.store.get('emailcode:abcd2345:ttl'), 86400);
});

test('push to a code that does not exist returns 404', async () => {
  const env = fakeEnv(fakeKvNamespace());
  const request = fakeRequest({ code: 'abcd2345', data: { level: 2 } });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 404);
});

test('push rejects a malformed code without touching KV', async () => {
  const kv = fakeKvNamespace();
  const env = fakeEnv(kv);
  const request = fakeRequest({ code: 'not-a-valid-code!!', data: { level: 2 } });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 400);
  assert.equal(kv.store.size, 0);
});

test('push rate-limits per IP, isolated from send/redeem', async () => {
  const kv = fakeKvNamespace({ 'emailcode:abcd2345': JSON.stringify({ data: {}, savedAt: 'x' }) });
  const env = fakeEnv(kv);
  for (let i = 0; i < 10; i++) {
    const response = await onRequestPost({ request: fakeRequest({ code: 'abcd2345', data: {} }), env });
    assert.equal(response.status, 200);
  }
  const response = await onRequestPost({ request: fakeRequest({ code: 'abcd2345', data: {} }), env });
  assert.equal(response.status, 429);
});
