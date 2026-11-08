// [Sprint 5 · M7] US-52 Vote on a post: the rules on their own (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VOTES_PER_MINUTE,
  VOTE_CAST_MESSAGE,
  VOTE_CHANGED_MESSAGE,
  VOTE_DOWN,
  VOTE_NONE,
  VOTE_NOTHING_TO_RETRACT_MESSAGE,
  VOTE_RETRACTED_MESSAGE,
  VOTE_UNCHANGED_MESSAGE,
  VOTE_UP,
  VOTE_VALUE_MESSAGE,
  VOTE_WINDOW_MS,
  isEmptyDelta,
  readVoteValue,
  voteDelta,
  voteMessage,
  voteOutcome,
  voteRateLimit,
  voteRateLimitMessage,
} from '../src/lib/voteRules.js';

test('the numbers match US-52 / NFR-16: 30 votes per user per minute', () => {
  assert.equal(VOTES_PER_MINUTE, 30);
  assert.equal(VOTE_WINDOW_MS, 60_000);
  assert.deepEqual([VOTE_UP, VOTE_DOWN, VOTE_NONE], [1, -1, 0]);
});

test('readVoteValue accepts only the JSON numbers 1, -1 and 0', () => {
  assert.deepEqual(readVoteValue(1), { ok: true, value: 1 });
  assert.deepEqual(readVoteValue(-1), { ok: true, value: -1 });
  assert.deepEqual(readVoteValue(0), { ok: true, value: 0 });
  assert.ok(Object.is(readVoteValue(-0).value, 0), '-0 is stored as plain 0');
  for (const bad of [2, -2, 0.5, 100, '1', 'up', true, null, undefined, NaN, Infinity, [1], { value: 1 }]) {
    assert.deepEqual(readVoteValue(bad), { ok: false, message: VOTE_VALUE_MESSAGE }, `refuses ${String(bad)}`);
  }
});

test('voteDelta moves the counters by one vote and keeps score = upvotes - downvotes', () => {
  const values = [VOTE_NONE, VOTE_UP, VOTE_DOWN];
  for (const previous of values) {
    for (const next of values) {
      const delta = voteDelta(previous, next);
      assert.equal(delta.score, delta.upvotes - delta.downvotes, `${previous} -> ${next}`);
      assert.equal(delta.score, next - previous, `${previous} -> ${next} moves the score by next - previous`);
      assert.ok(Math.abs(delta.upvotes) <= 1 && Math.abs(delta.downvotes) <= 1);
    }
  }
  assert.deepEqual(voteDelta(VOTE_NONE, VOTE_UP), { upvotes: 1, downvotes: 0, score: 1 }); // AC1: score changes by one
  assert.deepEqual(voteDelta(VOTE_NONE, VOTE_DOWN), { upvotes: 0, downvotes: 1, score: -1 }); // AC1
  assert.deepEqual(voteDelta(VOTE_UP, VOTE_DOWN), { upvotes: -1, downvotes: 1, score: -2 }); // change
  assert.deepEqual(voteDelta(VOTE_DOWN, VOTE_NONE), { upvotes: 0, downvotes: -1, score: 1 }); // retract
  assert.ok(isEmptyDelta(voteDelta(VOTE_UP, VOTE_UP))); // AC2: same vote again changes nothing
  assert.ok(!isEmptyDelta(voteDelta(VOTE_UP, VOTE_NONE)));
});

test('voteOutcome and voteMessage name what happened', () => {
  assert.equal(voteOutcome(0, 1), 'cast');
  assert.equal(voteOutcome(1, -1), 'changed');
  assert.equal(voteOutcome(-1, 0), 'retracted');
  assert.equal(voteOutcome(1, 1), 'unchanged');
  assert.equal(voteOutcome(0, 0), 'unchanged');
  assert.equal(voteMessage('cast', 1), VOTE_CAST_MESSAGE);
  assert.equal(voteMessage('changed', -1), VOTE_CHANGED_MESSAGE);
  assert.equal(voteMessage('retracted', 0), VOTE_RETRACTED_MESSAGE);
  assert.equal(voteMessage('unchanged', 1), VOTE_UNCHANGED_MESSAGE);
  assert.equal(voteMessage('unchanged', 0), VOTE_NOTHING_TO_RETRACT_MESSAGE);
  // NFR-27: always "vote" / "score", never "likes".
  for (const text of [VOTE_CAST_MESSAGE, VOTE_CHANGED_MESSAGE, VOTE_RETRACTED_MESSAGE, VOTE_UNCHANGED_MESSAGE, voteRateLimitMessage(5)]) {
    assert.doesNotMatch(text, /like/i);
  }
});

test('voteRateLimit allows 30 in a minute and refuses the 31st with a wait time', () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z');
  assert.equal(voteRateLimit(1, now, now), null);
  assert.equal(voteRateLimit(VOTES_PER_MINUTE, now - 1000, now), null);
  const limited = voteRateLimit(VOTES_PER_MINUTE + 1, now - 15_000, now);
  assert.equal(limited.retryAfterSeconds, 45);
  assert.equal(limited.message, 'You can vote up to 30 times per minute. Please try again in 45 seconds.');
  // Never asks to wait 0 seconds, even at the very edge of the window.
  assert.equal(voteRateLimit(31, now - VOTE_WINDOW_MS, now).retryAfterSeconds, 1);
  assert.equal(voteRateLimitMessage(1), 'You can vote up to 30 times per minute. Please try again in 1 second.');
});
