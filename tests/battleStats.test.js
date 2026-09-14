// tests/battleStats.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBattleCategory, computeDps } from '../js/systems/battleStats.js';

test('classifyBattleCategory', async (t) => {
  await t.test('a plain mob roster classifies as regular', () => {
    assert.equal(classifyBattleCategory(['boar']), 'regular');
    assert.equal(classifyBattleCategory(['boar', 'bat']), 'regular');
  });

  await t.test('a roster containing a boss classifies as boss', () => {
    assert.equal(classifyBattleCategory(['dragon']), 'boss');
    assert.equal(classifyBattleCategory(['boar', 'dragon']), 'boss', 'one boss among regulars should still read as boss');
  });

  await t.test('a roster containing a superboss classifies as superboss', () => {
    assert.equal(classifyBattleCategory(['superBossOne']), 'superboss');
  });

  await t.test('superboss outranks boss if a roster somehow mixed both', () => {
    assert.equal(classifyBattleCategory(['dragon', 'superBossOne']), 'superboss');
  });

  await t.test('an empty roster classifies as regular', () => {
    assert.equal(classifyBattleCategory([]), 'regular');
  });

  await t.test('an unknown monster id is ignored rather than throwing', () => {
    assert.equal(classifyBattleCategory(['not-a-real-monster-id']), 'regular');
  });
});

test('computeDps', async (t) => {
  await t.test('divides total damage by elapsed seconds', () => {
    assert.equal(computeDps(300, 10000), 30);
  });

  await t.test('a zero duration returns 0 DPS instead of dividing by zero', () => {
    assert.equal(computeDps(300, 0), 0);
  });

  await t.test('a missing/undefined duration returns 0 DPS', () => {
    assert.equal(computeDps(300, undefined), 0);
  });

  await t.test('a negative duration (bad data) returns 0 DPS rather than a negative rate', () => {
    assert.equal(computeDps(300, -50), 0);
  });

  await t.test('zero total damage over real time is 0 DPS, not NaN', () => {
    assert.equal(computeDps(0, 5000), 0);
  });
});
