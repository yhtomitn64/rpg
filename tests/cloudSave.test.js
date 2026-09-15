import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_CODE_LENGTH,
  generateSaveCode,
  isValidSaveCode,
  startCodeTransfer,
  loadByCode,
} from '../js/systems/cloudSave.js';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('generateSaveCode is 4 lowercase letters/digits', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateSaveCode();
    assert.equal(code.length, SAVE_CODE_LENGTH);
    assert.match(code, /^[a-z0-9]{4}$/);
  }
});

test('generateSaveCode is deterministic for a given random source', () => {
  let calls = 0;
  const fixedRandom = () => { calls++; return 0; };
  assert.equal(generateSaveCode(fixedRandom), 'aaaa');
  assert.equal(calls, 4);
});

test('isValidSaveCode accepts only 4 lowercase letters/digits', () => {
  assert.equal(isValidSaveCode('ab12'), true);
  assert.equal(isValidSaveCode('AB12'), false);
  assert.equal(isValidSaveCode('ab1'), false);
  assert.equal(isValidSaveCode('ab123'), false);
  assert.equal(isValidSaveCode('ab-1'), false);
  assert.equal(isValidSaveCode(null), false);
});

test('startCodeTransfer generates a fresh code, PUTs to it, and returns both', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(200, { ok: true, expiresInSeconds: 60 }));
  const { code, ok } = await startCodeTransfer({ hello: 'world' }, { fetchImpl });
  assert.equal(isValidSaveCode(code), true);
  assert.equal(ok, true);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, `/api/save/code/${code}`);
  assert.equal(fetchImpl.calls[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { data: { hello: 'world' } });
});

test('startCodeTransfer reports failure without throwing when the server rejects it', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(500, { error: 'boom' }));
  const { ok } = await startCodeTransfer({}, { fetchImpl });
  assert.equal(ok, false);
});

test('loadByCode returns the saved data on success', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(200, { data: { level: 5 }, savedAt: 'now' }));
  const data = await loadByCode('ab12', { fetchImpl });
  assert.deepEqual(data, { level: 5 });
});

test('loadByCode returns null for a 404 (nothing saved under that code)', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(404, { error: 'not found' }));
  const data = await loadByCode('ab12', { fetchImpl });
  assert.equal(data, null);
});

test('loadByCode throws on an unexpected server error', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(500, { error: 'boom' }));
  await assert.rejects(() => loadByCode('ab12', { fetchImpl }));
});

import {
  isValidEmailCode,
  sendEmailCode,
  pushEmailCode,
  redeemEmailCode,
  buildEmailPushBeaconBlob,
  EMAIL_PUSH_URL,
} from '../js/systems/cloudSave.js';

test('isValidEmailCode accepts an 8-char code from the unambiguous alphabet only', () => {
  assert.equal(isValidEmailCode('abcdefgh'), true);
  assert.equal(isValidEmailCode('0bcdefgh'), false);
  assert.equal(isValidEmailCode('abc'), false);
});

test('sendEmailCode POSTs { email, data } and returns { ok, code }', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(200, { ok: true, code: 'abcd2345' }));
  const result = await sendEmailCode('person@example.com', { hello: 'world' }, { fetchImpl });
  assert.deepEqual(result, { ok: true, code: 'abcd2345' });
  assert.equal(fetchImpl.calls[0].url, '/api/save/email/send');
  assert.equal(fetchImpl.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { email: 'person@example.com', data: { hello: 'world' } });
});

test('sendEmailCode reports failure without throwing when the server rejects it', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(429, { error: 'too many requests' }));
  const result = await sendEmailCode('person@example.com', {}, { fetchImpl });
  assert.equal(result.ok, false);
});

test('pushEmailCode returns { ok: true } on success', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(200, { ok: true }));
  const result = await pushEmailCode('abcd2345', { level: 2 }, { fetchImpl });
  assert.deepEqual(result, { ok: true, deadCode: false });
  assert.equal(fetchImpl.calls[0].url, '/api/save/email/push');
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { code: 'abcd2345', data: { level: 2 } });
});

test('pushEmailCode flags a 404 as a dead code rather than throwing', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(404, { error: 'not found' }));
  const result = await pushEmailCode('abcd2345', {}, { fetchImpl });
  assert.deepEqual(result, { ok: false, deadCode: true });
});

test('redeemEmailCode returns the saved data on success', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(200, { data: { level: 5 } }));
  const data = await redeemEmailCode('abcd2345', { fetchImpl });
  assert.deepEqual(data, { level: 5 });
});

test('redeemEmailCode returns null for a 404 (nothing live under that code)', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(404, { error: 'not found' }));
  const data = await redeemEmailCode('abcd2345', { fetchImpl });
  assert.equal(data, null);
});

test('redeemEmailCode throws on an unexpected server error', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(500, { error: 'boom' }));
  await assert.rejects(() => redeemEmailCode('abcd2345', { fetchImpl }));
});

test('buildEmailPushBeaconBlob builds a JSON Blob matching the push payload shape', async () => {
  const blob = buildEmailPushBeaconBlob('abcd2345', { level: 2 });
  assert.equal(blob.type, 'application/json');
  const text = await blob.text();
  assert.deepEqual(JSON.parse(text), { code: 'abcd2345', data: { level: 2 } });
});

test('EMAIL_PUSH_URL matches the push endpoint path', () => {
  assert.equal(EMAIL_PUSH_URL, '/api/save/email/push');
});
