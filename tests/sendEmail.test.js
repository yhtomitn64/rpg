import test from 'node:test';
import assert from 'node:assert/strict';
import { sendCodeEmail } from '../functions/_shared/sendEmail.js';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  fn.calls = calls;
  return fn;
}

test('sendCodeEmail POSTs to Resend with the code as the only template variable', async () => {
  const fetchImpl = fakeFetch(() => ({ ok: true, status: 200 }));
  const ok = await sendCodeEmail('person@example.com', 'abcd2345', { apiKey: 'test-key', fetchImpl });
  assert.equal(ok, true);
  assert.equal(fetchImpl.calls.length, 1);
  const { url, options } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer test-key');
  assert.equal(options.headers['Content-Type'], 'application/json');
  const body = JSON.parse(options.body);
  assert.equal(body.to, 'person@example.com');
  assert.ok(body.html.includes('abcd2345'));
  assert.ok(body.text.includes('abcd2345'));
  // No user-controlled subject/body variable beyond the code itself.
  assert.equal(typeof body.subject, 'string');
});

test('sendCodeEmail returns false without throwing when Resend rejects the request', async () => {
  const fetchImpl = fakeFetch(() => ({ ok: false, status: 422 }));
  const ok = await sendCodeEmail('person@example.com', 'abcd2345', { apiKey: 'test-key', fetchImpl });
  assert.equal(ok, false);
});
