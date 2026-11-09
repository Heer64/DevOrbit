// [Sprint 5 · M8] US-53: the trending formula, the order and tie-break, the cursor (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRENDING_MAX_AGE_MS,
  TRENDING_RECALC_INTERVAL_MS,
  TRENDING_SORT,
  afterCursorFilter,
  ageHours,
  compareTrending,
  decodeTrendingCursor,
  encodeTrendingCursor,
  postTrendingScore,
  rankingIsStale,
  readTrendingLimit,
  trendingScore,
} from '../src/lib/trendingRules.js';

const NOW = Date.UTC(2026, 10, 9, 5, 0, 0); // Mon 9 Nov 2026 10:30 IST
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000);
const id = (n) => n.toString(16).padStart(24, '0');

test('formula: (up - down) / (ageHours + 2)^1.5', () => {
  // A brand-new post: divide by 2^1.5 = 2.828...
  assert.equal(trendingScore(10, hoursAgo(0), NOW), 10 / 2 ** 1.5);
  // 7 hours old: (7 + 2)^1.5 = 27
  assert.equal(trendingScore(27, hoursAgo(7), NOW), 1);
  // 2 hours old: 4^1.5 = 8
  assert.equal(trendingScore(-4, hoursAgo(2), NOW), -0.5);
  assert.ok(Math.abs(trendingScore(5, hoursAgo(1.5), NOW) - 5 / 3.5 ** 1.5) < 1e-12);
});

test('net score comes from the vote counters (upvotes - downvotes)', () => {
  assert.equal(postTrendingScore({ upvotes: 30, downvotes: 3, score: 999, createdAt: hoursAgo(7) }, NOW), 1);
  assert.equal(postTrendingScore({ score: 27, createdAt: hoursAgo(7) }, NOW), 1, 'falls back to score');
  assert.equal(postTrendingScore({ upvotes: 0, downvotes: 0, createdAt: hoursAgo(1) }, NOW), 0);
  assert.equal(postTrendingScore({}, NOW), 0);
});

test('zero, missing and invalid inputs are safe', () => {
  assert.equal(trendingScore(0, hoursAgo(1), NOW), 0);
  assert.equal(trendingScore('x', hoursAgo(1), NOW), 0);
  assert.equal(trendingScore(undefined, hoursAgo(1), NOW), 0);
  assert.equal(ageHours('not a date', NOW), 0);
  assert.equal(ageHours(new Date(NOW + 60_000), NOW), 0, 'a post "from the future" counts as age 0');
  assert.equal(trendingScore(4, new Date(NOW + 3_600_000), NOW), 4 / 2 ** 1.5);
});

test('older posts sink: same votes, more age, lower score', () => {
  const scores = [0, 1, 6, 24, 72].map((h) => trendingScore(10, hoursAgo(h), NOW));
  for (let i = 1; i < scores.length; i += 1) assert.ok(scores[i] < scores[i - 1]);
  // and a newer post with fewer votes can beat an older one with more
  assert.ok(trendingScore(5, hoursAgo(1), NOW) > trendingScore(20, hoursAgo(24), NOW));
});

test('order: highest trending score first', () => {
  const posts = [
    { _id: id(1), trendingScore: 0.5, createdAt: hoursAgo(3) },
    { _id: id(2), trendingScore: 2, createdAt: hoursAgo(5) },
    { _id: id(3), trendingScore: -1, createdAt: hoursAgo(0) },
    { _id: id(4), trendingScore: 0, createdAt: hoursAgo(1) },
  ];
  assert.deepEqual(
    posts.sort(compareTrending).map((p) => p._id),
    [id(2), id(1), id(4), id(3)]
  );
});

test('ties: the newer post comes first (createdAt, then _id)', () => {
  const posts = [
    { _id: id(10), trendingScore: 1, createdAt: hoursAgo(5) },
    { _id: id(11), trendingScore: 1, createdAt: hoursAgo(1) },
    { _id: id(13), trendingScore: 1, createdAt: hoursAgo(3) },
    { _id: id(12), trendingScore: 1, createdAt: hoursAgo(3) },
    { _id: id(14), trendingScore: 0, createdAt: hoursAgo(0) },
  ];
  assert.deepEqual(
    posts.sort(compareTrending).map((p) => p._id),
    [id(11), id(13), id(12), id(10), id(14)]
  );
  // Many unvoted posts (all 0) come out newest first.
  const zeros = [3, 1, 2].map((h, i) => ({ _id: id(20 + i), trendingScore: 0, createdAt: hoursAgo(h) }));
  assert.deepEqual(
    zeros.sort(compareTrending).map((p) => p._id),
    [id(21), id(22), id(20)]
  );
});

test('the MongoDB sort matches the comparator', () => {
  assert.deepEqual({ ...TRENDING_SORT }, { trendingScore: -1, createdAt: -1, _id: -1 });
});

test('page size: 1..50, default 20', () => {
  assert.equal(readTrendingLimit(undefined), 20);
  assert.equal(readTrendingLimit('0'), 20);
  assert.equal(readTrendingLimit('abc'), 20);
  assert.equal(readTrendingLimit('5'), 5);
  assert.equal(readTrendingLimit('500'), 50);
});

test('cursor round trip keeps the exact score, time and id', () => {
  const post = { _id: id(77), trendingScore: 1 / 3, createdAt: hoursAgo(2.5) };
  const cursor = encodeTrendingCursor(post);
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  const back = decodeTrendingCursor(cursor);
  assert.equal(back.trendingScore, 1 / 3);
  assert.equal(back.createdAt.getTime(), post.createdAt.getTime());
  assert.equal(back.id, id(77));
});

test('bad cursors are refused', () => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const bad of [
    undefined,
    '',
    'not base64!',
    'a'.repeat(300),
    enc('text'),
    enc(null),
    enc({ s: 'x', c: 1, i: id(1) }),
    enc({ s: 1, c: -1, i: id(1) }),
    enc({ s: 1, c: 1.5, i: id(1) }),
    enc({ s: 1, c: 1, i: 'nope' }),
    enc({ s: 1, c: 1, i: { $gt: '' } }),
    Buffer.from('{bad json').toString('base64url'),
  ]) {
    assert.equal(decodeTrendingCursor(bad), null, String(bad));
  }
});

test('"after cursor" filter continues the same order without repeats', () => {
  const posts = [
    { _id: id(1), trendingScore: 2, createdAt: hoursAgo(1) },
    { _id: id(2), trendingScore: 1, createdAt: hoursAgo(1) },
    { _id: id(3), trendingScore: 1, createdAt: hoursAgo(1) },
    { _id: id(4), trendingScore: 1, createdAt: hoursAgo(2) },
    { _id: id(5), trendingScore: 0, createdAt: hoursAgo(0) },
  ].sort(compareTrending);
  // Evaluate the Mongo-style filter in JS against each post.
  const matches = (filter, post) =>
    filter.$or.some((clause) =>
      Object.entries(clause).every(([key, cond]) => {
        const value = key === 'createdAt' ? post.createdAt.getTime() : key === '_id' ? post._id : post[key];
        if (cond && typeof cond === 'object' && '$lt' in cond) {
          const limit = cond.$lt instanceof Date ? cond.$lt.getTime() : cond.$lt;
          return value < limit;
        }
        const expected = cond instanceof Date ? cond.getTime() : cond;
        return value === expected;
      })
    );
  for (let split = 0; split < posts.length; split += 1) {
    const cursor = decodeTrendingCursor(encodeTrendingCursor(posts[split]));
    const rest = posts.filter((post) => matches(afterCursorFilter(cursor), post));
    assert.deepEqual(
      rest.map((p) => p._id),
      posts.slice(split + 1).map((p) => p._id),
      `after #${split}`
    );
  }
  assert.deepEqual(afterCursorFilter(null), {});
});

test('ranking is stale after 5 minutes; scheduled runs are more frequent than that', () => {
  assert.equal(TRENDING_MAX_AGE_MS, 5 * 60 * 1000);
  assert.ok(TRENDING_RECALC_INTERVAL_MS < TRENDING_MAX_AGE_MS);
  assert.equal(rankingIsStale(null, NOW), true);
  assert.equal(rankingIsStale(new Date(NOW - 4 * 60 * 1000), NOW), false);
  assert.equal(rankingIsStale(new Date(NOW - 5 * 60 * 1000 + 1), NOW), false);
  assert.equal(rankingIsStale(new Date(NOW - 5 * 60 * 1000), NOW), true);
});
