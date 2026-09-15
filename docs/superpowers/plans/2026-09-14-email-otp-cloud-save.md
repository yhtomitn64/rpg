# Email One-Time-Code Cross-Device Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standing, email-based cross-device save-transfer option (send yourself an 8-character code, paste it on another device, up to 24 hours later) alongside the existing 60-second code-transfer flow.

**Architecture:** Three new Cloudflare Pages Functions (`send`/`push`/`redeem`) back a per-code KV entry (`emailcode:<code>`, rolling 24h TTL) via the existing `SAVES` namespace. The client generalizes the existing `persist()`/`pagehide` local-save machinery to also throttle-push to whichever code is currently linked, flushing a final push via `navigator.sendBeacon` on tab close. A shared rate limiter gets a `keyPrefix`/`identifier` generalization so each new route gets its own abuse-throttling counter instead of sharing one.

**Tech Stack:** Cloudflare Pages Functions (plain JS, no framework), Cloudflare Workers KV (`SAVES` namespace, already provisioned), Resend (transactional email API, HTTP `fetch`, no SDK), vanilla JS client (no framework), `node:test` for all automated tests.

**Spec:** `docs/superpowers/specs/2026-09-14-email-otp-cloud-save-design.md`

## Global Constraints

- No PII stored or logged: the `email` field is used only to trigger a send and is never written to KV or any log line anywhere in this codebase.
- Per-recipient throttling must key on `HMAC-SHA256(email, secret)`, never a bare hash of the email (bare hashes of emails are dictionary-reversible).
- `emailcode:<code>` values get their `expirationTtl` **reset to 24h (86400s) on every successful `push`**, not just at creation (rolling TTL — deliberate, see spec's "Rolling TTL" section).
- Code format: 8 characters from the alphabet `abcdefghjkmnpqrstuvwxyz23456789` (31 symbols — digits 0/1 and letters i/l/o excluded for visual ambiguity).
- `send`/`push`/`redeem` each get their **own** rate-limit counter (`keyPrefix`), never sharing one with each other or with the existing code-transfer route.
- Two new secrets are required and must be set via `wrangler pages secret put` — **never** added to `wrangler.toml`'s `[vars]` (plaintext, committed): `RESEND_API_KEY`, `EMAIL_RATE_LIMIT_SECRET`. This is a human prerequisite (Task 4 documents it) that blocks the feature from working end-to-end, but every other task is independently testable without it.
- Wire payload shape is `{ data }` (or `{ email, data }` / `{ code, data }` / `{ code }`) — no separate top-level `characterId` field; `data.characterId` already carries it, matching the existing code-transfer route's own `{ data }`-only shape.

---

### Task 1: Generalize the shared rate limiter with a custom key prefix/identifier

**Files:**
- Modify: `functions/_shared/rateLimit.js`
- Test: `tests/rateLimit.test.js` (new)

**Interfaces:**
- Produces: `checkRateLimit(env, request, { max, windowSeconds, keyPrefix, identifier })` — `keyPrefix` (default `'ratelimit'`) and `identifier` (default: `request`'s `CF-Connecting-IP` header, falling back to `'unknown'`) are new, both optional; existing callers that pass neither get byte-for-byte the same behavior and KV key (`ratelimit:<ip>`) as today.

- [ ] **Step 1: Write the failing tests**

```js
// tests/rateLimit.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/rateLimit.test.js` (or `node --test tests/rateLimit.test.js`)
Expected: FAIL — `checkRateLimit` doesn't accept `keyPrefix`/`identifier` yet, so the isolation tests fail (both custom-prefix calls collide on the same default key).

- [ ] **Step 3: Add `keyPrefix`/`identifier` to `checkRateLimit`**

Replace the full contents of `functions/_shared/rateLimit.js` with:

```js
// Shared per-IP rate limiter for functions/api/save/*, backed by the same
// SAVES KV namespace those routes already need (no extra provisioning).
//
// Raised 2026-09-09: with only a 4-char save code (36^4 ~= 1.68M
// combinations) as the sole credential on the device-code path, and no
// second secret (deliberately - Timothy wants the code short, not a long
// thing to remember), the only real defense against a script sweeping
// every possible code to overwrite/delete saves is throttling request
// volume. This isn't a hard security boundary (KV reads/writes aren't
// atomic, so a concurrent burst can slip a few requests past the count,
// and a distributed attacker with many IPs isn't slowed at all) - it's a
// deterrent sized for "keep a casual single-script sweep impractical,"
// matching this feature's own low-stakes threat model.
//
// `keyPrefix`/`identifier` added 2026-09-14 for the email-OTP cloud save
// feature (docs/superpowers/specs/2026-09-14-email-otp-cloud-save-design.md):
// its three routes (send/push/redeem) each need their own isolated
// counter rather than sharing one bucket keyed only on IP - `send`
// additionally needs a per-recipient counter (an HMAC of the email, not
// an IP) so an attacker rotating IPs can't bypass a per-victim cap. Both
// default to today's exact behavior, so every existing call site is
// unaffected.
const DEFAULT_MAX_REQUESTS = 20;
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_KEY_PREFIX = 'ratelimit';

export async function checkRateLimit(env, request, {
  max = DEFAULT_MAX_REQUESTS,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
  keyPrefix = DEFAULT_KEY_PREFIX,
  identifier,
} = {}) {
  const id = identifier ?? (request.headers.get('CF-Connecting-IP') || 'unknown');
  const key = `${keyPrefix}:${id}`;
  const raw = await env.SAVES.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= max) return false;
  await env.SAVES.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return true;
}

export function rateLimitedResponse() {
  return new Response(JSON.stringify({ error: 'too many requests, slow down' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/rateLimit.test.js`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/_shared/rateLimit.js tests/rateLimit.test.js
git commit -m "feat: let checkRateLimit use an isolated key prefix/identifier"
```

---

### Task 2: Email code generation, validation, and per-recipient hashing

**Files:**
- Create: `functions/_shared/emailCode.js`
- Test: `tests/emailCode.test.js`

**Interfaces:**
- Produces: `EMAIL_CODE_LENGTH` (8), `generateEmailCode(random = Math.random)`, `isValidEmailCode(code)`, `isValidEmailAddress(email)`, `hashEmailForRateLimit(email, secret)` (async, returns a 32-hex-char string).
- Consumes: nothing from other tasks (pure module, Web Crypto only).

- [ ] **Step 1: Write the failing tests**

```js
// tests/emailCode.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_CODE_LENGTH,
  generateEmailCode,
  isValidEmailCode,
  isValidEmailAddress,
  hashEmailForRateLimit,
} from '../functions/_shared/emailCode.js';

test('generateEmailCode is 8 characters from the unambiguous alphabet', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateEmailCode();
    assert.equal(code.length, EMAIL_CODE_LENGTH);
    assert.match(code, /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
  }
});

test('generateEmailCode is deterministic for a given random source', () => {
  let calls = 0;
  const fixedRandom = () => { calls++; return 0; };
  assert.equal(generateEmailCode(fixedRandom), 'aaaaaaaa');
  assert.equal(calls, 8);
});

test('isValidEmailCode accepts only 8 characters from the unambiguous alphabet', () => {
  assert.equal(isValidEmailCode('abcdefgh'), true);
  assert.equal(isValidEmailCode('0bcdefgh'), false); // 0 excluded
  assert.equal(isValidEmailCode('1bcdefgh'), false); // 1 excluded
  assert.equal(isValidEmailCode('ibcdefgh'), false); // i excluded
  assert.equal(isValidEmailCode('lbcdefgh'), false); // l excluded
  assert.equal(isValidEmailCode('obcdefgh'), false); // o excluded
  assert.equal(isValidEmailCode('ABCDEFGH'), false); // lowercase only
  assert.equal(isValidEmailCode('abcdefg'), false); // too short
  assert.equal(isValidEmailCode(null), false);
});

test('isValidEmailAddress accepts a plain single address', () => {
  assert.equal(isValidEmailAddress('person@example.com'), true);
  assert.equal(isValidEmailAddress('a.b+tag@sub.example.co'), true);
});

test('isValidEmailAddress rejects multiple addresses, display names, and junk', () => {
  assert.equal(isValidEmailAddress('a@example.com,b@example.com'), false);
  assert.equal(isValidEmailAddress('Name <a@example.com>'), false);
  assert.equal(isValidEmailAddress('not-an-email'), false);
  assert.equal(isValidEmailAddress(''), false);
  assert.equal(isValidEmailAddress(null), false);
  assert.equal(isValidEmailAddress('a'.repeat(260) + '@example.com'), false); // too long
});

test('hashEmailForRateLimit is deterministic for the same email+secret and case-insensitive', async () => {
  const a = await hashEmailForRateLimit('Person@Example.com', 'secret1');
  const b = await hashEmailForRateLimit('person@example.com', 'secret1');
  assert.equal(a, b);
  assert.equal(a.length, 32);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('hashEmailForRateLimit differs for different secrets (not just a bare hash of the email)', async () => {
  const a = await hashEmailForRateLimit('person@example.com', 'secret1');
  const b = await hashEmailForRateLimit('person@example.com', 'secret2');
  assert.notEqual(a, b);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/emailCode.test.js`
Expected: FAIL with "Cannot find module '../functions/_shared/emailCode.js'"

- [ ] **Step 3: Implement `functions/_shared/emailCode.js`**

```js
// Code generation/validation and per-recipient rate-limit hashing shared
// by the three email-OTP cloud-save routes (functions/api/save/email/).
// See docs/superpowers/specs/2026-09-14-email-otp-cloud-save-design.md.
//
// Longer and pickier than the existing 4-char code-transfer alphabet
// (js/systems/cloudSave.js) on purpose - this code can live up to 24
// hours (vs. 60 seconds), and excludes visually-similar characters
// (digits 0/1, letters i/l/o) since someone might read it off a phone
// screen and type it into a different device's keyboard rather than
// copy-pasting.
const EMAIL_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const EMAIL_CODE_LENGTH = 8;

export function generateEmailCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < EMAIL_CODE_LENGTH; i++) {
    code += EMAIL_CODE_ALPHABET[Math.floor(random() * EMAIL_CODE_ALPHABET.length)];
  }
  return code;
}

export function isValidEmailCode(code) {
  return typeof code === 'string' && new RegExp(`^[${EMAIL_CODE_ALPHABET}]{${EMAIL_CODE_LENGTH}}$`).test(code);
}

// Deliberately strict: exactly one plain address, no commas, no
// angle-bracket display-name wrapping. The send route uses this to
// reject anything that isn't a single address before it ever reaches
// the email API - a permissive check here would make the endpoint an
// open relay for arbitrary recipients.
const EMAIL_PATTERN = /^[^\s,<>()[\]:;@"]+@[^\s,<>()[\]:;@"]+\.[^\s,<>()[\]:;@"]+$/;

export function isValidEmailAddress(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_PATTERN.test(email);
}

// HMAC-SHA256 (Web Crypto, no new dependency), truncated to 32 hex
// characters - used ONLY as an ephemeral per-recipient rate-limit key
// (functions/_shared/rateLimit.js's `identifier` option). Deliberately
// not a bare hash: a plain SHA-256 of an email address is trivially
// reversible by dictionary (the space of real addresses is small enough
// to precompute), which would quietly break this feature's "we never
// store your email" claim under scrutiny. `secret` must be a Worker
// secret (see the design doc's Human prerequisite section) - a
// static/checked-in secret would make this no better than a bare hash.
export async function hashEmailForRateLimit(email, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email.toLowerCase()));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/emailCode.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/_shared/emailCode.js tests/emailCode.test.js
git commit -m "feat: add email-OTP code generation/validation and recipient hashing"
```

---

### Task 3: Resend email-sending wrapper

**Files:**
- Create: `functions/_shared/sendEmail.js`
- Test: `tests/sendEmail.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `sendCodeEmail(email, code, { apiKey, fetchImpl = fetch })` — async, returns `true`/`false` (never throws on an HTTP-level failure; a thrown error only for a `fetchImpl` that itself throws, e.g. a network error).

- [ ] **Step 1: Write the failing tests**

```js
// tests/sendEmail.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sendEmail.test.js`
Expected: FAIL with "Cannot find module '../functions/_shared/sendEmail.js'"

- [ ] **Step 3: Implement `functions/_shared/sendEmail.js`**

```js
// Thin Resend (resend.com) wrapper for the email-OTP cloud save feature's
// only outbound email. See docs/superpowers/specs/2026-09-14-email-otp-
// cloud-save-design.md - Cloudflare has no outbound transactional-email
// product of its own (Email Routing is inbound-only), so this calls a
// third-party HTTP API directly rather than adding an SMTP dependency.
//
// The code is the ONLY variable in this template - never accept a
// caller-supplied subject or body. A permissive template here would
// turn this endpoint into a way to send arbitrary text to arbitrary
// addresses.
const RESEND_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'rpg@rpg.burghertime.com';

export async function sendCodeEmail(email, code, { apiKey, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: email,
      subject: 'Your emoji-rpg cloud save code',
      text: `Your code: ${code}\n\nEnter this on your other device within 24 hours to load this character. If you don't use it, it expires on its own - no action needed.`,
      html: `<p>Your code: <strong>${code}</strong></p><p>Enter this on your other device within 24 hours to load this character. If you don't use it, it expires on its own - no action needed.</p>`,
    }),
  });
  return response.ok;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/sendEmail.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/_shared/sendEmail.js tests/sendEmail.test.js
git commit -m "feat: add Resend email-sending wrapper for cloud-save codes"
```

---

### Task 4: `POST /api/save/email/send` endpoint

**Files:**
- Create: `functions/api/save/email/send.js`
- Modify: `wrangler.toml` (comment only, documenting the required secrets)
- Test: `tests/apiSaveEmailSend.test.js`

**Interfaces:**
- Consumes: `checkRateLimit`, `rateLimitedResponse` (Task 1); `EMAIL_CODE_LENGTH`, `generateEmailCode`, `isValidEmailAddress`, `hashEmailForRateLimit` (Task 2); `sendCodeEmail` (Task 3).
- Produces: `onRequestPost({ request, env })` — a Cloudflare Pages Function handler, callable directly as a plain async function in tests (no Cloudflare runtime needed). Success response: `{ ok: true, code }`, status 200. `env` must provide `SAVES` (KV namespace), `RESEND_API_KEY`, `EMAIL_RATE_LIMIT_SECRET`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/apiSaveEmailSend.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apiSaveEmailSend.test.js`
Expected: FAIL with "Cannot find module '../functions/api/save/email/send.js'"

- [ ] **Step 3: Implement `functions/api/save/email/send.js`**

```js
// Cloudflare Pages Function: POST /api/save/email/send
//
// Standing, email-verified cloud save - an alternative to the anonymous,
// one-shot code-transfer flow (../../code/[code].js). The ONLY route
// under functions/api/save/email/ that can trigger an email; see
// ./push.js and ./redeem.js for the other two. Backed by the SAVES KV
// namespace, one key per code: `emailcode:<code>`. See the design doc
// (docs/superpowers/specs/2026-09-14-email-otp-cloud-save-design.md) for
// the full write-up, especially the Abuse surface and Privacy sections.
//
// Requires two secrets, set via `wrangler pages secret put` (never
// wrangler.toml's [vars], which is plaintext and committed):
// RESEND_API_KEY (a real external credential) and
// EMAIL_RATE_LIMIT_SECRET (any random string, used only as an HMAC key -
// see functions/_shared/emailCode.js's hashEmailForRateLimit). Requests
// fail closed (500, since sendCodeEmail/hashEmailForRateLimit need real
// values) until both are set - this is a human prerequisite, not
// something this session can complete.
import { checkRateLimit, rateLimitedResponse } from '../../../_shared/rateLimit.js';
import { generateEmailCode, isValidEmailAddress, hashEmailForRateLimit } from '../../../_shared/emailCode.js';
import { sendCodeEmail } from '../../../_shared/sendEmail.js';

const EMAIL_TTL_SECONDS = 86400; // 24h - see design doc's Rolling TTL section
const MAX_BODY_BYTES = 200_000; // matches the code-transfer route's own limit

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  // Tight, send-specific caps - legitimate usage is "once per transfer
  // attempt," never a cadence. Isolated keyPrefixes so this never shares
  // a counter with push/redeem or the code-transfer route.
  if (!(await checkRateLimit(env, request, { max: 3, windowSeconds: 3600, keyPrefix: 'email-send-ip' }))) {
    return rateLimitedResponse();
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return jsonResponse({ error: 'save too large' }, 413);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  const { email, data } = parsed ?? {};
  if (!isValidEmailAddress(email)) return jsonResponse({ error: 'invalid email address' }, 400);
  if (!data || typeof data !== 'object') return jsonResponse({ error: 'expected { email, data }' }, 400);

  const recipientHash = await hashEmailForRateLimit(email, env.EMAIL_RATE_LIMIT_SECRET);
  if (!(await checkRateLimit(env, request, {
    max: 3,
    windowSeconds: 3600,
    keyPrefix: 'email-send-recipient',
    identifier: recipientHash,
  }))) {
    return rateLimitedResponse();
  }

  const code = generateEmailCode();
  await env.SAVES.put(
    `emailcode:${code}`,
    JSON.stringify({ data, savedAt: new Date().toISOString() }),
    { expirationTtl: EMAIL_TTL_SECONDS },
  );

  const sendImpl = env.__sendCodeEmailImpl ?? ((e, c) => sendCodeEmail(e, c, { apiKey: env.RESEND_API_KEY }));
  const sent = await sendImpl(email, code);
  if (!sent) return jsonResponse({ error: 'failed to send email' }, 502);

  return jsonResponse({ ok: true, code });
}
```

*(Note on `env.__sendCodeEmailImpl`: this is a test seam, not a public feature — production `env` never sets it, so the real `sendCodeEmail` call is always what runs live. This mirrors the `fetchImpl` injection pattern used throughout the client code, adapted for a Pages Function where the "env" object is how Cloudflare threads bindings/config in.)*

- [ ] **Step 4: Add the secrets documentation comment to `wrangler.toml`**

Add this comment block at the end of `wrangler.toml` (do not add a `[vars]` entry for either secret):

```toml
# Two secrets are required for functions/api/save/email/* (the email-OTP
# cloud save feature) and must be set via `wrangler pages secret put
# <NAME>` (or the Cloudflare Pages dashboard's environment variables,
# marked "Secret" not "Plaintext") - NEVER added above as a [vars] entry,
# which is plaintext and committed to this file:
#   RESEND_API_KEY          - from a Resend (resend.com) account
#   EMAIL_RATE_LIMIT_SECRET - any random string; only used as an HMAC key
# See docs/superpowers/specs/2026-09-14-email-otp-cloud-save-design.md's
# "Human prerequisite" section.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/apiSaveEmailSend.test.js`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add functions/api/save/email/send.js wrangler.toml tests/apiSaveEmailSend.test.js
git commit -m "feat: add POST /api/save/email/send endpoint"
```

---

### Task 5: `POST /api/save/email/push` endpoint

**Files:**
- Create: `functions/api/save/email/push.js`
- Test: `tests/apiSaveEmailPush.test.js`

**Interfaces:**
- Consumes: `checkRateLimit`, `rateLimitedResponse` (Task 1); `isValidEmailCode` (Task 2).
- Produces: `onRequestPost({ request, env })`. Success: `{ ok: true }`, 200. Dead/unknown code: `{ error: ... }`, 404.

- [ ] **Step 1: Write the failing tests**

```js
// tests/apiSaveEmailPush.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apiSaveEmailPush.test.js`
Expected: FAIL with "Cannot find module '../functions/api/save/email/push.js'"

- [ ] **Step 3: Implement `functions/api/save/email/push.js`**

```js
// Cloudflare Pages Function: POST /api/save/email/push
//
// Refreshes an already-issued code's data and TTL - called by the
// client's throttled auto-save (js/systems/cloudAutoSave.js) roughly
// every 2 minutes of active play, and by the exit-time sendBeacon flush.
// Never sends an email - see ./send.js for the only route that does.
// 404s for an unknown/expired/already-redeemed code; the client treats
// that as "this link is dead" and stops pushing to it (see the design
// doc's Client flow section).
import { checkRateLimit, rateLimitedResponse } from '../../../_shared/rateLimit.js';
import { isValidEmailCode } from '../../../_shared/emailCode.js';

const EMAIL_TTL_SECONDS = 86400; // 24h, reset on every push - see design doc's Rolling TTL section
const MAX_BODY_BYTES = 200_000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  // Generous relative to the 2-minute client throttle (a couple of
  // devices pushing, plus headroom) - isolated from send/redeem's own
  // counters via keyPrefix.
  if (!(await checkRateLimit(env, request, { max: 10, keyPrefix: 'email-push-ip' }))) {
    return rateLimitedResponse();
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return jsonResponse({ error: 'save too large' }, 413);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  const { code, data } = parsed ?? {};
  if (!isValidEmailCode(code)) return jsonResponse({ error: 'invalid code' }, 400);
  if (!data || typeof data !== 'object') return jsonResponse({ error: 'expected { code, data }' }, 400);

  const existing = await env.SAVES.get(`emailcode:${code}`);
  if (existing === null) return jsonResponse({ error: 'not found' }, 404);

  await env.SAVES.put(
    `emailcode:${code}`,
    JSON.stringify({ data, savedAt: new Date().toISOString() }),
    { expirationTtl: EMAIL_TTL_SECONDS },
  );
  return jsonResponse({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/apiSaveEmailPush.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/api/save/email/push.js tests/apiSaveEmailPush.test.js
git commit -m "feat: add POST /api/save/email/push endpoint"
```

---

### Task 6: `POST /api/save/email/redeem` endpoint

**Files:**
- Create: `functions/api/save/email/redeem.js`
- Test: `tests/apiSaveEmailRedeem.test.js`

**Interfaces:**
- Consumes: `checkRateLimit`, `rateLimitedResponse` (Task 1); `isValidEmailCode` (Task 2).
- Produces: `onRequestPost({ request, env })`. Success: `{ data }`, 200, and deletes the KV key. Unknown code: `{ error: ... }`, 404.

- [ ] **Step 1: Write the failing tests**

```js
// tests/apiSaveEmailRedeem.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/save/email/redeem.js';

function fakeKvNamespace(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apiSaveEmailRedeem.test.js`
Expected: FAIL with "Cannot find module '../functions/api/save/email/redeem.js'"

- [ ] **Step 3: Implement `functions/api/save/email/redeem.js`**

```js
// Cloudflare Pages Function: POST /api/save/email/redeem
//
// One-shot: returns the character stored under `code` and deletes it
// immediately, same spirit as the existing code-transfer route's
// single-use codes. A second redemption (this device or the original
// one) 404s, same "dead link" contract push.js uses for an expired code.
import { checkRateLimit, rateLimitedResponse } from '../../../_shared/rateLimit.js';
import { isValidEmailCode } from '../../../_shared/emailCode.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  // Tight cap - the real defense against guessing a code over its
  // 24h lifetime is this limit, not the alphabet alone (see design
  // doc's Code format section). Isolated from send/push via keyPrefix.
  if (!(await checkRateLimit(env, request, { max: 5, keyPrefix: 'email-redeem-ip' }))) {
    return rateLimitedResponse();
  }

  let parsed;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  const { code } = parsed ?? {};
  if (!isValidEmailCode(code)) return jsonResponse({ error: 'invalid code' }, 400);

  const raw = await env.SAVES.get(`emailcode:${code}`);
  if (raw === null) return jsonResponse({ error: 'not found' }, 404);
  await env.SAVES.delete(`emailcode:${code}`);

  const { data } = JSON.parse(raw);
  return jsonResponse({ data });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/apiSaveEmailRedeem.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/api/save/email/redeem.js tests/apiSaveEmailRedeem.test.js
git commit -m "feat: add POST /api/save/email/redeem endpoint"
```

---

### Task 7: Client network functions in `cloudSave.js`

**Files:**
- Modify: `js/systems/cloudSave.js`
- Test: `tests/cloudSave.test.js` (extend)

**Interfaces:**
- Consumes: nothing from other tasks (client-side, mirrors the existing `saveByCode`/`loadByCode` pattern in the same file).
- Produces: `isValidEmailCode(code)`, `sendEmailCode(email, data, { fetchImpl })` → `Promise<{ ok, code }>`, `pushEmailCode(code, data, { fetchImpl })` → `Promise<{ ok, deadCode }>`, `redeemEmailCode(code, { fetchImpl })` → `Promise<data|null>` (null on 404, matching `loadByCode`'s contract), `buildEmailPushBeaconBlob(code, data)` → `Blob`, `EMAIL_PUSH_URL` (string constant, for `cloudAutoSave.js`'s `sendBeacon` call).

- [ ] **Step 1: Write the failing tests**

Append to `tests/cloudSave.test.js` (keep the existing `fakeFetch`/`jsonResponse` helpers already defined near the top of that file):

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cloudSave.test.js`
Expected: FAIL — the new exports don't exist yet.

- [ ] **Step 3: Add the new exports to `js/systems/cloudSave.js`**

Append to the end of `js/systems/cloudSave.js` (leave everything already in the file untouched):

```js

// Email one-time-code cross-device save - a standing alternative to the
// 60-second code-transfer flow above. See
// docs/superpowers/specs/2026-09-14-email-otp-cloud-save-design.md.
const EMAIL_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const EMAIL_CODE_LENGTH = 8;

export function isValidEmailCode(code) {
  return typeof code === 'string' && new RegExp(`^[${EMAIL_CODE_ALPHABET}]{${EMAIL_CODE_LENGTH}}$`).test(code);
}

export const EMAIL_SEND_URL = '/api/save/email/send';
export const EMAIL_PUSH_URL = '/api/save/email/push';
const EMAIL_REDEEM_URL = '/api/save/email/redeem';

// Requests a fresh code: writes `data` under it server-side (24h TTL)
// and emails the code to `email`. Returns the code to the caller too -
// the originating device doesn't need to check its own email, since it
// already has the code back synchronously and uses it to keep pushing
// (js/systems/cloudAutoSave.js).
export async function sendEmailCode(email, data, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(EMAIL_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, data }),
  });
  if (!response.ok) return { ok: false, code: null };
  const body = await response.json();
  return { ok: true, code: body.code };
}

// Refreshes an already-issued code's data (and its 24h TTL). `deadCode`
// is true only for a 404 - the code doesn't exist any more (expired or
// already redeemed) - which callers should treat as "stop pushing to
// this code," not as a transient failure to retry.
export async function pushEmailCode(code, data, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(EMAIL_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, data }),
  });
  if (response.status === 404) return { ok: false, deadCode: true };
  return { ok: response.ok, deadCode: false };
}

// Returns the saved data for a code (and consumes it server-side - a
// second call for the same code returns null too), or null if nothing
// is live under it. Mirrors loadByCode's null-on-404 contract above.
export async function redeemEmailCode(code, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(EMAIL_REDEEM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Email cloud load failed: ${response.status}`);
  const body = await response.json();
  return body.data ?? null;
}

// Builds the payload for navigator.sendBeacon (used by the exit-time
// auto-save flush, js/systems/cloudAutoSave.js) instead of pushEmailCode's
// fetch call - sendBeacon needs a raw Blob body, not a fetch options
// object, and is built to survive the page already unloading (unlike
// fetch, which can be cancelled mid-flight in that situation).
export function buildEmailPushBeaconBlob(code, data) {
  return new Blob([JSON.stringify({ code, data })], { type: 'application/json' });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cloudSave.test.js`
Expected: PASS (all existing tests plus the new ones)

- [ ] **Step 5: Commit**

```bash
git add js/systems/cloudSave.js tests/cloudSave.test.js
git commit -m "feat: add email-OTP client functions to cloudSave.js"
```

---

### Task 8: Throttled auto-save coordinator (`cloudAutoSave.js`)

**Files:**
- Create: `js/systems/cloudAutoSave.js`
- Test: `tests/cloudAutoSave.test.js`

**Interfaces:**
- Consumes: `pushEmailCode`, `buildEmailPushBeaconBlob`, `EMAIL_PUSH_URL` (Task 7).
- Produces: `setActiveEmailCode(code)`, `clearActiveEmailCode()`, `isLinked()`, `getActiveEmailCode()`, `notifyLocalSave(getCharacterData, opts)`, `flushViaBeacon(getCharacterData, opts)`, `CLOUD_AUTO_SAVE_THROTTLE_MS` (constant, 120000), `__resetForTest()`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/cloudAutoSave.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setActiveEmailCode,
  clearActiveEmailCode,
  isLinked,
  getActiveEmailCode,
  notifyLocalSave,
  flushViaBeacon,
  CLOUD_AUTO_SAVE_THROTTLE_MS,
  __resetForTest,
} from '../js/systems/cloudAutoSave.js';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, options) => { calls.push({ url, options }); return handler(url, options); };
  fn.calls = calls;
  return fn;
}
const okResponse = { ok: true, status: 200, json: async () => ({ ok: true }) };

// Drains the real microtask queue (setTimeout is mocked per-test via
// t.mock.timers, but setImmediate is not - it only fires once every
// currently-queued microtask, including a chained fetch/await sequence
// kicked off by a mock timer tick, has finished). Safer than guessing how
// many `await Promise.resolve()` hops a given chain needs.
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test.beforeEach(() => {
  __resetForTest();
  clearActiveEmailCode();
});

test('isLinked/getActiveEmailCode reflect setActiveEmailCode/clearActiveEmailCode', () => {
  assert.equal(isLinked(), false);
  setActiveEmailCode('abcd2345');
  assert.equal(isLinked(), true);
  assert.equal(getActiveEmailCode(), 'abcd2345');
  clearActiveEmailCode();
  assert.equal(isLinked(), false);
  assert.equal(getActiveEmailCode(), null);
});

test('notifyLocalSave is a no-op when not linked', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchImpl = fakeFetch(() => okResponse);
  notifyLocalSave(() => ({ level: 1 }), { fetchImpl });
  t.mock.timers.tick(CLOUD_AUTO_SAVE_THROTTLE_MS);
  assert.equal(fetchImpl.calls.length, 0);
});

test('notifyLocalSave pushes once after the throttle window, batching multiple calls', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setActiveEmailCode('abcd2345');
  const fetchImpl = fakeFetch(() => okResponse);
  notifyLocalSave(() => ({ level: 1 }), { fetchImpl });
  notifyLocalSave(() => ({ level: 2 }), { fetchImpl }); // same window - should not schedule a second timer
  notifyLocalSave(() => ({ level: 3 }), { fetchImpl });
  assert.equal(fetchImpl.calls.length, 0); // nothing yet - still inside the throttle window
  t.mock.timers.tick(CLOUD_AUTO_SAVE_THROTTLE_MS);
  await flushMicrotasks(); // let the pending push's promise chain settle
  assert.equal(fetchImpl.calls.length, 1); // batched into a single push
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { code: 'abcd2345', data: { level: 3 } }); // latest data wins
});

test('notifyLocalSave clears the link on a dead-code (404) response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setActiveEmailCode('abcd2345');
  const fetchImpl = fakeFetch(() => ({ ok: false, status: 404, json: async () => ({ error: 'not found' }) }));
  notifyLocalSave(() => ({ level: 1 }), { fetchImpl });
  t.mock.timers.tick(CLOUD_AUTO_SAVE_THROTTLE_MS);
  await flushMicrotasks();
  assert.equal(isLinked(), false);
});

test('flushViaBeacon is a no-op when not linked or nothing is pending', () => {
  const calls = [];
  const sendBeaconImpl = (url, blob) => { calls.push({ url, blob }); return true; };
  flushViaBeacon(() => ({ level: 1 }), { sendBeaconImpl });
  assert.equal(calls.length, 0);
  setActiveEmailCode('abcd2345'); // linked, but nothing pending yet
  flushViaBeacon(() => ({ level: 1 }), { sendBeaconImpl });
  assert.equal(calls.length, 0);
});

test('flushViaBeacon fires immediately via sendBeacon when a push is pending, bypassing the throttle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setActiveEmailCode('abcd2345');
  const fetchImpl = fakeFetch(() => okResponse); // should NOT be called - beacon path bypasses fetch
  notifyLocalSave(() => ({ level: 1 }), { fetchImpl }); // marks pending, schedules a timer far in the future
  const calls = [];
  const sendBeaconImpl = (url, blob) => { calls.push({ url, blob }); return true; };
  flushViaBeacon(() => ({ level: 9 }), { sendBeaconImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/save/email/push');
  assert.equal(fetchImpl.calls.length, 0);
  // The pending flag is cleared - a later timer fire (if any survives) should push nothing new.
  t.mock.timers.tick(CLOUD_AUTO_SAVE_THROTTLE_MS);
  assert.equal(fetchImpl.calls.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cloudAutoSave.test.js`
Expected: FAIL with "Cannot find module '../js/systems/cloudAutoSave.js'"

- [ ] **Step 3: Implement `js/systems/cloudAutoSave.js`**

```js
// Throttled, best-effort auto-push coordinator for the email-OTP cloud
// save feature. See docs/superpowers/specs/2026-09-14-email-otp-cloud-
// save-design.md's Client flow section.
//
// Deliberately auth-mechanism-agnostic in shape (setActiveEmailCode/
// isLinked rather than baking in "email" everywhere) so a future second
// link mechanism (e.g. the shelved Google Sign-In design) could reuse
// this same throttle/beacon machinery rather than duplicating it.
import { pushEmailCode, buildEmailPushBeaconBlob, EMAIL_PUSH_URL } from './cloudSave.js';

export const CLOUD_AUTO_SAVE_THROTTLE_MS = 120_000; // 2 minutes - see design doc's Write budget section

let activeCode = null;
let pending = false;
let lastPushAt = 0;
let timerId = null;

export function setActiveEmailCode(code) {
  activeCode = code;
}

export function clearActiveEmailCode() {
  activeCode = null;
  pending = false;
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
}

export function isLinked() {
  return activeCode !== null;
}

export function getActiveEmailCode() {
  return activeCode;
}

async function doPush(getCharacterData, { fetchImpl } = {}) {
  pending = false;
  lastPushAt = Date.now();
  const result = await pushEmailCode(activeCode, getCharacterData(), { fetchImpl });
  // Best-effort: no retry queue, no user-facing error (see design doc's
  // Client flow section) - the next throttled cycle, or a manual
  // "Send me a code" re-link, covers a transient failure. A dead code
  // (expired/already redeemed) is the one case that needs a state
  // change: stop trying to push to something that no longer exists.
  if (result.deadCode) clearActiveEmailCode();
}

// Call on every local persist() (js/main.js). No-op unless linked. Marks
// a push pending and, if nothing is already scheduled, schedules one for
// whatever's left of the throttle window - so a burst of local saves
// inside the window collapses into a single network push using
// whatever's the latest data by the time the timer fires.
export function notifyLocalSave(getCharacterData, { fetchImpl, nowMs = Date.now() } = {}) {
  if (!isLinked()) return;
  pending = true;
  if (timerId) return;
  const delay = Math.max(0, CLOUD_AUTO_SAVE_THROTTLE_MS - (nowMs - lastPushAt));
  timerId = setTimeout(() => {
    timerId = null;
    if (pending) doPush(getCharacterData, { fetchImpl });
  }, delay);
}

// Call from the existing pagehide/visibilitychange-hidden flush
// (flushPendingPersist, js/main.js). Bypasses the throttle floor
// entirely - the one guaranteed-delivery path, via sendBeacon rather
// than fetch, since fetch can be cancelled mid-flight when the page is
// actually unloading and sendBeacon is built to survive that.
export function flushViaBeacon(getCharacterData, { sendBeaconImpl = (url, blob) => navigator.sendBeacon(url, blob) } = {}) {
  if (!isLinked() || !pending) return;
  pending = false;
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
  sendBeaconImpl(EMAIL_PUSH_URL, buildEmailPushBeaconBlob(activeCode, getCharacterData()));
}

// Test-only reset - clears module-level timer/flags between tests.
// Does NOT clear activeCode - tests set/clear that explicitly via
// setActiveEmailCode/clearActiveEmailCode to keep intent visible at the
// call site.
export function __resetForTest() {
  if (timerId) clearTimeout(timerId);
  timerId = null;
  pending = false;
  lastPushAt = 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cloudAutoSave.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add js/systems/cloudAutoSave.js tests/cloudAutoSave.test.js
git commit -m "feat: add throttled auto-save coordinator for email-OTP cloud save"
```

---

### Task 9: Wire `cloudAutoSave` into `js/main.js`'s `persist()`/`flushPendingPersist()`

**Files:**
- Modify: `js/main.js`

**Interfaces:**
- Consumes: `notifyLocalSave`, `flushViaBeacon` (Task 8). Reads the existing module-level `state`/`activeSlotId` (already in scope at `persist()`'s call site, per `js/main.js:169-170`).

This task has no isolated unit test of its own — `persist()`/`flushPendingPersist()` aren't unit-tested today (they're thin glue over already-tested pieces: `saveState`, `touchSlot`, and now `notifyLocalSave`/`flushViaBeacon`, each covered in their own test files). Verification is the full `npm run test` run in Step 3, plus the manual smoke-test in Task 10 once the UI can actually create a link to exercise this against.

- [ ] **Step 1: Add the import**

In `js/main.js`, add this line near the other `./systems/*` imports (e.g. directly after the `saveSlots.js` import at line 76):

```js
import { notifyLocalSave, flushViaBeacon } from './systems/cloudAutoSave.js';
```

- [ ] **Step 2: Wire `persist()` and `flushPendingPersist()`**

Find `persist()` (around `js/main.js:324`):

```js
function persist() {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  persistPending = false;
  saveState(state, activeSlotId);
  touchSlot(activeSlotId, { level: state.player.level, ngPlusCycle: state.ngPlusCycle });
}
```

Change it to:

```js
function persist() {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  persistPending = false;
  saveState(state, activeSlotId);
  touchSlot(activeSlotId, { level: state.player.level, ngPlusCycle: state.ngPlusCycle });
  notifyLocalSave(() => state);
}
```

Find `flushPendingPersist()` (a few lines below):

```js
function flushPendingPersist() {
  if (persistPending) persist();
}
```

Change it to:

```js
function flushPendingPersist() {
  if (persistPending) persist();
  flushViaBeacon(() => state);
}
```

(`flushViaBeacon` is called unconditionally, not gated on `persistPending` — a cloud push can be pending from an earlier `persist()` call even when there's no *local* write currently pending, and `flushViaBeacon` itself is already a no-op when nothing is linked or nothing is pending.)

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: PASS (no existing test touches `persist()`/`flushPendingPersist()` directly, so this should be a clean pass with no regressions)

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat: wire email-OTP cloud-save auto-push into persist()/flushPendingPersist()"
```

---

### Task 10: Settings UI — "Email me a code" block

**Files:**
- Modify: `js/screens/settingsScreen.js`

**Interfaces:**
- Consumes: `sendEmailCode`, `redeemEmailCode`, `isValidEmailCode` (Task 7); `setActiveEmailCode`, `isLinked`, `getActiveEmailCode` (Task 8); already-existing `callbacks.onCloudSaveImported` (`js/main.js`).

No isolated unit test — this file has no existing test coverage of its own DOM-rendering logic (the pattern established by the existing code-transfer block, `handleStartTransfer`/`handleLoadFromCode`, which are also untested directly). Verification is the manual smoke-test in Step 5.

- [ ] **Step 1: Add the new imports**

At the top of `js/screens/settingsScreen.js`, extend the existing `cloudSave.js` import:

```js
import {
  CODE_TRANSFER_TTL_SECONDS,
  isValidSaveCode,
  startCodeTransfer,
  loadByCode,
  isValidEmailCode,
  sendEmailCode,
  redeemEmailCode,
} from '../systems/cloudSave.js';
import { setActiveEmailCode, isLinked as isEmailLinked, getActiveEmailCode } from '../systems/cloudAutoSave.js';
```

- [ ] **Step 2: Add the handler functions**

Add these near `handleLoadFromCode` (after it, before `function render()`):

```js
async function handleSendEmailCode() {
  const input = document.getElementById('cloud-email-input');
  const email = input.value.trim();
  flashStatus('cloud-email-status', 'Sending...');
  try {
    const { ok, code } = await sendEmailCode(email, state);
    if (!ok) {
      flashStatus('cloud-email-status', 'Failed to send - check the address and try again.');
      return;
    }
    setActiveEmailCode(code);
    flashStatus('cloud-email-status', "Code sent - check your email. It'll stay live while you keep playing, up to 24 hours after you stop.");
    input.value = '';
    render(); // switches this block into its "linked" display
  } catch {
    flashStatus('cloud-email-status', 'Failed to send - check your connection.');
  }
}

// Shares callbacks.onCloudSaveImported (js/main.js) with the
// code-transfer load path (handleLoadFromCode above) and Character
// Select (js/screens/startScreen.js) - same overwrite-vs-new-slot
// decision either way.
async function handleRedeemEmailCode() {
  const input = document.getElementById('cloud-email-redeem-input');
  const code = input.value.trim().toLowerCase();
  if (!isValidEmailCode(code)) {
    flashStatus('cloud-email-status', 'Enter the 8-character code from your email.');
    return;
  }
  flashStatus('cloud-email-status', 'Loading...');
  try {
    const data = await redeemEmailCode(code);
    if (data === null) {
      flashStatus('cloud-email-status', 'No live save for that code - it may have expired or already been used.');
      return;
    }
    const result = callbacks.onCloudSaveImported(data);
    flashStatus('cloud-email-status', result.imported
      ? (result.mode === 'overwrite' ? `Updated "${result.name}"!` : `Imported as "${result.name}"! Find it on the Character Select screen.`)
      : 'Import cancelled.');
    input.value = '';
  } catch {
    flashStatus('cloud-email-status', 'Load failed - check your connection.');
  }
}
```

- [ ] **Step 3: Add the UI block**

In `render()`, inside the existing `cloudSaveBeta`-gated section, immediately after the existing code-transfer block's closing `` ` : ''} `` (the block containing `btn-cloud-code-load`), add:

```js
${state.settings.featureFlags?.cloudSaveBeta ? `
  <h3>📧 Email me a code</h3>
  <p class="settings-hint">
    We only use your email to send this one code - it's never stored or
    logged anywhere on our end. The code stays live while you keep
    playing this character, up to 24 hours after you stop.
  </p>
  ${isEmailLinked() ? `
    <div class="settings-row">
      <span>Code active: this character keeps syncing while you play.</span>
    </div>
  ` : `
    <div class="settings-row">
      <input type="email" id="cloud-email-input" placeholder="you@example.com" />
      <button id="btn-cloud-send-email">Send me a code</button>
    </div>
  `}
  <div class="settings-row">
    <input type="text" id="cloud-email-redeem-input" maxlength="8" placeholder="code from your email" />
    <button id="btn-cloud-email-redeem">Load</button>
  </div>
  <div class="settings-row">
    <span id="cloud-email-status" hidden></span>
  </div>
` : ''}
```

- [ ] **Step 4: Wire the new buttons**

In the same `if (state.settings.featureFlags?.cloudSaveBeta) { ... }` block that already wires `btn-cloud-start-transfer`/`btn-cloud-code-load`, add:

```js
if (!isEmailLinked()) {
  document.getElementById('btn-cloud-send-email').onclick = () => handleSendEmailCode();
}
document.getElementById('btn-cloud-email-redeem').onclick = () => handleRedeemEmailCode();
```

- [ ] **Step 5: Manual smoke test**

This feature can't be exercised fully end-to-end without the Resend API key (Task 4's human prerequisite), but the UI and client-side wiring can be checked without it:

1. `npx serve .` (or however this repo's dev server is normally started) and open the game in a browser.
2. Start a character, open Settings, enable the `cloudSaveBeta` feature flag.
3. Confirm the new "📧 Email me a code" block renders below the existing code-transfer block, with the privacy hint text visible.
4. Type a plainly-invalid code (e.g. `xyz`) into the redeem field and click Load — confirm it shows "Enter the 8-character code..." without making a network request (check the Network tab).
5. Click "Send me a code" with the email field empty or an obviously malformed address — confirm the request goes out (it will fail server-side with a 500 until `RESEND_API_KEY` is set, or 400 if the address shape is rejected client-request-side by the server) and the UI shows a failure status rather than crashing.
6. Confirm the redeem field's malformed-code rejection also matches the existing code-transfer field's look and feel (same `settings-hint`/`settings-row` styling).

Full send→email→redeem→import verification requires Task 4's secrets to be set (Timothy's own step) — note in the handoff to Timothy that this remains to be checked once those are in place, the same way 0.27.0's preview-branch deploy check was done before that feature shipped to `main`.

- [ ] **Step 6: Commit**

```bash
git add js/screens/settingsScreen.js
git commit -m "feat: add Email me a code UI to Cloud Save settings"
```

---

### Task 11: Changelog entries, version bump, full test run

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `js/data/playerChangelog.js`

**Interfaces:** None — documentation/versioning only, per this repo's `CLAUDE.md` versioning checklist.

- [ ] **Step 1: Move `Unreleased` into a new dated MINOR version section in `CHANGELOG.md`**

This is a completed feature/build (a new cross-device save system), so it's a MINOR bump per `CHANGELOG.md`'s own header rules: `0.37.3` → `0.38.0`. Find the top of `CHANGELOG.md`:

```markdown
## [Unreleased]

## [0.37.3] - 2026-09-14
```

Replace with (using today's actual date at the time this task is executed — confirm via `date +%F` rather than assuming, since this plan may run on a later date than it was written):

```markdown
## [Unreleased]

## [0.38.0] - <TODAYS-DATE>

### Added
- **Email one-time-code cross-device save.** A second, standing
  alternative to the existing 60-second code-transfer flow: Settings →
  Cloud Save (beta) → "Email me a code" sends an 8-character code to
  any email address, valid for up to 24 hours and kept alive by a
  rolling TTL while the source character keeps playing (auto-pushed at
  most once every 2 minutes, with a guaranteed final push via
  `navigator.sendBeacon` on tab close). Entering the code on another
  device imports or overwrites the character the same way the existing
  code-transfer load path already does (`findSlotByCharacterId`/
  `importSlot`, `js/systems/saveSlots.js`). Backed by three new
  Cloudflare Pages Functions (`functions/api/save/email/{send,push,
  redeem}.js`) and Resend for the actual email send; the email address
  itself is never written to KV or logged anywhere, only used
  transiently to trigger the send (see the design doc's Privacy
  section for the precise claim). `functions/_shared/rateLimit.js`
  gained an optional `keyPrefix`/`identifier` so each of the three new
  routes gets its own isolated abuse-throttling counter. See
  `docs/superpowers/specs/2026-09-14-email-otp-cloud-save-design.md`.
  A same-day Google Sign-In design for the same goal was scaffolded
  only as a spec, then shelved before any code was written, in favor
  of this approach - see that spec's own "shelved" note.

## [0.37.3] - 2026-09-14
```

- [ ] **Step 2: Add the matching player-facing entry to `js/data/playerChangelog.js`**

At the top of the `PLAYER_CHANGELOG` array (before the existing `0.37.3` entry), add:

```js
  {
    version: '0.38.0',
    date: '<TODAYS-DATE>',
    highlights: [
      'New: a second way to move your character to another computer - Settings > Cloud Save > "Email me a code" sends you an 8-character code by email, good for up to 24 hours (it stays alive as long as you keep playing). We never store or log your email - it\'s only used to send that one code.',
    ],
  },
```

- [ ] **Step 3: Run the full test suite, including the version-sync check**

Run: `npm run test`
Expected: PASS, including `tests/versionSync.test.js` (which fails the whole suite if `CHANGELOG.md`'s newest version and `PLAYER_CHANGELOG[0].version` don't match — they now both read `0.38.0`).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md js/data/playerChangelog.js
git commit -m "chore: bump to 0.38.0 for email-OTP cloud save"
```

**Do not push this commit yet** — per this repo's `CLAUDE.md`, a push to `main` deploys live immediately, and this feature is inert-but-safe (gated behind `cloudSaveBeta`, defaulting off) until Timothy has completed the human prerequisite from Task 4 (`wrangler pages secret put RESEND_API_KEY` and `EMAIL_RATE_LIMIT_SECRET`) and ideally done a manual send→email→redeem→import check end-to-end, the same way 0.27.0 was checked via a preview-branch deploy before merging to `main`.
