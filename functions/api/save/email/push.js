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

  // Generous relative to the 2-minute client throttle (a couple of
  // devices pushing, plus headroom) - isolated from send/redeem's own
  // counters via keyPrefix.
  if (!(await checkRateLimit(env, request, { max: 10, keyPrefix: 'email-push-ip' }))) {
    return rateLimitedResponse();
  }

  const existing = await env.SAVES.get(`emailcode:${code}`);
  if (existing === null) return jsonResponse({ error: 'not found' }, 404);

  await env.SAVES.put(
    `emailcode:${code}`,
    JSON.stringify({ data, savedAt: new Date().toISOString() }),
    { expirationTtl: EMAIL_TTL_SECONDS },
  );
  return jsonResponse({ ok: true });
}
