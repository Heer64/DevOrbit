// [Sprint 5 · M8] US-54: follow rules (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW_SELF_MESSAGE, followMessage, isSelfFollow, safeCount, safeScore } from '../src/lib/followRules.js';

const id = 'a'.repeat(24);

test('self-follow is detected for ids given as strings or objects', () => {
  assert.equal(isSelfFollow(id, id), true);
  assert.equal(isSelfFollow({ toString: () => id }, id), true);
  assert.equal(isSelfFollow(id, 'b'.repeat(24)), false);
  assert.equal(isSelfFollow(null, null), false);
  assert.equal(isSelfFollow(undefined, id), false);
  assert.match(FOLLOW_SELF_MESSAGE, /cannot follow yourself/);
});

test('messages say what happened', () => {
  assert.equal(followMessage({ following: true, changed: true }, 'Bob'), 'You are now following Bob.');
  assert.equal(followMessage({ following: true, changed: false }, 'Bob'), 'You already follow Bob.');
  assert.equal(followMessage({ following: false, changed: true }, 'Bob'), 'You unfollowed Bob.');
  assert.equal(followMessage({ following: false, changed: false }, 'Bob'), 'You do not follow Bob.');
  assert.equal(followMessage({ following: true, changed: true }), 'You are now following this user.');
});

test('counts are whole numbers >= 0; scores are whole numbers and may be negative', () => {
  assert.equal(safeCount(3), 3);
  assert.equal(safeCount(2.9), 2);
  assert.equal(safeCount(-1), 0);
  assert.equal(safeCount('x'), 0);
  assert.equal(safeCount(undefined), 0);
  assert.equal(safeScore(-7), -7);
  assert.equal(safeScore(4.8), 4);
  assert.equal(safeScore(null), 0);
  assert.equal(safeScore('NaN'), 0);
});

test('never the word "likes" (NFR-27)', () => {
  for (const following of [true, false]) {
    for (const changed of [true, false]) assert.equal(/like/i.test(followMessage({ following, changed }, 'X')), false);
  }
});
