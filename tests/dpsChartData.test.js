// tests/dpsChartData.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDpsChartPoints, findCycleBoundaries, CATEGORY_COLORS, CATEGORIES } from '../js/systems/dpsChartData.js';

function battleEndEvent(overrides = {}) {
  return { type: 'battle_end', dps: 10, totalDamageDealt: 50, category: 'regular', ngPlusCycle: 0, ts: '2026-01-01T00:00:00.000Z', ...overrides };
}

test('buildDpsChartPoints', async (t) => {
  await t.test('filters out non-battle_end events', () => {
    const events = [{ type: 'level_up', level: 2 }, battleEndEvent()];
    const points = buildDpsChartPoints(events);
    assert.equal(points.length, 1);
  });

  await t.test('filters out battle_end events with no dps field (older, pre-DPS-tracking saves)', () => {
    const events = [{ type: 'battle_end', outcome: 'won' }, battleEndEvent()];
    const points = buildDpsChartPoints(events);
    assert.equal(points.length, 1);
  });

  await t.test('keeps chronological order and assigns a sequential index', () => {
    const events = [battleEndEvent({ dps: 5 }), battleEndEvent({ dps: 15 })];
    const points = buildDpsChartPoints(events);
    assert.deepEqual(points.map((p) => p.index), [0, 1]);
    assert.deepEqual(points.map((p) => p.dps), [5, 15]);
  });

  await t.test('carries category and ngPlusCycle through', () => {
    const points = buildDpsChartPoints([battleEndEvent({ category: 'boss', ngPlusCycle: 2 })]);
    assert.equal(points[0].category, 'boss');
    assert.equal(points[0].ngPlusCycle, 2);
  });

  await t.test('an unrecognized category falls back to regular rather than breaking the chart', () => {
    const points = buildDpsChartPoints([battleEndEvent({ category: 'not-a-real-category' })]);
    assert.equal(points[0].category, 'regular');
  });

  await t.test('a missing ngPlusCycle defaults to 0', () => {
    const event = battleEndEvent();
    delete event.ngPlusCycle;
    const points = buildDpsChartPoints([event]);
    assert.equal(points[0].ngPlusCycle, 0);
  });

  await t.test('an empty buffer produces an empty points list', () => {
    assert.deepEqual(buildDpsChartPoints([]), []);
  });

  // main.js also logs a battle_end for the weak-mob instant-resolve path
  // (the whole group is outclassed enough to skip the real battle screen -
  // see handleEncounter's own comment), which has 0 totalDamageDealt and
  // ~0 durationMs by construction, computing to dps: 0. That's a non-fight,
  // not a real 0 DPS result, and would otherwise make the chart read as
  // "getting weaker" exactly when the player is strong enough to stop
  // needing to fight at all - the opposite of what it's meant to show.
  await t.test('a fight with zero total damage dealt (instant-resolve win) is excluded, not plotted as a 0 DPS point', () => {
    const events = [
      battleEndEvent({ dps: 12 }),
      battleEndEvent({ dps: 0, totalDamageDealt: 0 }),
    ];
    const points = buildDpsChartPoints(events);
    assert.equal(points.length, 1);
    assert.equal(points[0].dps, 12);
  });
});

test('findCycleBoundaries', async (t) => {
  await t.test('no boundaries when every point is the same cycle', () => {
    const points = buildDpsChartPoints([battleEndEvent({ ngPlusCycle: 0 }), battleEndEvent({ ngPlusCycle: 0 })]);
    assert.deepEqual(findCycleBoundaries(points), []);
  });

  await t.test('marks the index where the cycle changes, not the one before it', () => {
    const points = buildDpsChartPoints([
      battleEndEvent({ ngPlusCycle: 0 }),
      battleEndEvent({ ngPlusCycle: 0 }),
      battleEndEvent({ ngPlusCycle: 1 }),
    ]);
    assert.deepEqual(findCycleBoundaries(points), [2]);
  });

  await t.test('finds multiple boundaries across several cycles', () => {
    const points = buildDpsChartPoints([
      battleEndEvent({ ngPlusCycle: 0 }),
      battleEndEvent({ ngPlusCycle: 1 }),
      battleEndEvent({ ngPlusCycle: 1 }),
      battleEndEvent({ ngPlusCycle: 2 }),
    ]);
    assert.deepEqual(findCycleBoundaries(points), [1, 3]);
  });

  await t.test('a single point has no boundaries', () => {
    assert.deepEqual(findCycleBoundaries(buildDpsChartPoints([battleEndEvent()])), []);
  });
});

test('CATEGORY_COLORS has a distinct color for every category', () => {
  for (const category of CATEGORIES) {
    assert.ok(CATEGORY_COLORS[category], `expected a color for category "${category}"`);
  }
  const colors = new Set(Object.values(CATEGORY_COLORS));
  assert.equal(colors.size, CATEGORIES.length, 'expected every category to have its own distinct color');
});
