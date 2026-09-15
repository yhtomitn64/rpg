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
