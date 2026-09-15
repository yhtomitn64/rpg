import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setActiveEmailCode,
  clearActiveEmailCode,
  isLinked,
  getActiveEmailCode,
  notifyLocalSave,
  flushViaBeacon,
  CLOUD_AUTO_SAVE_THROTTLE_MS,
  __resetForTest,
} from '../js/systems/cloudAutoSave.js';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, options) => { calls.push({ url, options }); return handler(url, options); };
  fn.calls = calls;
  return fn;
}
const okResponse = { ok: true, status: 200, json: async () => ({ ok: true }) };

// Drains the real microtask queue (setTimeout is mocked per-test via
// t.mock.timers, but setImmediate is not - it only fires once every
// currently-queued microtask, including a chained fetch/await sequence
// kicked off by a mock timer tick, has finished). Safer than guessing how
// many `await Promise.resolve()` hops a given chain needs.
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test.beforeEach(() => {
  __resetForTest();
  clearActiveEmailCode();
});

test('isLinked/getActiveEmailCode reflect setActiveEmailCode/clearActiveEmailCode', () => {
  assert.equal(isLinked(), false);
  setActiveEmailCode('abcd2345', 'char-1');
  assert.equal(isLinked(), true);
  assert.equal(getActiveEmailCode(), 'abcd2345');
  clearActiveEmailCode();
  assert.equal(isLinked(), false);
  assert.equal(getActiveEmailCode(), null);
});

test('notifyLocalSave is a no-op when not linked', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchImpl = fakeFetch(() => okResponse);
  notifyLocalSave(() => ({ characterId: 'char-1', level: 1 }), { fetchImpl });
  t.mock.timers.tick(CLOUD_AUTO_SAVE_THROTTLE_MS);
  assert.equal(fetchImpl.calls.length, 0);
});

test('notifyLocalSave pushes once after the throttle window, batching multiple calls', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setActiveEmailCode('abcd2345', 'char-1');
  const fetchImpl = fakeFetch(() => okResponse);
  notifyLocalSave(() => ({ characterId: 'char-1', level: 1 }), { fetchImpl });
  notifyLocalSave(() => ({ characterId: 'char-1', level: 2 }), { fetchImpl }); // same window - should not schedule a second timer
  notifyLocalSave(() => ({ characterId: 'char-1', level: 3 }), { fetchImpl });
  assert.equal(fetchImpl.calls.length, 0); // nothing yet - still inside the throttle window
  t.mock.timers.tick(CLOUD_AUTO_SAVE_THROTTLE_MS);
  await flushMicrotasks(); // let the pending push's promise chain settle
  assert.equal(fetchImpl.calls.length, 1); // batched into a single push
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { code: 'abcd2345', data: { characterId: 'char-1', level: 3 } }); // latest data wins
});

test('notifyLocalSave clears the link on a dead-code (404) response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setActiveEmailCode('abcd2345', 'char-1');
  const fetchImpl = fakeFetch(() => ({ ok: false, status: 404, json: async () => ({ error: 'not found' }) }));
  notifyLocalSave(() => ({ characterId: 'char-1', level: 1 }), { fetchImpl });
  t.mock.timers.tick(CLOUD_AUTO_SAVE_THROTTLE_MS);
  await flushMicrotasks();
  assert.equal(isLinked(), false);
});

test('a scheduled push aborts and clears the link if the character changes before it fires', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setActiveEmailCode('abcd2345', 'char-1');
  const fetchImpl = fakeFetch(() => okResponse);
  let currentCharacterId = 'char-1';
  notifyLocalSave(() => ({ characterId: currentCharacterId, level: 1 }), { fetchImpl });
  // Simulate switching characters (Character Select -> Continue as a
  // different slot) happening after the push was scheduled but before
  // the throttle window elapses - the exact hazard this fix closes.
  currentCharacterId = 'char-2';
  t.mock.timers.tick(CLOUD_AUTO_SAVE_THROTTLE_MS);
  await flushMicrotasks();
  assert.equal(fetchImpl.calls.length, 0); // never pushed character 2's data under character 1's code
  assert.equal(isLinked(), false); // link was cleared rather than silently mismatched
});

test('flushViaBeacon is a no-op when not linked or nothing is pending', () => {
  const calls = [];
  const sendBeaconImpl = (url, blob) => { calls.push({ url, blob }); return true; };
  flushViaBeacon(() => ({ characterId: 'char-1', level: 1 }), { sendBeaconImpl });
  assert.equal(calls.length, 0);
  setActiveEmailCode('abcd2345', 'char-1'); // linked, but nothing pending yet
  flushViaBeacon(() => ({ characterId: 'char-1', level: 1 }), { sendBeaconImpl });
  assert.equal(calls.length, 0);
});

test('flushViaBeacon fires immediately via sendBeacon when a push is pending, bypassing the throttle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setActiveEmailCode('abcd2345', 'char-1');
  const fetchImpl = fakeFetch(() => okResponse); // should NOT be called - beacon path bypasses fetch
  notifyLocalSave(() => ({ characterId: 'char-1', level: 1 }), { fetchImpl }); // marks pending, schedules a timer far in the future
  const calls = [];
  const sendBeaconImpl = (url, blob) => { calls.push({ url, blob }); return true; };
  flushViaBeacon(() => ({ characterId: 'char-1', level: 9 }), { sendBeaconImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/save/email/push');
  assert.equal(fetchImpl.calls.length, 0);
  // The pending flag is cleared - a later timer fire (if any survives) should push nothing new.
  t.mock.timers.tick(CLOUD_AUTO_SAVE_THROTTLE_MS);
  assert.equal(fetchImpl.calls.length, 0);
});

test('flushViaBeacon does not push a different character than the one the code is linked to', () => {
  setActiveEmailCode('abcd2345', 'char-1');
  const fetchImpl = fakeFetch(() => okResponse);
  notifyLocalSave(() => ({ characterId: 'char-1', level: 1 }), { fetchImpl }); // marks pending
  const calls = [];
  const sendBeaconImpl = (url, blob) => { calls.push({ url, blob }); return true; };
  flushViaBeacon(() => ({ characterId: 'char-2', level: 1 }), { sendBeaconImpl });
  assert.equal(calls.length, 0);
  assert.equal(isLinked(), false);
});
