// [Sprint 5 · M8] US-53 Browse the trending feed (FR-25, NFR-1a, NFR-15) against a real MongoDB.
// Posts come from M6's API and votes from M7's API: nothing here has its own voting.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Post from '../src/models/Post.js';
import PostCreateLog from '../src/models/PostCreateLog.js';
import PostVote from '../src/models/PostVote.js';
import PostVoteLog from '../src/models/PostVoteLog.js';
import { trendingRanker } from '../src/lib/trending.js';
import { TRENDING_MAX_AGE_MS, compareTrending, trendingScore } from '../src/lib/trendingRules.js';

const HOUR = 3600 * 1000;
let app;
let author, viewer;
let voters = [];

const as = (account) => authed(app, account.token);
const feed = (account = viewer, query = '') => as(account).get(`/api/posts/trending${query}`);
const vote = (account, postId, value) =>
  request(app).put(`/api/posts/${postId}/vote`).set('Authorization', `Bearer ${account.token}`).send({ value });

async function newPost(text, { ageHours = 0, account = author } = {}) {
  await PostCreateLog.deleteMany({ user: account.user.id }); // M6's 10-per-hour limit is not tested here
  const res = await as(account).post('/api/posts').send({ text });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id = res.body.post._id;
  if (ageHours) {
    // createdAt is immutable through Mongoose, so set the age with the driver.
    await Post.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: { createdAt: new Date(Date.now() - ageHours * HOUR) } }
    );
  }
  return id;
}

// `count` up (or down) votes from different users, through M7's vote API.
async function votes(postId, count, value = 1) {
  for (let i = 0; i < count; i += 1) {
    const res = await vote(voters[i], postId, value);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
}

const texts = (res) => res.body.posts.map((post) => post.text);

before(async () => {
  ({ app } = await setup());
  author = await signup(app, 'Tara Trending');
  viewer = await signup(app, 'Vic Viewer');
  voters = await Promise.all(Array.from({ length: 12 }, (_, i) => signup(app, `Voter ${i + 1}`)));
});

beforeEach(async () => {
  await Promise.all([Post.deleteMany({}), PostVote.deleteMany({}), PostVoteLog.deleteMany({})]);
  trendingRanker.setClock(null);
  trendingRanker.reset(); // as after a restart: the next feed request ranks first
});

afterEach(() => {
  trendingRanker.setClock(null);
});

after(teardown);

test('login is required', async () => {
  assert.equal((await request(app).get('/api/posts/trending')).status, 401);
});

test('"trending" is not taken for a post ID by the M6 routes', async () => {
  const res = await feed();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.posts, []);
  assert.equal(res.body.nextCursor, null);
});

test('AC1: posts are ordered by (up - down) / (ageHours + 2)^1.5, highest first', async () => {
  const fresh = await newPost('Fresh, 3 up', { ageHours: 0 });
  const old = await newPost('Old, 10 up', { ageHours: 20 });
  const mid = await newPost('Mid, 6 up 1 down', { ageHours: 3 });
  const negative = await newPost('Disliked, 4 down', { ageHours: 1 });
  const quiet = await newPost('No votes', { ageHours: 2 });
  await votes(fresh, 3);
  await votes(old, 10);
  await votes(mid, 6);
  await vote(voters[11], mid, -1);
  await votes(negative, 4, -1);

  const res = await feed();
  assert.equal(res.status, 200, JSON.stringify(res.body));

  // Expected order computed independently from the stored posts and the formula.
  const stored = await Post.find({}).lean();
  const rankedAt = new Date(res.body.rankedAt).getTime();
  const expected = stored
    .map((post) => ({ ...post, trendingScore: trendingScore(post.upvotes - post.downvotes, post.createdAt, rankedAt) }))
    .sort(compareTrending)
    .map((post) => post.text);
  assert.deepEqual(texts(res), expected);
  // fresh 3/2^1.5 = 1.06 > mid 5/5^1.5 = 0.447 > old 10/22^1.5 = 0.097 > quiet 0 > negative -4/3^1.5
  assert.deepEqual(texts(res), ['Fresh, 3 up', 'Mid, 6 up 1 down', 'Old, 10 up', 'No votes', 'Disliked, 4 down']);

  for (const post of res.body.posts) {
    const source = stored.find((s) => String(s._id) === post._id);
    assert.ok(Math.abs(post.trendingScore - trendingScore(source.upvotes - source.downvotes, source.createdAt, rankedAt)) < 1e-9);
  }
  assert.ok(quiet);
});

test('ties go to the newer post', async () => {
  const older = await newPost('Older, 2 up', { ageHours: 1 });
  const newer = await newPost('Newer, 2 up', { ageHours: 1 });
  // Exactly the same age and votes -> exactly the same trending score.
  const sameTime = new Date(Date.now() - HOUR);
  await Post.collection.updateMany({}, { $set: { createdAt: sameTime } });
  await votes(older, 2);
  await votes(newer, 2);
  await newPost('Unvoted A', { ageHours: 5 });
  await newPost('Unvoted B', { ageHours: 4 });

  const res = await feed();
  assert.deepEqual(texts(res), ['Newer, 2 up', 'Older, 2 up', 'Unvoted B', 'Unvoted A']);
  assert.equal(res.body.posts[0].trendingScore, res.body.posts[1].trendingScore);
});

test('AC2: votes after the last ranking run change the order within 5 minutes, not before', async () => {
  const first = await newPost('First');
  const second = await newPost('Second');
  await votes(first, 5);
  await votes(second, 2);
  const ranked = await feed();
  assert.deepEqual(texts(ranked), ['First', 'Second']);
  const rankedAt = ranked.body.rankedAt;

  // New votes (M7): Second now has 9 points.
  await votes(second, 9);
  // The feed keeps the last ranking for now...
  const soon = await feed();
  assert.deepEqual(texts(soon), ['First', 'Second']);
  assert.equal(soon.body.rankedAt, rankedAt);
  // ...but the post itself already shows its new score (M7 updates it straight away).
  assert.equal(soon.body.posts[1].score, 9);

  // 5 minutes after the last run, the scores are recalculated and the order updates.
  trendingRanker.setClock(() => Date.now() + TRENDING_MAX_AGE_MS);
  const later = await feed();
  assert.deepEqual(texts(later), ['Second', 'First']);
  assert.ok(new Date(later.body.rankedAt) > new Date(rankedAt));
  assert.equal(later.body.maxRankAgeSeconds, 300);
});

test('a scheduled run updates the stored scores without any feed request', async () => {
  const id = await newPost('Scheduled');
  await votes(id, 3);
  assert.equal((await Post.findById(id).lean()).trendingScore, 0, 'not ranked yet');
  await trendingRanker.recalculate();
  const stored = await Post.findById(id).lean();
  assert.ok(stored.trendingScore > 0);
});

test('"load more" pages through every post once, in the same order', async () => {
  for (let i = 0; i < 7; i += 1) {
    const id = await newPost(`Post ${i}`, { ageHours: i });
    if (i % 2 === 0) await votes(id, i + 1);
  }
  const all = await feed(viewer, '?limit=50');
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const res = await feed(viewer, `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.posts.length <= 3);
    seen.push(...texts(res));
    cursor = res.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(seen, texts(all));
  assert.equal(new Set(seen).size, 7);
});

test('a bad cursor is refused', async () => {
  for (const cursor of ['nope!', 'e30', Buffer.from('{"s":1,"c":1,"i":{"$gt":""}}').toString('base64url')]) {
    const res = await feed(viewer, `?cursor=${encodeURIComponent(cursor)}`);
    assert.equal(res.status, 400, cursor);
  }
});

test("each post has M6's shape, M7's votes and myVote, plus trendingScore", async () => {
  const id = await newPost('Shape check');
  await vote(viewer, id, 1);
  const res = await feed();
  const [post] = res.body.posts;
  assert.equal(post._id, id);
  assert.equal(post.author.name, 'Tara Trending');
  assert.equal(post.upvotes, 1);
  assert.equal(post.score, 1);
  assert.equal(post.myVote, 1);
  assert.equal(typeof post.trendingScore, 'number');
  assert.equal(post.isMine, false);
  assert.equal(JSON.stringify(post).includes('storageId'), false);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('a deleted post leaves the trending feed straight away', async () => {
  const id = await newPost('Short-lived');
  await votes(id, 4);
  assert.deepEqual(texts(await feed()), ['Short-lived']);
  assert.equal((await as(author).delete(`/api/posts/${id}`)).status, 200);
  assert.deepEqual(texts(await feed()), []);
});

test('NFR-1a: 100 users opening the feed at once (2,000 posts, first request also ranks) load within 3 s', async () => {
  const now = Date.now();
  const docs = Array.from({ length: 2000 }, (_, i) => {
    const upvotes = (i * 7) % 40;
    const downvotes = (i * 3) % 9;
    return {
      author: author.user.id,
      text: `Load test post ${i}`,
      upvotes,
      downvotes,
      score: upvotes - downvotes,
      createdAt: new Date(now - ((i * 13) % 96) * HOUR),
      updatedAt: new Date(now),
    };
  });
  await Post.insertMany(docs);
  trendingRanker.reset();

  const users = [viewer, author, ...voters];
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => feed(users[i % users.length])));
  const elapsed = performance.now() - started;

  assert.ok(results.every((res) => res.status === 200 && res.body.posts.length === 20));
  assert.ok(elapsed < 3000, `100 concurrent feed loads took ${elapsed.toFixed(0)} ms`);
  // and every one of them got the same, correctly ordered first page
  const firstPage = texts(results[0]);
  assert.ok(results.every((res) => JSON.stringify(texts(res)) === JSON.stringify(firstPage)));
  const scores = results[0].body.posts.map((p) => p.trendingScore);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a)
  );
});
