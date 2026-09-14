// Real DOM tests for js/screens/celebrationEffect.js, using jsdom (see
// tests/helpers/dom.js). Scope: the tool-pickup celebration's player-tile
// anchoring and its slowed-down orbit duration - not pixel-perfect rendering,
// see mapScreenDom.test.js's own header for why this pattern exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, teardownDom } from './helpers/dom.js';

function buildCelebrationDom() {
  document.body.innerHTML = `
    <div id="flavor-banner"></div>
    <div id="celebration-burst"></div>
    <div id="celebration-big-text"></div>
    <div id="celebration-tool-callout"></div>
  `;
}

// celebrationEffect.js asks mapScreen.getPlayerScreenRect() for the hero's
// on-screen rect rather than querying a '.map-tile-player' element itself -
// see anchorBurstToPlayer's own comment there. The canvas renderer (the only
// one left now that js/screens/mapDomRenderer.js is gone) has no real rect to
// give under jsdom at all: jsdom ships no canvas 2d context, so
// getContext('2d') returns null and the renderer never records a player tile
// position. mapScreen exposes __setPlayerScreenRectForTest for exactly this
// gap - it overrides getPlayerScreenRect()'s answer directly, so this file
// doesn't need to mount a real map at all.
async function stubPlayerScreenRect(rect) {
  const { __setPlayerScreenRectForTest } = await import('../js/screens/mapScreen.js');
  __setPlayerScreenRectForTest(rect);
}

test('celebrationEffect', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { __setPlayerScreenRectForTest } = await import('../js/screens/mapScreen.js');
    __setPlayerScreenRectForTest(null);
    teardownDom();
  });

  await t.test('playToolCelebration anchors the burst to the player tile when one exists', async () => {
    buildCelebrationDom();
    await stubPlayerScreenRect({ left: 100, top: 200, width: 40, height: 40, right: 140, bottom: 240 });

    const { playToolCelebration } = await import('../js/screens/celebrationEffect.js');
    playToolCelebration('🪓', 'msg', 'capability');

    const burstEl = document.getElementById('celebration-burst');
    assert.equal(burstEl.style.left, '120px');
    assert.equal(burstEl.style.top, '220px');
  });

  await t.test('playToolCelebration falls back to the default center position when no player rect is available', async () => {
    buildCelebrationDom();
    // No stub set - getPlayerScreenRect() returns null exactly as it does
    // with no map mounted at all.

    const { playToolCelebration } = await import('../js/screens/celebrationEffect.js');
    playToolCelebration('🪓', 'msg', 'capability');

    const burstEl = document.getElementById('celebration-burst');
    assert.equal(burstEl.style.left, '');
    assert.equal(burstEl.style.top, '');
  });

  await t.test('playCelebration clears any leftover player-anchored position from a prior tool celebration', async () => {
    buildCelebrationDom();
    await stubPlayerScreenRect({ left: 100, top: 200, width: 40, height: 40, right: 140, bottom: 240 });

    const { playCelebration, playToolCelebration } = await import('../js/screens/celebrationEffect.js');
    playToolCelebration('🪓', 'msg', 'capability');
    playCelebration('🎉', 'other msg');

    const burstEl = document.getElementById('celebration-burst');
    assert.equal(burstEl.style.left, '');
    assert.equal(burstEl.style.top, '');
  });

  await t.test('the tool celebration orbit lasts roughly twice as long as before (past 1400ms, done by ~2900ms)', async (t) => {
    // playToolCelebration's own hide-burst timer is a single setTimeout
    // registered up front (js/screens/celebrationEffect.js) - no Date.now()
    // reads and no chaining, so a plain t.mock.timers.tick() replaces the
    // real wait directly.
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    buildCelebrationDom();

    const { playToolCelebration } = await import('../js/screens/celebrationEffect.js');
    playToolCelebration('🪓', 'msg', 'capability');
    const burstEl = document.getElementById('celebration-burst');
    assert.ok(burstEl.classList.contains('celebration-burst-tool-play'));

    t.mock.timers.tick(1500);
    assert.ok(burstEl.classList.contains('celebration-burst-tool-play'), 'still playing past the old 1400ms duration');

    t.mock.timers.tick(1400);
    assert.equal(burstEl.classList.contains('celebration-burst-tool-play'), false, 'finished by ~2900ms total');
  });
});
