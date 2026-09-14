# Google cross-device cloud save — design

Raised 2026-09-14, picking up the "renewed interest" thread from the
[Cross-device save sync](../BACKLOG.md#google-cross-device-save-2026-09-14)
backlog entry (2026-09-13). Adds an optional, sign-in-based alternative
to the existing 60-second code-transfer flow (shipped 0.27.0/0.27.2,
`js/systems/cloudSave.js`), for moving a character between computers
without being next to the other one or knowing a code.

## Goals / constraints (from Timothy, verbatim intent preserved)

- Opt-in only. Nothing about Google loads unless the user explicitly
  asks for it — "I don't even want to load it unless someone wants
  it... then Google can't track you all around the site."
- No PII, ever. Not email, not name, not picture. "I just need to use
  so I can log some random id so I know it's them for their save
  purposes." Only Google's `sub` (an opaque per-account identifier) is
  ever stored or logged.
- A prior scaffold of this exact feature was built and deliberately
  deleted the same session it was built (2026-09-09) before shipping —
  nothing from that scaffold survives in code; this design starts
  clean but keeps its privacy posture.

## Client flow

### Sign-in (lazy load)

Settings → Cloud Save (beta), gated behind the existing
`cloudSaveBeta` feature flag, gets a new "Google Account" block
alongside (not replacing) the existing code-transfer UI.

- A "Sign in with Google" button is the *only* thing that injects the
  Google Identity Services `<script>` tag — never on page load, never
  because the `cloudSaveBeta` flag is on. Clicking it loads the script,
  then renders the real Google sign-in button/prompt.
- On successful sign-in, the client holds the resulting ID token **in
  memory only** (a module-level variable, not `localStorage` /
  `sessionStorage`). Reloading the page forgets it — the user signs in
  again. This keeps "script only loads on an explicit click" true on
  every page load, not just the first.
- No display of the signed-in account's name/email/picture anywhere in
  the UI, even though the ID token payload likely contains them — the
  client never reads those fields, only ever forwards the whole token
  to the backend for verification. UI shows a generic "Signed in ✓."

### Manual actions

Once signed in, two buttons appear:
- **"Save to Google"** — pushes the current character now.
- **"Load from Google"** — fetches the list of characters stored under
  this Google account and, for each one:
  - if `findSlotByCharacterId` (`js/systems/saveSlots.js`) finds a
    local match, offer the existing overwrite-in-place confirmation
    (same UX as the code-transfer load path added in 0.27.2);
  - otherwise, `importSlot` it as a new Character Select entry (same
    as code-transfer load today).

### Auto-save after sign-in

Once signed in, saving to Google also happens automatically in the
background, throttled to avoid spamming the API (see Write budget
below):

- `persist()` (`js/main.js`) already runs on every meaningful game
  event (debounced to one write per movement-pause for the
  high-frequency map-movement case, direct for everything else — item
  pickup, purchase, map transition, battle end, etc.). When signed in,
  `persist()` additionally marks a "cloud push pending" flag.
- A coalescing timer (same idiom as the existing `schedulePersist`)
  ensures the actual network push happens **at most once per 2
  minutes** of active play, batching up whatever happened since the
  last push. No per-event tagging needed — every meaningful event
  already flows through `persist()`.
- The existing `pagehide` / `visibilitychange`-hidden flush
  (`flushPendingPersist`, `js/main.js`) is extended: if a cloud push is
  pending, fire it immediately via `navigator.sendBeacon`, bypassing
  the 2-minute floor. `sendBeacon` (unlike `fetch`) is designed to
  survive the page actually going away, so a "close the tab right
  after a big moment" doesn't lose that save. The body is a JSON
  `Blob` (`{ idToken, data }`) with `type: 'application/json'` — POST
  only, no custom headers, matching `sendBeacon`'s constraints.
- This auto-save is **best-effort**. It never blocks gameplay, never
  shows an error dialog on failure, and there is no retry queue — a
  failed push is silently dropped; the player can always hit "Save to
  Google" manually, and the next throttled cycle will try again
  regardless.

## Data model

**One KV key per character**, not one blob per account:
`google:<sub>:<characterId>`.

A single JSON blob keyed by `sub` (holding a list of characters) was
the first idea and is wrong: upserting one character into a list
requires a read-modify-write, and KV has no atomic read-modify-write —
its reads can be up to ~60 seconds stale. Two devices pushing near the
same time (exactly this feature's use case, made more likely by both
tabs closing around the same time and firing their `sendBeacon` flush
together) could each read a stale list and clobber the other's
character on write.

Per-character keys make concurrent pushes from different devices touch
different keys — no collision possible, no read-modify-write anywhere.

- **Save:** `PUT`-equivalent write to `google:<sub>:<characterId>`, the
  full character JSON as the value. No TTL (unlike the code-transfer
  path) — this is a standing save, not a one-shot transfer.
- **Load:** `env.SAVES.list({ prefix: `google:${sub}:` })` (keys only,
  cheap) then a `get` per key. Reads are 100k/day on the free tier —
  fine for a rare, explicit "Load from Google" click.

## Server endpoints

Two new Cloudflare Pages Functions, both POST (the ID token is a
credential and must never travel in a URL/query string, even for the
"load" direction, to keep it out of server access logs and the
`Referer` header):

- `functions/api/save/google/save.js` — body `{ idToken, characterId,
  data }`. Verifies the token, upserts `google:<sub>:<characterId>`.
- `functions/api/save/google/load.js` — body `{ idToken }`. Verifies
  the token, lists and returns all characters under
  `google:<sub>:*`.

### Token verification

- Verify via Google's `tokeninfo` endpoint (same approach the deleted
  scaffold used).
- **Must check the `aud` claim equals our own registered OAuth client
  ID.** A bare `tokeninfo` call validates that a token was issued *by
  Google*, not that it was issued *for this app* — without the `aud`
  check, a valid ID token from an unrelated Google-authenticated app
  would pass verification and let its holder write under that user's
  `sub` on our endpoint.
- Extract only the `sub` field from the verified response. Every other
  field (email, name, picture, etc.) is discarded immediately — never
  stored, never returned to the client, and **never logged**. The
  token itself and the full `tokeninfo` response body must never
  appear in any log line, since both carry PII this design explicitly
  rules out storing.

### Rate limiting / abuse

- Reuse the shared limiter (`functions/_shared/rateLimit.js`), but
  with a **tighter per-IP cap on these two routes specifically** —
  around 5 requests/minute, versus the existing 20/minute default used
  by the code-transfer routes. Legitimate traffic (sign-in + occasional
  manual save/load + the 2-minute auto-save cadence) never needs
  anywhere near 20/min; capping lower squeezes a runaway or malicious
  script far below the point where it could meaningfully dent the
  daily write quota, while leaving headroom for real bursts (sign-in
  followed by a couple of manual saves).
- This is meaningfully *harder* to abuse anonymously than the already-
  shipped code-transfer endpoint: that one needs no auth at all (just
  a 4-char code guess within its 60s window), whereas this one
  requires a real Google-issued, `aud`-checked token per request — a
  bot would need actual distinct Google accounts, not just a script
  hitting a URL.
- **Fail-closed on quota exhaustion, deliberately not handled
  specially.** If the account-wide 1,000-writes/day KV cap is ever
  hit, `env.SAVES.put` calls start failing, which propagates as an
  uncaught exception through `checkRateLimit` and whichever endpoint
  called it — Cloudflare Pages Functions returns a generic 500 for
  that. Every route under `/api/save/*` (code-transfer included, since
  it shares the same `SAVES` namespace and the same rate-limit
  counter) would 500 until the daily quota resets at UTC midnight.
  This is acceptable for a personal project: the feature breaks
  loudly, nothing silently over-permits.

### Write budget

Corrected from an earlier, wrong assumption that reads were "free"
against the write cap: `checkRateLimit` does a `get` **and** a `put`
(bumping its own counter) on *every* request, including loads — so
every save action costs 2 writes (1 rate-limit counter + 1 actual data
write), not 1. Cloudflare's free-tier limits (confirmed via their
docs) are **account-wide**, not per-namespace: 1,000 writes/day,
100,000 reads/day — shared with the already-live code-transfer
feature, since both use the same `SAVES` namespace.

At a 2-minute auto-save throttle: one continuously-played hour costs
~60 writes (30 pushes × 2). A full day of casual solo/small-group play
stays comfortably under the 1,000/day ceiling with room left for the
code-transfer flow and manual saves/loads. (At the original 60-second
throttle this doubles to ~120/hour, which could plausibly approach the
ceiling on a heavy play day — hence the 2-minute choice.)

The throttle is **per-device, in-memory** — the real ceiling in a
multi-device session is N devices × ~1 push/2min + one push per
tab-close each, not a single global 1-per-2min rate.

Monitoring: Cloudflare Dashboard → Workers & Pages → KV → `SAVES` →
Metrics already shows daily read/write/delete counts against the
free-tier caps. No custom usage tracking is being built — that would
itself burn reads/writes to maintain.

## Known limitations (accepted, not fixed here)

- **Token expiry mid-session.** Google ID tokens expire after ~1 hour.
  A session left open and signed-in for longer than that will have its
  final `sendBeacon` push fail silently (best-effort, no retry — see
  above). No silent token refresh is being built; re-signing in
  refreshes it.
- **Eventual consistency between devices.** A push from device A may
  not be visible to device B's "Load from Google" for up to ~60
  seconds (KV's own read consistency window). The existing
  code-transfer flow has the same property and has shipped fine; this
  is documented behavior, not a blocker.
- **No per-Google-account rate limit**, only per-IP. Fine at this
  project's scale; revisit only if that assumption stops holding.
- **No account-unlink / delete-my-data UI.** Out of scope for this
  pass.

## Human prerequisite (blocks implementation)

This needs a Google Cloud OAuth client ID, with `rpg.burghertime.com`
and the local dev origin registered as authorized JavaScript origins,
created in Google Cloud Console. This is an interactive step tied to
Timothy's own Google account — same shape as the `wrangler login` step
he ran himself for 0.27.0 — and must happen before the sign-in button
can work end-to-end.

## Out of scope for this design

- Any change to the existing code-transfer flow — it stays exactly as
  shipped, unaffected, offered as an alternative alongside this one.
- Token refresh / silent re-auth.
- Server-side per-account write throttling beyond the per-IP limiter.
