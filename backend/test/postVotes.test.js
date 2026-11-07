// [Sprint 5 · M7] US-52 Vote on a post (FR-24, NFR-13, NFR-14, NFR-16) against a real MongoDB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Post from '../src/models/Post.js';
import PostCreateLog from '../src/models/PostCreateLog.js';
import PostVote from '../src/models/PostVote.js';
import PostVoteLog from '../src/models/PostVoteLog.js';
import { recountPostVotes } from '../src/lib/postVotes.js';
import {
  VOTES_PER_MINUTE,
  VOTE_CAST_MESSAGE,
  VOTE_CHANGED_MESSAGE,
  VOTE_NOTHING_TO_RETRACT_MESSAGE,
  VOTE_RETRACTED_MESSAGE,
  VOTE_UNCHANGED_MESSAGE,
  VOTE_VALUE_MESSAGE,
} from '../src/lib/voteRules.js';

let app;
let author, voter, other, flipper, spammer, burster;

const as = (account) => authed(app, account.token);
const vote = (account, postId, value) => request(app)
  .put(`/api/posts/${postId}/vote`)
  .set('Authorization', `Bearer ${account.token}`)
  .send({ value });
const unvote = (account, postId) => request(app)
  .delete(`/api/posts/${postId}/vote`)
  .set('Authorization', `Bearer ${account.token}`);

const counters = async (postId) => {
  const post = await Post.findById(postId).select('upvotes downvotes score').lean();
  return { upvotes: post.upvotes, downvotes: post.downvotes, score: post.score };
};
const newPost = async (account = author, text = 'Vote on me') => {
  // This file creates more than 10 posts. The M6 limit (10 posts per hour, tested in posts.test.js)
  // is not what is tested here, so the author's post-limit slots are cleared first.
  await PostCreateLog.deleteMany({ user: account.user.id });
  const res = await as(account).post('/api/posts').send({ text });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.post._id;
};
// A post's counters must always equal what its vote rows say.
const assertConsistent = async (postId) => {
  const stored = await counters(postId);
  const rows = await PostVote.find({ post: postId }).lean();
  const upvotes = rows.filter((row) => row.value === 1).length;
  const downvotes = rows.filter((row) => row.value === -1).length;
  assert.deepEqual(stored, { upvotes, downvotes, score: upvotes - downvotes });
};

before(async () => {
  ({ app } = await setup());
  [author, voter, other, flipper, spammer, burster] = await Promise.all(
    ['Asha Author', 'Vik Voter', 'Ola Other', 'Fin Flipper', 'Sam Spammer', 'Bea Burster'].map((name) => signup(app, name))
  );
});

after(async () => {
  await teardown();
});

test('voting needs a login (NFR-19)', async () => {
  const postId = await newPost();
  assert.equal((await request(app).put(`/api/posts/${postId}/vote`).send({ value: 1 })).status, 401);
  assert.equal((await request(app).delete(`/api/posts/${postId}/vote`)).status, 401);
  assert.deepEqual(await counters(postId), { upvotes: 0, downvotes: 0, score: 0 });
});

test('US-52 AC1: a first upvote or downvote changes the score by one', async () => {
  const postId = await newPost();

  const up = await vote(voter, postId, 1);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.outcome, 'cast');
  assert.equal(up.body.message, VOTE_CAST_MESSAGE);
  assert.equal(up.body.vote, 1);
  assert.equal(up.body.previous, 0);
  assert.equal(up.body.post._id, postId);
  assert.equal(up.body.post.score, 1);
  assert.equal(up.body.post.upvotes, 1);
  assert.equal(up.body.post.myVote, 1);
  assert.equal(up.body.post.author.name, 'Asha Author');

  const down = await vote(other, postId, -1);
  assert.equal(down.status, 200);
  assert.equal(down.body.outcome, 'cast');
  assert.equal(down.body.post.score, 0);
  assert.equal(down.body.post.downvotes, 1);
  assert.equal(down.body.post.myVote, -1);

  assert.deepEqual(await counters(postId), { upvotes: 1, downvotes: 1, score: 0 });
  await assertConsistent(postId);
});

test('US-52 AC2: voting the same way again is accepted once, so the score does not change', async () => {
  const postId = await newPost();
  assert.equal((await vote(voter, postId, 1)).body.post.score, 1);

  const again = await vote(voter, postId, 1);
  assert.equal(again.status, 200);
  assert.equal(again.body.outcome, 'unchanged');
  assert.equal(again.body.message, VOTE_UNCHANGED_MESSAGE);
  assert.equal(again.body.post.score, 1);
  assert.equal(again.body.post.myVote, 1);
  assert.equal(await PostVote.countDocuments({ post: postId, user: voter.user.id }), 1);

  // Same for a downvote.
  await vote(other, postId, -1);
  const downAgain = await vote(other, postId, -1);
  assert.equal(downAgain.body.outcome, 'unchanged');
  assert.deepEqual(await counters(postId), { upvotes: 1, downvotes: 1, score: 0 });
});

test('NFR-13: the same vote sent 10 times at the same moment is counted once', async () => {
  const postId = await newPost();
  const results = await Promise.all(Array.from({ length: 10 }, () => vote(voter, postId, 1)));
  assert.ok(results.every((res) => res.status === 200), results.map((res) => res.status).join(','));
  assert.equal(results.filter((res) => res.body.outcome === 'cast').length, 1);
  assert.equal(results.filter((res) => res.body.outcome === 'unchanged').length, 9);
  assert.deepEqual(await counters(postId), { upvotes: 1, downvotes: 0, score: 1 });
  assert.equal(await PostVote.countDocuments({ post: postId }), 1);
});

test('FR-24: a user can change a vote (up -> down -> up) and the score follows', async () => {
  const postId = await newPost();
  await vote(voter, postId, 1);

  const changed = await vote(voter, postId, -1);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.outcome, 'changed');
  assert.equal(changed.body.message, VOTE_CHANGED_MESSAGE);
  assert.equal(changed.body.previous, 1);
  assert.equal(changed.body.vote, -1);
  assert.deepEqual(await counters(postId), { upvotes: 0, downvotes: 1, score: -1 });

  const back = await vote(voter, postId, 1);
  assert.equal(back.body.outcome, 'changed');
  assert.deepEqual(await counters(postId), { upvotes: 1, downvotes: 0, score: 1 });
  assert.equal(await PostVote.countDocuments({ post: postId, user: voter.user.id }), 1, 'still one active vote');
});

test('FR-24: a user can retract a vote with DELETE or with value 0', async () => {
  const postId = await newPost();
  await vote(voter, postId, 1);
  await vote(other, postId, -1);

  const removed = await unvote(voter, postId);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.outcome, 'retracted');
  assert.equal(removed.body.message, VOTE_RETRACTED_MESSAGE);
  assert.equal(removed.body.vote, 0);
  assert.equal(removed.body.post.myVote, 0);
  assert.deepEqual(await counters(postId), { upvotes: 0, downvotes: 1, score: -1 });

  const zero = await vote(other, postId, 0);
  assert.equal(zero.body.outcome, 'retracted');
  assert.deepEqual(await counters(postId), { upvotes: 0, downvotes: 0, score: 0 });
  assert.equal(await PostVote.countDocuments({ post: postId }), 0);

  // Retracting again: nothing to retract, nothing changes.
  const nothing = await unvote(voter, postId);
  assert.equal(nothing.status, 200);
  assert.equal(nothing.body.outcome, 'unchanged');
  assert.equal(nothing.body.message, VOTE_NOTHING_TO_RETRACT_MESSAGE);
  assert.deepEqual(await counters(postId), { upvotes: 0, downvotes: 0, score: 0 });
});

test('US-52 AC3 / NFR-14: many users voting on one post at the same moment are each counted exactly once', async () => {
  const postId = await newPost(author, 'Popular post');
  const crowd = await Promise.all(Array.from({ length: 24 }, (_, index) => signup(app, `Crowd ${index}`)));
  const ups = crowd.slice(0, 16);
  const downs = crowd.slice(16);

  const results = await Promise.all([
    ...ups.map((account) => vote(account, postId, 1)),
    ...downs.map((account) => vote(account, postId, -1)),
  ]);
  assert.ok(results.every((res) => res.status === 200), results.map((res) => res.status).join(','));
  assert.ok(results.every((res) => res.body.outcome === 'cast'));
  assert.deepEqual(await counters(postId), { upvotes: 16, downvotes: 8, score: 8 });
  assert.equal(await PostVote.countDocuments({ post: postId }), 24);

  // A second wave at the same moment: every up-voter switches to down and every down-voter retracts.
  await Promise.all([
    ...ups.map((account) => vote(account, postId, -1)),
    ...downs.map((account) => unvote(account, postId)),
  ]);
  assert.deepEqual(await counters(postId), { upvotes: 0, downvotes: 16, score: -16 });
  await assertConsistent(postId);
});

test('NFR-14: one user flipping a vote many times at once still leaves exactly one vote and a correct score', async () => {
  const postId = await newPost();
  const values = [1, -1, 0, 1, -1, 1, 0, -1, 1, 1, -1, 0, 1, -1, 1, 0, -1, 1, 1, -1];
  const results = await Promise.all(values.map((value) => vote(flipper, postId, value)));
  assert.ok(results.every((res) => res.status === 200), results.map((res) => res.status).join(','));
  assert.ok(await PostVote.countDocuments({ post: postId, user: flipper.user.id }) <= 1);
  await assertConsistent(postId);
  const { score } = await counters(postId);
  assert.ok([-1, 0, 1].includes(score), `one user can move the score by at most one, got ${score}`);
});

test('the feed and a single post show the viewer their own vote (myVote)', async () => {
  const postId = await newPost(author, 'Check my vote');
  await vote(voter, postId, -1);

  const mine = await as(voter).get(`/api/posts/${postId}`);
  assert.equal(mine.body.post.myVote, -1);
  assert.equal(mine.body.post.score, -1);

  const theirs = await as(other).get(`/api/posts/${postId}`);
  assert.equal(theirs.body.post.myVote, 0);
  assert.equal(theirs.body.post.score, -1);

  const feed = await as(voter).get('/api/posts?limit=50');
  const inFeed = feed.body.posts.find((post) => post._id === postId);
  assert.equal(inFeed.myVote, -1);
  assert.equal(inFeed.downvotes, 1);
  assert.ok(feed.body.posts.every((post) => [1, -1, 0].includes(post.myVote)));

  // Editing the text keeps the votes.
  const edited = await as(author).patch(`/api/posts/${postId}`).send({ text: 'Check my vote (edited)' });
  assert.equal(edited.body.post.score, -1);
});

test('a user may vote on their own post', async () => {
  const postId = await newPost(author, 'My own post');
  const res = await vote(author, postId, 1);
  assert.equal(res.status, 200);
  assert.equal(res.body.post.isMine, true);
  assert.equal(res.body.post.score, 1);
});

test('only 1, -1 or 0 are accepted; bad IDs and unknown posts are refused', async () => {
  const postId = await newPost();
  for (const value of [2, -2, 0.5, '1', 'up', true, null]) {
    const res = await vote(voter, postId, value);
    assert.equal(res.status, 400, `value ${JSON.stringify(value)}`);
    assert.equal(res.body.message, VOTE_VALUE_MESSAGE);
  }
  const missingValue = await request(app).put(`/api/posts/${postId}/vote`).set('Authorization', `Bearer ${voter.token}`).send({});
  assert.equal(missingValue.status, 400);
  assert.deepEqual(await counters(postId), { upvotes: 0, downvotes: 0, score: 0 });

  assert.equal((await vote(voter, 'not-an-id', 1)).status, 400);
  const missing = new mongoose.Types.ObjectId().toString();
  const unknown = await vote(voter, missing, 1);
  assert.equal(unknown.status, 404);
  assert.equal(await PostVote.countDocuments({ post: missing }), 0);
});

test('US-51 AC2 with votes: deleting a post removes its votes and it can no longer be voted on', async () => {
  const postId = await newPost(author, 'Going away');
  await vote(voter, postId, 1);
  await vote(other, postId, -1);
  assert.equal(await PostVote.countDocuments({ post: postId }), 2);

  assert.equal((await as(author).delete(`/api/posts/${postId}`)).status, 200);
  assert.equal(await PostVote.countDocuments({ post: postId }), 0);
  assert.equal((await vote(voter, postId, -1)).status, 404);
  assert.equal((await unvote(other, postId)).status, 404);
});

test('NFR-16: the 31st vote in a minute is refused with a rate-limit message', async () => {
  const postId = await newPost(author, 'Rate limit target');
  for (let index = 1; index <= VOTES_PER_MINUTE; index += 1) {
    const res = await vote(spammer, postId, index % 2 ? 1 : -1);
    assert.equal(res.status, 200, `vote ${index}: ${JSON.stringify(res.body)}`);
  }
  const before31 = await counters(postId);

  const blocked = await vote(spammer, postId, 1);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'vote_rate_limited');
  assert.match(blocked.body.message, /^You can vote up to 30 times per minute\. Please try again in \d+ seconds?\.$/);
  assert.ok(blocked.body.retryAfterSeconds > 0 && blocked.body.retryAfterSeconds <= 60);
  assert.equal(blocked.headers['retry-after'], String(blocked.body.retryAfterSeconds));
  assert.deepEqual(await counters(postId), before31, 'a refused vote changes nothing');
  assert.equal((await unvote(spammer, postId)).status, 429, 'retracting counts as a vote request too');
  assert.equal(await PostVoteLog.countDocuments({ user: spammer.user.id }), VOTES_PER_MINUTE, 'refused requests give their slot back');

  // Other users are not affected.
  assert.equal((await vote(other, postId, 1)).status, 200);

  // A minute later the user can vote again.
  await PostVoteLog.updateMany({ user: spammer.user.id }, { $set: { createdAt: new Date(Date.now() - 61 * 1000) } });
  assert.equal((await vote(spammer, postId, 0)).status, 200);
  await assertConsistent(postId);
});

test('NFR-16: votes sent at the same moment never go over 30 in a minute', async () => {
  const postIds = await Promise.all([1, 2, 3].map((index) => newPost(author, `Burst ${index}`)));
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) => vote(burster, postIds[index % 3], index % 2 ? 1 : -1)));
  const statuses = results.map((res) => res.status);
  assert.ok(statuses.every((status) => status === 200 || status === 429), statuses.join(','));
  assert.ok(statuses.filter((status) => status === 200).length <= VOTES_PER_MINUTE);
  assert.ok(await PostVoteLog.countDocuments({ user: burster.user.id }) <= VOTES_PER_MINUTE);
  for (const postId of postIds) await assertConsistent(postId);
});

test('recountPostVotes gives the same counters as the live updates', async () => {
  const postId = await newPost(author, 'Recount me');
  await vote(voter, postId, 1);
  await vote(other, postId, 1);
  await vote(flipper, postId, -1);
  const live = await counters(postId);
  assert.deepEqual(await recountPostVotes(postId), live);
  assert.deepEqual(await counters(postId), { upvotes: 2, downvotes: 1, score: 1 });
});
