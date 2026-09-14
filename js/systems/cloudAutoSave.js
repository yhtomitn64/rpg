// Throttled, best-effort auto-push coordinator for the email-OTP cloud
// save feature. See docs/superpowers/specs/2026-09-14-email-otp-cloud-
// save-design.md's Client flow section.
//
// Deliberately auth-mechanism-agnostic in shape (setActiveEmailCode/
// isLinked rather than baking in "email" everywhere) so a future second
// link mechanism (e.g. the shelved Google Sign-In design) could reuse
// this same throttle/beacon machinery rather than duplicating it.
//
// Character-scoped as of the final whole-branch review (2026-09-14): a
// link is only valid for the character it was created for. Switching
// characters (Character Select -> a different slot) within the
// 2-minute throttle window would otherwise silently push the NEW
// character's data to the OLD character's emailed code, since `state`
// in js/main.js is a reassignable module binding, not a snapshot - a
// scheduled push that reads it live via a closure has no way to know
// the character changed underneath it. The guard lives in doPush/
// flushViaBeacon (the actual send points), not just in notifyLocalSave,
// because a push can already be scheduled from BEFORE a character
// switch and only discover the mismatch when it actually fires.
import { pushEmailCode, buildEmailPushBeaconBlob, EMAIL_PUSH_URL } from './cloudSave.js';

export const CLOUD_AUTO_SAVE_THROTTLE_MS = 120_000; // 2 minutes - see design doc's Write budget section

let activeCode = null;
let activeCharacterId = null;
let pending = false;
let lastPushAt = 0;
let timerId = null;
let latestGetCharacterData = null;
let latestFetchImpl;

export function setActiveEmailCode(code, characterId) {
  activeCode = code;
  activeCharacterId = characterId;
}

export function clearActiveEmailCode() {
  activeCode = null;
  activeCharacterId = null;
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
  const character = getCharacterData();
  // The link may have been created for a different character than the
  // one currently loaded (a character switch happened after this push
  // was scheduled) - abort rather than overwrite the linked character's
  // cloud copy with the wrong hero's data.
  if (character?.characterId !== activeCharacterId) {
    clearActiveEmailCode();
    return;
  }
  // Best-effort: swallow a network-level rejection (e.g. offline) so it
  // never surfaces as an unhandled promise rejection - the next
  // throttled cycle, or a manual re-link, covers a transient failure.
  const result = await pushEmailCode(activeCode, character, { fetchImpl }).catch(() => ({ ok: false, deadCode: false }));
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
  const character = getCharacterData();
  if (character?.characterId !== activeCharacterId) {
    clearActiveEmailCode();
    return;
  }
  pending = false;
  lastPushAt = Date.now();
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
  sendBeaconImpl(EMAIL_PUSH_URL, buildEmailPushBeaconBlob(activeCode, character));
}

// Test-only reset - clears module-level timer/flags between tests.
// Does NOT clear activeCode/activeCharacterId - tests set/clear those
// explicitly via setActiveEmailCode/clearActiveEmailCode to keep intent
// visible at the call site.
export function __resetForTest() {
  if (timerId) clearTimeout(timerId);
  timerId = null;
  pending = false;
  lastPushAt = 0;
}
