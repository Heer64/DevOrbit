// [Sprint 5 · M8] US-53: the ranker recalculates trending scores from the real vote counters,
// at least every 5 minutes, one run at a time (no database: an in-memory Post stands in).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrendingRanker } from '../src/lib/trendingRanker.js';
import { TRENDING_RECALC_INTERVAL_MS, compareTrending, trendingScore } from '../src/lib/trendingRules.js';

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 9, 5, 0, 0);

// Minimal stand-in for the Post model: find().select().lean() and bulkWrite().
function fakePostModel(posts) {
  const calls = { find: 0, bulkWrite: 0, written: 0 };
  return {
    posts,
    calls,
    find() {
      calls.find += 1;
      return { select: () => ({ lean: async () => posts.map((p) => ({ ...p })) }) };
    },
    async bulkWrite(ops) {
      calls.bulkWrite += 1;
      for (const op of ops) {
        const post = posts.find((p) => p._id === op.updateOne.filter._id);
        Object.assign(post, op.updateOne.update.$set);
        calls.written += 1;
      }
      return { ok: 1 };
    },
  };
}

const post = (n, { up = 0, down = 0, ageH = 0, trending } = {}) => ({
  _id: `p${n}`,
  upvotes: up,
  downvotes: down,
  score: up - down,
  createdAt: new Date(T0 - ageH * HOUR),
  ...(trending === undefined ? {} : { trendingScore: trending }),
});

const order = (Post) => [...Post.posts].sort(compareTrending).map((p) => p._id);

test('a run writes the formula value for every post, from its up/down votes', async () => {
  const Post = fakePostModel([post(1, { up: 27, ageH: 7 }), post(2, { up: 4, down: 8, ageH: 2 }), post(3)]);
  const ranker = makeTrendingRanker({ Post, now: () => T0 });
  const result = await ranker.recalculate();
  assert.equal(result.checked, 3);
  assert.equal(Post.posts[0].trendingScore, 1);
  assert.equal(Post.posts[1].trendingScore, -0.5);
  assert.equal(Post.posts[2].trendingScore, 0, 'posts made before M8 (no field) get their value');
  assert.equal(ranker.lastRankedAt.getTime(), T0);
});

test('only changed posts are written, in batches', async () => {
  const posts = Array.from({ length: 7 }, (_, i) => post(i, { up: i, ageH: 1 }));
  const Post = fakePostModel(posts);
  const ranker = makeTrendingRanker({ Post, now: () => T0, batchSize: 3 });
  const first = await ranker.recalculate();
  assert.equal(first.updated, 7, 'all 7 had no stored trendingScore yet');
  assert.equal(Post.calls.bulkWrite, 3, '7 writes in batches of 3');
  const again = await ranker.recalculate();
  assert.equal(again.updated, 0, 'same moment, nothing changed, nothing written');
  assert.equal(Post.calls.bulkWrite, 3, 'no write call when nothing changed');
  Post.posts[2].upvotes = 9; // one post gets votes
  assert.equal((await ranker.recalculate()).updated, 1, 'only that post is written');
});

test('AC2: votes cast after the last run change the order once the scores are recalculated', async () => {
  let now = T0;
  const Post = fakePostModel([post(1, { up: 5, ageH: 1 }), post(2, { up: 3, ageH: 1 })]);
  const ranker = makeTrendingRanker({ Post, now: () => now });
  await ranker.ensureFresh();
  assert.deepEqual(order(Post), ['p1', 'p2']);

  // M7 moves the counters (atomic $inc there); p2 gets 4 more upvotes.
  Object.assign(Post.posts[1], { upvotes: 7, score: 7 });

  now = T0 + 2 * MIN;
  await ranker.ensureFresh(); // 2 minutes later: last run still fresh, nothing recalculated yet
  assert.equal(ranker.runs, 1);
  assert.deepEqual(order(Post), ['p1', 'p2']);

  now = T0 + 5 * MIN; // 5 minutes after the last run
  await ranker.ensureFresh();
  assert.equal(ranker.runs, 2);
  assert.deepEqual(order(Post), ['p2', 'p1'], 'the order updated');
  assert.equal(Post.posts[1].trendingScore, trendingScore(7, Post.posts[1].createdAt, now));
});

test('age alone changes scores, so the order can change with no new votes', async () => {
  let now = T0;
  // p1: 10 points but 10 hours old; p2: 3 points, brand new.
  const Post = fakePostModel([post(1, { up: 10, ageH: 10 }), post(2, { up: 3, ageH: 0 })]);
  const ranker = makeTrendingRanker({ Post, now: () => now });
  await ranker.recalculate();
  // now: 10 / 12^1.5 = 0.241 vs 3 / 2^1.5 = 1.061
  assert.deepEqual(order(Post), ['p2', 'p1']);
  const p1Before = Post.posts[0].trendingScore;

  now = T0 + 7 * HOUR; // 7 hours on: 10 / 19^1.5 = 0.1207 vs 3 / 9^1.5 = 0.1111
  await ranker.recalculate();
  assert.ok(Post.posts[0].trendingScore < p1Before, 'every score shrinks with age');
  assert.deepEqual(order(Post), ['p1', 'p2'], 'the newer post loses its head start');
});

test('concurrent requests share one run', async () => {
  const Post = fakePostModel([post(1, { up: 1 })]);
  const ranker = makeTrendingRanker({ Post, now: () => T0 });
  await Promise.all(Array.from({ length: 100 }, () => ranker.ensureFresh()));
  assert.equal(Post.calls.find, 1);
  assert.equal(ranker.runs, 1);
});

test('a failed run does not break the feed: ensureFresh reports it and returns', async () => {
  const errors = [];
  const Post = {
    find() {
      return {
        select: () => ({
          lean: async () => {
            throw new Error('db down');
          },
        }),
      };
    },
  };
  const ranker = makeTrendingRanker({ Post, now: () => T0, onError: (e) => errors.push(e.message) });
  assert.equal(await ranker.ensureFresh(), null);
  assert.deepEqual(errors, ['db down']);
  await assert.rejects(ranker.recalculate(), /db down/, 'a direct run still reports the error');
});

test('scheduler: runs at start, then every 4 minutes (so at least every 5), and stops', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const Post = fakePostModel([post(1, { up: 2 })]);
    const ranker = makeTrendingRanker({ Post, now: () => T0 });
    ranker.start();
    ranker.start(); // a second start is ignored
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ranker.runs, 1, 'ran straight away');
    assert.equal(ranker.running, true);

    for (let tick = 1; tick <= 3; tick += 1) {
      mock.timers.tick(TRENDING_RECALC_INTERVAL_MS);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(ranker.runs, 1 + tick, `run ${tick + 1} after ${tick * 4} minutes`);
    }
    assert.ok(TRENDING_RECALC_INTERVAL_MS <= 5 * MIN);

    ranker.stop();
    assert.equal(ranker.running, false);
    mock.timers.tick(TRENDING_RECALC_INTERVAL_MS * 3);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ranker.runs, 4, 'no runs after stop');
  } finally {
    mock.timers.reset();
  }
});

test('performance: ranking 5,000 posts takes well under a second (CPU side)', async () => {
  const posts = Array.from({ length: 5000 }, (_, i) => post(i, { up: i % 50, down: i % 7, ageH: (i % 300) / 3 }));
  const Post = fakePostModel(posts);
  const ranker = makeTrendingRanker({ Post, now: () => T0 });
  const started = performance.now();
  await ranker.recalculate();
  const ms = performance.now() - started;
  assert.ok(ms < 1000, `took ${ms.toFixed(1)} ms`);
});
