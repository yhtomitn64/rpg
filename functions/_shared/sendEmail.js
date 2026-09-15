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
