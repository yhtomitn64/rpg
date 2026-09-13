// Real DOM tests for js/screens/dpsChartScreen.js, using jsdom (see
// tests/helpers/dom.js). jsdom has no canvas 2D context, so the actual
// pixel drawing isn't (and can't be) asserted here - js/systems/
// dpsChartData.js's own pure tests cover the plotting data. What's checkable
// in jsdom is the canvas's own fallback content, which this screen renders
// as one tagged <span> per point (see dpsChartScreen.js's header) - that's
// what these tests inspect instead of pixels.
//
// Each test gets its own fake in-memory storage (same helper shape as
// tests/telemetry.test.js's createFakeStorage) and passes it to startSession
// explicitly - telemetry.js's module-level sessionBuffer is a singleton, and
// startSession() *recovers* whatever was last persisted rather than clearing
// it, so reusing the real default (globalThis.localStorage) here would leak
// one test's fabricated events into the next test's assertions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, teardownDom, createRoot, click, keydown } from './helpers/dom.js';

function createFakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
}

async function mountDpsChart(callbacks = { onClose: () => {} }) {
  const { mount } = await import('../js/screens/dpsChartScreen.js');
  const root = createRoot();
  mount(root, { state: {}, callbacks });
  return root;
}

// Starts a fresh session against an isolated fake storage, then logs each
// given battle_end payload - so every test starts from a genuinely empty
// telemetry buffer regardless of what earlier tests (in this file or
// elsewhere in the same process) already logged. totalDamageDealt defaults
// to a real (nonzero) value: buildDpsChartPoints (js/systems/
// dpsChartData.js) excludes totalDamageDealt: 0 fights (the weak-mob
// instant-resolve non-fight, not a real 0 DPS result), so a fixture that
// omitted it entirely would silently vanish from the chart instead of
// plotting.
async function seedTelemetry(events) {
  const { startSession, logEvent } = await import('../js/systems/telemetry.js');
  const storage = createFakeStorage();
  startSession({ storage });
  for (const event of events) {
    logEvent('battle_end', { totalDamageDealt: 100, ...event }, { storage });
  }
}

test('dpsChartScreen DOM', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/dpsChartScreen.js');
    unmount();
    teardownDom();
  });

  await t.test('mounts without throwing when the telemetry buffer has no battle_end events at all', async () => {
    await seedTelemetry([]);
    const root = await mountDpsChart();
    assert.ok(root.querySelector('#dps-chart-empty-state'), 'should show the empty state rather than an empty chart');
    assert.equal(root.querySelector('#dps-chart-canvas'), null);
  });

  await t.test('mounts without throwing given fabricated battle_end telemetry', async () => {
    await seedTelemetry([
      { dps: 10, category: 'regular', ngPlusCycle: 0 },
      { dps: 20, category: 'boss', ngPlusCycle: 0 },
      { dps: 15, category: 'superboss', ngPlusCycle: 1 },
    ]);
    const root = await mountDpsChart();
    assert.ok(root.querySelector('#dps-chart-canvas'), 'expected a chart canvas once there is data to plot');
  });

  await t.test('plots one marker per battle_end event, colored by category', async () => {
    await seedTelemetry([
      { dps: 10, category: 'regular', ngPlusCycle: 0 },
      { dps: 12, category: 'regular', ngPlusCycle: 0 },
      { dps: 20, category: 'boss', ngPlusCycle: 0 },
      { dps: 40, category: 'superboss', ngPlusCycle: 1 },
    ]);
    const root = await mountDpsChart();
    assert.equal(root.querySelectorAll('.dps-chart-point').length, 4);
    assert.equal(root.querySelectorAll('.dps-chart-point-regular').length, 2);
    assert.equal(root.querySelectorAll('.dps-chart-point-boss').length, 1);
    assert.equal(root.querySelectorAll('.dps-chart-point-superboss').length, 1);
  });

  await t.test('non-battle_end telemetry events (e.g. level_up) are ignored, not plotted', async () => {
    const { startSession, logEvent } = await import('../js/systems/telemetry.js');
    const storage = createFakeStorage();
    startSession({ storage });
    logEvent('level_up', { level: 5 }, { storage });
    logEvent('battle_end', { dps: 8, totalDamageDealt: 100, category: 'regular', ngPlusCycle: 0 }, { storage });
    const root = await mountDpsChart();
    assert.equal(root.querySelectorAll('.dps-chart-point').length, 1);
  });

  await t.test('shows a legend entry for every category', async () => {
    await seedTelemetry([]);
    const root = await mountDpsChart();
    const legendText = root.querySelector('.dps-chart-legend').textContent;
    assert.match(legendText, /Regular/);
    assert.match(legendText, /Boss/);
    assert.match(legendText, /Superboss/);
  });

  await t.test('the X button, Escape, and backdrop click all call onClose', async () => {
    await seedTelemetry([{ dps: 5, category: 'regular', ngPlusCycle: 0 }]);
    let closed = 0;
    const root = await mountDpsChart({ onClose: () => { closed += 1; } });
    click(root.querySelector('#btn-close-x'));
    keydown('Escape');
    click(root);
    assert.equal(closed, 3);
  });

  await t.test('the Close button calls onClose', async () => {
    await seedTelemetry([]);
    let closed = false;
    const root = await mountDpsChart({ onClose: () => { closed = true; } });
    click(root.querySelector('#btn-close-dps-chart'));
    assert.equal(closed, true);
  });
});
