import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, rateLimitedResponse } from '../functions/_shared/rateLimit.js';

function fakeKvNamespace() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
  };
}

function fakeRequest(ip = '1.2.3.4') {
  return { headers: { get: (name) => (name === 'CF-Connecting-IP' ? ip : null) } };
}

test('checkRateLimit allows requests under the default max, using the default key format', async () => {
  const env = { SAVES: fakeKvNamespace() };
  const request = fakeRequest('9.9.9.9');
  assert.equal(await checkRateLimit(env, request), true);
  assert.equal(env.SAVES.store.get('ratelimit:9.9.9.9'), '1');
});

test('checkRateLimit blocks once max is reached', async () => {
  const env = { SAVES: fakeKvNamespace() };
  const request = fakeRequest();
  for (let i = 0; i < 3; i++) assert.equal(await checkRateLimit(env, request, { max: 3 }), true);
  assert.equal(await checkRateLimit(env, request, { max: 3 }), false);
});

test('checkRateLimit with a custom keyPrefix uses an isolated counter', async () => {
  const env = { SAVES: fakeKvNamespace() };
  const request = fakeRequest('5.5.5.5');
  await checkRateLimit(env, request, { max: 1, keyPrefix: 'email-send-ip' });
  // A different keyPrefix for the same IP must not see the first counter.
  assert.equal(await checkRateLimit(env, request, { max: 1, keyPrefix: 'email-push-ip' }), true);
  assert.equal(env.SAVES.store.has('ratelimit:5.5.5.5'), false);
  assert.equal(env.SAVES.store.get('email-send-ip:5.5.5.5'), '1');
  assert.equal(env.SAVES.store.get('email-push-ip:5.5.5.5'), '1');
});

test('checkRateLimit with a custom identifier ignores the request IP entirely', async () => {
  const env = { SAVES: fakeKvNamespace() };
  const request = fakeRequest('1.1.1.1');
  await checkRateLimit(env, request, { max: 1, keyPrefix: 'email-send-recipient', identifier: 'abc123hash' });
  assert.equal(env.SAVES.store.get('email-send-recipient:abc123hash'), '1');
  assert.equal(env.SAVES.store.has('email-send-recipient:1.1.1.1'), false);
});

test('rateLimitedResponse returns a 429 JSON body', async () => {
  const response = rateLimitedResponse();
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error, 'too many requests, slow down');
});
