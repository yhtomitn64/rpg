import test from 'node:test';
import assert from 'node:assert/strict';
import { isSuperBossDebuted, getSuperBossNotYetMessage } from '../js/systems/superBossGates.js';

test('isSuperBossDebuted is true for an entry with no debutNgPlusCycle field, at any cycle', () => {
  const entry = { id: 'superBossOne' };
  assert.equal(isSuperBossDebuted(entry, 0), true);
  assert.equal(isSuperBossDebuted(entry, 3), true);
});

test('isSuperBossDebuted is true for an entry with debutNgPlusCycle: 0, at any cycle', () => {
  const entry = { id: 'superBossOne', debutNgPlusCycle: 0 };
  assert.equal(isSuperBossDebuted(entry, 0), true);
  assert.equal(isSuperBossDebuted(entry, 1), true);
});

test('isSuperBossDebuted is false below the required cycle, true at and above it', () => {
  const entry = { id: 'superBossTwo', debutNgPlusCycle: 2 };
  assert.equal(isSuperBossDebuted(entry, 0), false);
  assert.equal(isSuperBossDebuted(entry, 1), false);
  assert.equal(isSuperBossDebuted(entry, 2), true);
  assert.equal(isSuperBossDebuted(entry, 3), true);
});

test('getSuperBossNotYetMessage returns a non-empty string', () => {
  const message = getSuperBossNotYetMessage();
  assert.equal(typeof message, 'string');
  assert.ok(message.length > 0);
});
