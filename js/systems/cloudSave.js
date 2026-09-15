// Cross-device save sync: move a save from one computer to another without
// copy/pasting JSON by hand, via a short-lived transfer code. Lands in
// Cloudflare Workers KV (see functions/api/save/code/) - a KV namespace
// must be created and bound (wrangler.toml) before this works live; see
// docs/superpowers/BACKLOG.md's Cross-device save sync section for the
// setup checklist. Gated behind the cloudSaveBeta settings flag until then.
//
// A Google-account-based option was scaffolded (Sign in with Google,
// verified server-side) and then deliberately pulled 2026-09-09 before
// shipping - Timothy: "I think we can remove the google thing for now as
// well... don't want to load google stuff if we don't need to at this
// point." Nothing here loads any Google script or calls any Google
// endpoint. See the backlog entry for the removed design if it's ever
// wanted back.

// Deliberately short and low-security - Timothy: "I don't think security on
// this particular thing needs to be real tight if using the code method."
// Plain lowercase letters + digits (36 options), no exclusion of
// visually-similar characters (0/o, 1/l) - matches what was asked for
// exactly rather than second-guessing it. The real protection against
// brute-forcing this small a keyspace isn't the alphabet - it's that a code
// only exists for CODE_TRANSFER_TTL_SECONDS after startCodeTransfer (raised
// 2026-09-09: "only have a really short window to transfer over... That in
// addition to the timeout should make it pretty solid"), enforced
// server-side via KV's own expirationTtl (functions/api/save/code/[code].js)
// - this constant is display-only (the countdown UI), not itself enforcing
// anything.
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const SAVE_CODE_LENGTH = 4;
export const CODE_TRANSFER_TTL_SECONDS = 60;

export function generateSaveCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < SAVE_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function isValidSaveCode(code) {
  return typeof code === 'string' && new RegExp(`^[a-z0-9]{${SAVE_CODE_LENGTH}}$`).test(code);
}

const codeSaveUrl = (code) => `/api/save/code/${code}`;

async function saveByCode(code, data, { fetchImpl = globalThis.fetch } = {}) {
  if (!isValidSaveCode(code)) throw new Error(`Invalid save code: ${code}`);
  const response = await fetchImpl(codeSaveUrl(code), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  return response.ok;
}

// Generates a fresh one-shot code, saves under it, and returns it for
// display with a countdown - this is the only way to write to the code
// path (no standing/reusable device code) so a save is never live for
// longer than the transfer window.
export async function startCodeTransfer(data, { fetchImpl = globalThis.fetch } = {}) {
  const code = generateSaveCode();
  const ok = await saveByCode(code, data, { fetchImpl });
  return { code, ok };
}

// Returns the saved data, or null if the code has nothing live under it
// right now (never used, a typo, or its transfer window already expired) -
// callers should treat null as "not found," not as an error.
export async function loadByCode(code, { fetchImpl = globalThis.fetch } = {}) {
  if (!isValidSaveCode(code)) throw new Error(`Invalid save code: ${code}`);
  const response = await fetchImpl(codeSaveUrl(code));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Cloud load failed: ${response.status}`);
  const body = await response.json();
  return body.data ?? null;
}

// Email one-time-code cross-device save - a standing alternative to the
// 60-second code-transfer flow above. See
// docs/superpowers/specs/2026-09-14-email-otp-cloud-save-design.md.
const EMAIL_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const EMAIL_CODE_LENGTH = 8;

export function isValidEmailCode(code) {
  return typeof code === 'string' && new RegExp(`^[${EMAIL_CODE_ALPHABET}]{${EMAIL_CODE_LENGTH}}$`).test(code);
}

const EMAIL_PATTERN = /^[^\s,<>()[\]:;@"]+@[^\s,<>()[\]:;@"]+\.[^\s,<>()[\]:;@"]+$/;

// Mirrors functions/_shared/emailCode.js's server-side isValidEmailAddress
// exactly (same regex/length cap) - deliberately duplicated, same as
// isValidEmailCode above, since the client bundle and the Cloudflare
// Functions runtime are separate deployable contexts. Used client-side
// only as a courtesy (avoid burning the send endpoint's tight per-hour
// rate limit on an obvious typo) - the server's own copy is the real
// enforcement boundary.
export function isValidEmailAddress(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_PATTERN.test(email);
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
