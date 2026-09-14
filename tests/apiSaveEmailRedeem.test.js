import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/save/email/redeem.js';

function fakeKvNamespace(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

function fakeRequest(body, ip = '1.2.3.4') {
  return {
    headers: { get: (name) => (name === 'CF-Connecting-IP' ? ip : null) },
    text: async () => JSON.stringify(body),
  };
}

test('redeem returns the stored data and deletes the key (one-shot)', async () => {
  const kv = fakeKvNamespace({ 'emailcode:abcd2345': JSON.stringify({ data: { level: 3 }, savedAt: 'x' }) });
  const env = { SAVES: kv };
  const response = await onRequestPost({ request: fakeRequest({ code: 'abcd2345' }), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, { level: 3 });
  assert.equal(kv.store.has('emailcode:abcd2345'), false);
});

test('a second redemption of the same code 404s', async () => {
  const kv = fakeKvNamespace({ 'emailcode:abcd2345': JSON.stringify({ data: { level: 3 }, savedAt: 'x' }) });
  const env = { SAVES: kv };
  await onRequestPost({ request: fakeRequest({ code: 'abcd2345' }), env });
  const response = await onRequestPost({ request: fakeRequest({ code: 'abcd2345' }), env });
  assert.equal(response.status, 404);
});

test('redeem rejects a malformed code', async () => {
  const env = { SAVES: fakeKvNamespace() };
  const response = await onRequestPost({ request: fakeRequest({ code: 'nope' }), env });
  assert.equal(response.status, 400);
});

test('redeem rate-limits per IP, isolated from send/push', async () => {
  const kv = fakeKvNamespace({ 'emailcode:abcd2345': JSON.stringify({ data: {}, savedAt: 'x' }) });
  const env = { SAVES: kv };
  for (let i = 0; i < 5; i++) {
    // Re-seed each iteration so a real 404 from the one-shot delete
    // doesn't get confused with the 429 this test is checking for.
    kv.store.set('emailcode:abcd2345', JSON.stringify({ data: {}, savedAt: 'x' }));
    const response = await onRequestPost({ request: fakeRequest({ code: 'abcd2345' }), env });
    assert.equal(response.status, 200);
  }
  kv.store.set('emailcode:abcd2345', JSON.stringify({ data: {}, savedAt: 'x' }));
  const response = await onRequestPost({ request: fakeRequest({ code: 'abcd2345' }), env });
  assert.equal(response.status, 429);
});
