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
// Latest getCharacterData/fetchImpl seen across a batch of notifyLocalSave
// calls within one throttle window - the scheduled push must read these
// (not whatever was passed to the call that happened to create the
// timer), or a burst would push the FIRST call's stale data instead of
// the latest.
let latestGetCharacterData = null;
let latestFetchImpl;

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
  latestGetCharacterData = getCharacterData;
  latestFetchImpl = fetchImpl;
  if (timerId) return;
  const delay = Math.max(0, CLOUD_AUTO_SAVE_THROTTLE_MS - (nowMs - lastPushAt));
  timerId = setTimeout(() => {
    timerId = null;
    if (pending) doPush(latestGetCharacterData, { fetchImpl: latestFetchImpl });
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
  latestGetCharacterData = null;
  latestFetchImpl = undefined;
}
