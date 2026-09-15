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
