import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/save/email/send.js';
import { EMAIL_CODE_LENGTH } from '../functions/_shared/emailCode.js';

function fakeKvNamespace() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value, opts) { store.set(key, value); store.set(`${key}:ttl`, opts?.expirationTtl); },
  };
}

function fakeEnv(overrides = {}) {
  return {
    SAVES: fakeKvNamespace(),
    RESEND_API_KEY: 'test-resend-key',
    EMAIL_RATE_LIMIT_SECRET: 'test-secret',
    ...overrides,
  };
}

function fakeRequest(body, ip = '1.2.3.4') {
  return {
    headers: { get: (name) => (name === 'CF-Connecting-IP' ? ip : null) },
    text: async () => JSON.stringify(body),
  };
}

test('valid send generates a code, stores it with a 24h TTL, emails it, and returns it', async () => {
  const env = fakeEnv();
  const sentEmails = [];
  env.__sendCodeEmailImpl = async (email, code) => { sentEmails.push({ email, code }); return true; };
  const request = fakeRequest({ email: 'person@example.com', data: { characterId: 'char-1', player: {} } });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.code.length, EMAIL_CODE_LENGTH);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].email, 'person@example.com');
  assert.equal(sentEmails[0].code, body.code);
  const stored = JSON.parse(env.SAVES.store.get(`emailcode:${body.code}`));
  assert.deepEqual(stored.data, { characterId: 'char-1', player: {} });
  assert.equal(env.SAVES.store.get(`emailcode:${body.code}:ttl`), 86400);
});

test('rejects an invalid email shape without ever calling the send implementation', async () => {
  const env = fakeEnv();
  let called = false;
  env.__sendCodeEmailImpl = async () => { called = true; return true; };
  const request = fakeRequest({ email: 'a@example.com,b@example.com', data: { characterId: 'char-1' } });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test('rejects a missing/non-object data field', async () => {
  const env = fakeEnv();
  const request = fakeRequest({ email: 'person@example.com', data: null });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 400);
});

test('rejects oversized bodies', async () => {
  const env = fakeEnv();
  const request = fakeRequest({ email: 'person@example.com', data: { blob: 'x'.repeat(300_000) } });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 413);
});

test('per-IP rate limit blocks after the send-specific max', async () => {
  const env = fakeEnv();
  env.__sendCodeEmailImpl = async () => true;
  for (let i = 0; i < 3; i++) {
    const request = fakeRequest({ email: 'person@example.com', data: { characterId: `char-${i}` } });
    const response = await onRequestPost({ request, env });
    assert.equal(response.status, 200);
  }
  const request = fakeRequest({ email: 'person@example.com', data: { characterId: 'char-4' } });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 429);
});

test('per-recipient rate limit blocks the same email even from different IPs', async () => {
  const env = fakeEnv();
  env.__sendCodeEmailImpl = async () => true;
  for (let i = 0; i < 3; i++) {
    const request = fakeRequest({ email: 'person@example.com', data: { characterId: `char-${i}` } }, `1.1.1.${i}`);
    const response = await onRequestPost({ request, env });
    assert.equal(response.status, 200);
  }
  const request = fakeRequest({ email: 'person@example.com', data: { characterId: 'char-4' } }, '9.9.9.9');
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 429);
});
