# Email one-time-code cross-device save — design

Raised 2026-09-14, superseding the same day's
[Google cross-device cloud save design](2026-09-14-google-cloud-save-design.md)
after discussing that design surfaced a better-fitting alternative.
Adds a second, standing alternative to the existing 60-second
code-transfer flow (shipped 0.27.0/0.27.2, `js/systems/cloudSave.js`),
for moving a character between computers without being next to the
other one — this time via a code emailed to yourself, valid for a full
day rather than 60 seconds, and kept fresh while you keep playing.

## Goals / constraints (from Timothy, verbatim intent preserved)

- No PII stored or logged, same bar as the shelved Google design: "can
  we be sure their email is not logged or used for anything?"
- A code should "live until they use it" for a meaningful window —
  "be cool if... the game could persist their save state until they
  use the code. So maybe they email themselves and then play for
  another hour" — chosen window: **24 hours**, rolling (see below).
- Zero third-party script in the browser — this design achieves that
  automatically, since the entire flow is server-side; there's nothing
  to lazy-load.

## Why this instead of Google Sign-In

The Google design (previous doc) needed: an OAuth Console prerequisite
only Timothy could complete, a lazily-loaded Google Identity Services
script, `aud`-claim verification to avoid accepting tokens meant for
other apps, and accepted a token-expiry edge case. This design needs
none of that — the browser never loads anyone else's script, and
"we don't store your email" becomes a claim about our own code that's
simple to state precisely and true by construction (see Privacy
section). The trade-off: it needs a third-party transactional-email
API (Cloudflare has no outbound-send product of its own — Email
Routing is inbound-only), which is a new secret to provision, and a
new abuse surface (anyone can be emailed unwanted mail unless the
send path is locked down — see Abuse surface below).

## Provider

**Resend** (`resend.com`) — simple HTTP POST API (`fetch` from a
Worker, no SMTP client needed), free tier (100 emails/day) far beyond
what a personal project needs. Any equivalent (Postmark, Mailgun)
would work identically; Resend is the concrete choice for this plan.

## Endpoints — three, deliberately separated

One combined endpoint would mean the same rate-limit counter (and the
same code path) governs both "send an email" and "just update KV" —
two very different abuse profiles (spam-bombing a stranger vs.
guessing a code). Kept separate so each gets its own cap:

- **`POST /api/save/email/send`** — `{ email, characterId, data }`.
  The *only* route that can trigger an email. Generates a fresh code,
  writes `emailcode:<code>` to KV (24h `expirationTtl`), emails the
  code to `email` via Resend, and immediately discards the `email`
  variable — never written to KV, never logged (see Privacy).
- **`POST /api/save/email/push`** — `{ code, characterId, data }`.
  Called by the auto-save throttle (and available for a manual
  "push now" if ever wanted) once a code already exists. Overwrites
  `emailcode:<code>`'s value and **resets its TTL to 24h** — this is
  what makes the code "stay alive while you keep playing" (see Rolling
  TTL below). Never sends an email. 404s if the code doesn't exist
  (expired, or already redeemed) — the client treats a 404 here as
  "this link is dead" and stops auto-pushing to it (see Client flow).
- **`POST /api/save/email/redeem`** — `{ code }`. Returns the stored
  `{ characterId, data }` and **deletes the key** — one-shot, like the
  existing code-transfer flow. A second redemption attempt (this
  device or the original one) gets 404, matching `push`'s dead-link
  behavior.

### Code format

8 characters from a 32-symbol alphabet excluding visually-similar
characters (`0`/`O`, `1`/`l`/`I` removed) — unlike the existing 4-char
transfer code, this one lives up to 24 hours and is worth a bigger
keyspace, and avoiding ambiguous characters matters more here since a
user might be reading it off a phone screen and typing it into a
different device's keyboard rather than copy-pasting. `32^8 ≈
1.1 × 10^12` combinations — the real defense is still the per-IP
rate limit on `redeem` (see below), not the alphabet size alone, same
philosophy as the existing 4-char code's own comment in
`js/systems/cloudSave.js`; this alphabet is just sized to match a
much longer exposure window. Displayed grouped as `xxxx-xxxx` for
readability.

### Rolling TTL — explicit decision

Every successful `push` resets the KV key's `expirationTtl` to a full
24 hours from that moment, not from when the code was first issued.
This is deliberate, not an oversight: it's what makes "email yourself
a code, keep playing for another hour" work as asked — the code stays
live as long as the source device keeps playing (and therefore keeps
pushing), only actually starting its 24-hour countdown once that
device stops. Accepted consequence: a device that generates a code
and is then left open and continuously played (not closed, not
navigated away) could keep that one code alive indefinitely. This is
low-stakes here — it discloses/accepts a write to exactly one
character's own save data, on that character's own linked code, not
account-wide or destructive access — and matches this project's
existing risk tolerance for the code-transfer feature (see that
feature's own "not a hard security boundary... sized to this feature's
low-stakes threat model" framing). Not fixed here.

## Client flow

Settings → Cloud Save (beta), same `cloudSaveBeta` flag, gets a third
block ("Email me a code") alongside the existing 60-second
code-transfer UI (both stay, unaffected, offered side by side):

- An email `<input>` and a "Send me a code" button. Clicking it calls
  `send`. On success, shows a status line: "Code sent — check your
  email. It'll stay live while you keep playing, up to 24 hours after
  you stop." No display of the email address anywhere after this
  point — the input can be cleared immediately.
- The client holds the returned code **in memory only** for the rest
  of the session (module-level variable, same pattern as the shelved
  Google design's in-memory-only token) — reloading the page forgets
  it; the character's own local save is completely unaffected either
  way, this only concerns the cloud copy.
- **Auto-push while linked:** reuses the exact throttle/coalescing
  design from the shelved Google spec, generalized to not care which
  link mechanism is active:
  - `persist()` (`js/main.js`) marks a pending cloud push on every
    meaningful game event (already true today for local saves).
  - A coalescing timer fires the actual `push` call at most **once
    per 2 minutes** of active play, batching whatever happened since
    the last push (write-budget math below).
  - The existing `pagehide`/`visibilitychange`-hidden flush
    (`flushPendingPersist`, `js/main.js`) fires one immediately via
    `navigator.sendBeacon` (survives the tab actually closing, unlike
    `fetch`), bypassing the 2-minute floor.
  - If a `push` ever comes back 404, the client clears its in-memory
    code (the link is dead — expired or already redeemed) and stops
    trying. No error dialog; this is expected, ordinary end-of-life
    for a code.
- **Redeeming, on the other device:** a "Got a code? Enter it here"
  field + "Load" button in the same block. Calls `redeem`; on success,
  the returned character is matched against `findSlotByCharacterId`
  (`js/systems/saveSlots.js`) — a local match offers the existing
  overwrite-in-place confirmation, no match imports as a new slot via
  `importSlot`. Both already-built, reused unchanged (same as the
  code-transfer flow already does).

## Abuse surface — this design's real new risk

Unlike the shelved Google design (where forging authentication is the
hard part), here the cheap attack is: use `send` to spam an arbitrary
victim's inbox with unwanted mail, at no cost to the attacker. Defenses,
all required, not optional hardening:

- **Strict email shape validation before ever calling Resend.** A
  single RFC-5322-ish address, no commas, no `<>`-wrapped display
  names with embedded extra addresses, reject anything that isn't
  exactly one address shape. No user-supplied subject or body ever
  reaches the email template — the code is the only variable in a
  fixed template string.
- **Per-IP throttle on `send` specifically** — tight, e.g. 3
  requests/hour, via the shared limiter
  (`functions/_shared/rateLimit.js`) with its own `keyPrefix` so it
  doesn't share a counter with `push` or `redeem` traffic.
- **Per-recipient throttle, independent of IP** — an attacker rotating
  IPs must not be able to bypass the per-victim cap. Key the counter
  on `HMAC-SHA256(email, SERVER_SECRET)`, truncated, **not** a bare
  hash — a bare hash of an email address is trivially reversible by
  dictionary (the space of real addresses is small enough to
  precompute), which would quietly break the "we never store your
  email" claim under any real scrutiny. `SERVER_SECRET` is a Worker
  secret (see Human prerequisite below), and the resulting key is used
  only as an ephemeral KV rate-limit counter (short TTL, same pattern
  as `functions/_shared/rateLimit.js`) — never logged, never mapped
  back to an address by anyone including us.
- **`push` and `redeem` each get their own tight per-IP cap too**,
  separate `keyPrefix`s from `send` and from each other — `push`
  guards against wasting write budget, `redeem` guards against code
  guessing over the 24-hour window (same shape as the shelved design's
  reasoning for the Google endpoints, ported over).

### `checkRateLimit` needs one small addition

`functions/_shared/rateLimit.js`'s `checkRateLimit(env, request, {
max, windowSeconds })` bumps a counter keyed on `ratelimit:<ip>` —
shared across every route today, which was fine when every route used
the same default cap. Add an optional `keyPrefix` parameter (default
`'ratelimit'`, preserving today's exact key and behavior for the
existing code-transfer route, which doesn't pass it) so `send`,
`push`, and `redeem` can each get an isolated counter rather than
three different caps racing against one shared bucket.

## Privacy — the exact, auditable claim

"We don't store or log your email" is stated precisely as: the `email`
field is read from the `send` request body, passed to Resend's send
call, and the variable goes out of scope when the function returns —
it is never written to KV, D1, or any log statement anywhere in this
codebase, and the only derived value that persists even momentarily is
an HMAC digest used solely as a rate-limit counter key with a short
TTL, which cannot be reversed back to the address. This is not a claim
that *no one* ever sees the address — Resend necessarily sees it to
deliver the message, true of any email sent by any service to
anyone — it's a claim about what *this* codebase does with it, and
it's true by construction and verifiable by reading
`functions/api/save/email/send.js`.

## Data model

- `emailcode:<code>` → `{ characterId, data, savedAt }`. Written by
  `send` (24h TTL) and overwritten by every `push` (TTL reset to 24h
  each time — see Rolling TTL). Deleted by `redeem`.
- Per-recipient throttle counters: `email-send-limit:<hmac>`, short TTL
  (matches the existing rate-limiter's window, e.g. 1 hour), never
  holds the address itself.

## Write budget

Corrected using the same finding from the shelved design: the shared
rate limiter itself costs a KV write (`get` + `put` on its counter) on
every request, and Cloudflare's free-tier caps (confirmed via their
docs) are **account-wide**, not per-namespace: 1,000 writes/day,
100,000 reads/day, shared with the already-live code-transfer feature.

- **`push`** (the recurring one): 1 write (rate-limit counter) + 1
  write (the data put, which also resets the TTL) = **2 writes per
  push**. At the 2-minute throttle, one continuously-played hour costs
  ~60 writes (30 pushes × 2) — same shape and same conclusion as the
  shelved Google design: a full day of casual solo/small-group play
  stays comfortably under the 1,000/day ceiling.
- **`send`** (rare — once per transfer attempt, not on a cadence): 1
  write (per-IP counter) + 1 write (per-recipient counter) + 1 write
  (initial `emailcode:` put) = 3 writes per request. Negligible
  against the daily budget at realistic usage.
- **`redeem`** (rare): 1 write (per-IP counter) + 1 delete. Deletes
  are their own free-tier category (1,000/day), not counted against
  the write cap.

As before: this is fail-closed on quota exhaustion (KV `put` starts
throwing, Pages Functions returns 500, every `/api/save/*` route
including the existing code-transfer flow breaks loudly until the
daily reset at UTC midnight) — accepted, not specially handled, same
reasoning as the shelved design.

The 2-minute throttle is per-device, in-memory — the real ceiling in
a multi-device session is N devices × ~1 push/2min each, not a single
global rate.

Monitoring: Cloudflare Dashboard → Workers & Pages → KV → `SAVES` →
Metrics (per-namespace read/write/delete counts). No custom usage
tracking is being built.

## Human prerequisite (blocks implementation)

A Resend account and API key, provisioned as a Cloudflare Pages
**secret** (`wrangler pages secret put RESEND_API_KEY`) — **not**
`wrangler.toml`'s `[vars]`, which is plaintext and committed to the
repo. This is Timothy's own step, same shape as `wrangler login` for
0.27.0 — an API key is a real credential this session shouldn't be
holding or typing into a committed file. A second secret,
`EMAIL_RATE_LIMIT_SECRET` (any random string, used only as the HMAC
key for the per-recipient throttle), needs the same treatment — this
one can be generated by this session (it's not tied to any external
account) but must still be set via `wrangler pages secret put`, not
committed.

## Known limitations (accepted, not fixed here)

- **Rolling TTL keeps a continuously-played, never-redeemed code alive
  indefinitely** — see Rolling TTL above. Accepted.
- **No delivery confirmation.** If Resend fails silently or the email
  lands in spam, the user's only signal is "I didn't get anything" —
  no read-receipt or delivery-webhook handling is being built.
- **No per-Google-account equivalent identity** — this mechanism has
  no persistent "account," just ephemeral codes. Someone who loses
  their only code and never generates a new one before the source
  device stops playing has no recovery path other than starting a new
  transfer from the source device. Acceptable for a beta feature.

## Out of scope for this design

- The existing 60-second code-transfer flow — unaffected, offered
  alongside this one, unchanged.
- Google Sign-In — shelved (see superseded doc); could be added later
  as an independent third option without touching anything here, since
  it would plug into the same generalized auto-push throttle module
  this design introduces.
- Delivery-confirmation / retry-on-bounce handling for the email send.
- A Terraform/infrastructure-as-code pass over the Cloudflare account
  (KV namespace creation, DNS/custom-domain attachment, the Pages
  project itself) — raised in the same conversation as a real, separate
  need, tracked in `BACKLOG.md` rather than folded into this feature.
