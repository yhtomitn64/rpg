import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_CODE_LENGTH,
  generateEmailCode,
  isValidEmailCode,
  isValidEmailAddress,
  hashEmailForRateLimit,
} from '../functions/_shared/emailCode.js';

test('generateEmailCode is 8 characters from the unambiguous alphabet', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateEmailCode();
    assert.equal(code.length, EMAIL_CODE_LENGTH);
    assert.match(code, /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
  }
});

test('generateEmailCode is deterministic for a given random source', () => {
  let calls = 0;
  const fixedRandom = () => { calls++; return 0; };
  assert.equal(generateEmailCode(fixedRandom), 'aaaaaaaa');
  assert.equal(calls, 8);
});

test('isValidEmailCode accepts only 8 characters from the unambiguous alphabet', () => {
  assert.equal(isValidEmailCode('abcdefgh'), true);
  assert.equal(isValidEmailCode('0bcdefgh'), false); // 0 excluded
  assert.equal(isValidEmailCode('1bcdefgh'), false); // 1 excluded
  assert.equal(isValidEmailCode('ibcdefgh'), false); // i excluded
  assert.equal(isValidEmailCode('lbcdefgh'), false); // l excluded
  assert.equal(isValidEmailCode('obcdefgh'), false); // o excluded
  assert.equal(isValidEmailCode('ABCDEFGH'), false); // lowercase only
  assert.equal(isValidEmailCode('abcdefg'), false); // too short
  assert.equal(isValidEmailCode(null), false);
});

test('isValidEmailAddress accepts a plain single address', () => {
  assert.equal(isValidEmailAddress('person@example.com'), true);
  assert.equal(isValidEmailAddress('a.b+tag@sub.example.co'), true);
});

test('isValidEmailAddress rejects multiple addresses, display names, and junk', () => {
  assert.equal(isValidEmailAddress('a@example.com,b@example.com'), false);
  assert.equal(isValidEmailAddress('Name <a@example.com>'), false);
  assert.equal(isValidEmailAddress('not-an-email'), false);
  assert.equal(isValidEmailAddress(''), false);
  assert.equal(isValidEmailAddress(null), false);
  assert.equal(isValidEmailAddress('a'.repeat(260) + '@example.com'), false); // too long
});

test('hashEmailForRateLimit is deterministic for the same email+secret and case-insensitive', async () => {
  const a = await hashEmailForRateLimit('Person@Example.com', 'secret1');
  const b = await hashEmailForRateLimit('person@example.com', 'secret1');
  assert.equal(a, b);
  assert.equal(a.length, 32);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('hashEmailForRateLimit differs for different secrets (not just a bare hash of the email)', async () => {
  const a = await hashEmailForRateLimit('person@example.com', 'secret1');
  const b = await hashEmailForRateLimit('person@example.com', 'secret2');
  assert.notEqual(a, b);
});
