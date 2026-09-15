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
