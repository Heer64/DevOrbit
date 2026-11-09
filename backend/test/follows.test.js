// [Sprint 5 · M8] US-54 Follow users and see public counts (FR-26) against a real MongoDB.
// Follower count and "total vote score" (sum of net post scores, never "likes") on the profile.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Follow from '../src/models/Follow.js';
import Post from '../src/models/Post.js';
import PostCreateLog from '../src/models/PostCreateLog.js';
import PostVote from '../src/models/PostVote.js';
import PostVoteLog from '../src/models/PostVoteLog.js';
import User from '../src/models/User.js';
import { FOLLOW_SELF_MESSAGE } from '../src/lib/followRules.js';

let app;
let alice, bob, carol, dave, hidden;

const as = (account) => authed(app, account.token);
const followUrl = (account) => `/api/profile/users/${encodeURIComponent(account.user.username)}/follow`;
const doFollow = (who, target) => request(app).put(followUrl(target)).set('Authorization', `Bearer ${who.token}`);
const doUnfollow = (who, target) => as(who).delete(followUrl(target));
const profileOf = async (viewer, target) => {
  const res = await as(viewer).get(`/api/profile/users/${encodeURIComponent(target.user.username)}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.profile;
};
const vote = (account, postId, value) =>
  request(app).put(`/api/posts/${postId}/vote`).set('Authorization', `Bearer ${account.token}`).send({ value });
async function newPost(account, text) {
  await PostCreateLog.deleteMany({ user: account.user.id });
  const res = await as(account).post('/api/posts').send({ text });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.post._id;
}

before(async () => {
  ({ app } = await setup());
  [alice, bob, carol, dave, hidden] = await Promise.all(
    ['Alice Author', 'Bob Builder', 'Carol Coder', 'Dave Dev', 'Hana Hidden'].map((name) => signup(app, name))
  );
});

beforeEach(async () => {
  await Promise.all([Follow.deleteMany({}), Post.deleteMany({}), PostVote.deleteMany({}), PostVoteLog.deleteMany({})]);
});

after(teardown);

// --- Follow / unfollow --------------------------------------------------------------------------

test('login is required', async () => {
  assert.equal((await request(app).put(followUrl(bob))).status, 401);
  assert.equal((await request(app).delete(followUrl(bob))).status, 401);
});

test('AC1: following someone raises their follower count by one; the profile shows it', async () => {
  const before = await profileOf(alice, bob);
  assert.equal(before.followerCount, 0);
  assert.equal(before.isFollowing, false);

  const res = await doFollow(alice, bob);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { following: true, changed: true, followerCount: 1, message: 'You are now following Bob Builder.' });

  const after = await profileOf(alice, bob);
  assert.equal(after.followerCount, 1);
  assert.equal(after.isFollowing, true);
  // Everyone sees the same public count; only Alice "is following".
  const seenByCarol = await profileOf(carol, bob);
  assert.equal(seenByCarol.followerCount, 1);
  assert.equal(seenByCarol.isFollowing, false);
});

test('AC2: unfollowing lowers the follower count by one', async () => {
  await doFollow(alice, bob);
  await doFollow(carol, bob);
  assert.equal((await profileOf(dave, bob)).followerCount, 2);

  const res = await doUnfollow(alice, bob);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { following: false, changed: true, followerCount: 1, message: 'You unfollowed Bob Builder.' });
  const after = await profileOf(alice, bob);
  assert.equal(after.followerCount, 1);
  assert.equal(after.isFollowing, false);
});

test('following twice never counts twice; unfollowing twice is harmless', async () => {
  await doFollow(alice, bob);
  const again = await doFollow(alice, bob);
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  assert.equal(again.body.followerCount, 1);
  assert.match(again.body.message, /already follow/);
  assert.equal(await Follow.countDocuments({}), 1);

  await doUnfollow(alice, bob);
  const twice = await doUnfollow(alice, bob);
  assert.equal(twice.status, 200);
  assert.equal(twice.body.changed, false);
  assert.equal(twice.body.followerCount, 0);
});

test('20 simultaneous Follow requests from one user store one follow', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => doFollow(alice, bob)));
  assert.ok(
    results.every((res) => res.status === 200),
    JSON.stringify(results.map((r) => r.status))
  );
  assert.equal(results.filter((res) => res.body.changed).length, 1, 'exactly one request created it');
  assert.equal(await Follow.countDocuments({ following: bob.user.id }), 1);
  assert.equal((await profileOf(carol, bob)).followerCount, 1);
});

test('simultaneous follows from different users all count', async () => {
  await Promise.all([alice, carol, dave, hidden].map((who) => doFollow(who, bob)));
  assert.equal((await profileOf(bob, bob)).followerCount, 4);
});

test('simultaneous unfollows remove the follow once', async () => {
  await doFollow(alice, bob);
  const results = await Promise.all(Array.from({ length: 10 }, () => doUnfollow(alice, bob)));
  assert.equal(results.filter((res) => res.body.changed).length, 1);
  assert.equal(await Follow.countDocuments({}), 0);
});

test('you cannot follow yourself', async () => {
  const res = await doFollow(alice, alice);
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { message: FOLLOW_SELF_MESSAGE, code: 'self_follow' });
  assert.equal(await Follow.countDocuments({}), 0);
  const own = await profileOf(alice, alice);
  assert.equal(own.isMe, true);
  assert.equal(own.isFollowing, false);
});

test('unknown or invalid usernames: 404, nothing stored', async () => {
  for (const name of ['no-such-user-xyz', '%24where', 'a%20b']) {
    const res = await request(app).put(`/api/profile/users/${name}/follow`).set('Authorization', `Bearer ${alice.token}`);
    assert.equal(res.status, 404, name);
    assert.equal(res.body.message, 'User not found.');
  }
  assert.equal(await Follow.countDocuments({}), 0);
});

test('following one direction does not change the other: counts are per user', async () => {
  await doFollow(alice, bob);
  assert.equal((await profileOf(carol, alice)).followerCount, 0, 'Alice follows Bob, Bob does not follow Alice');
  await doFollow(bob, alice);
  assert.equal((await profileOf(carol, alice)).followerCount, 1);
  assert.equal((await profileOf(carol, bob)).followerCount, 1);
});

test('privacy: a user hidden from collaborator search can still be followed from their profile link (M3 rule)', async () => {
  await User.updateOne({ _id: hidden.user.id }, { $set: { profileDiscoverable: false } });
  const res = await doFollow(alice, hidden);
  assert.equal(res.status, 200);
  assert.equal(res.body.followerCount, 1);
  // ...and is still not in search results
  const search = await as(alice).get('/api/profile/people?q=Hana');
  assert.equal(
    search.body.people.some((p) => p.username === hidden.user.username),
    false
  );
});

test('privacy: answers never contain IDs, emails or follower lists', async () => {
  await doFollow(alice, bob);
  const res = await doFollow(carol, bob);
  const profile = await profileOf(carol, bob);
  const text = JSON.stringify([res.body, profile]);
  for (const secret of [alice.user.id, bob.user.id, carol.user.id, alice.email, bob.email, 'Alice']) {
    assert.equal(text.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal('followers' in profile, false, 'no list of followers');
  assert.deepEqual(Object.keys(res.body).sort(), ['changed', 'followerCount', 'following', 'message']);
});

// --- Total vote score --------------------------------------------------------------------------

test('AC3: the profile shows the total vote score = sum of net post scores (not upvotes, not "likes")', async () => {
  const p1 = await newPost(alice, 'Loved');
  const p2 = await newPost(alice, 'Mixed');
  const p3 = await newPost(alice, 'Disliked');
  await newPost(bob, "Not Alice's"); // other users' posts never count
  // p1: +3 ; p2: +2 -1 = +1 ; p3: -2  -> total 2 (while total upvotes would be 5)
  for (const who of [bob, carol, dave]) assert.equal((await vote(who, p1, 1)).status, 200);
  await vote(bob, p2, 1);
  await vote(carol, p2, 1);
  await vote(dave, p2, -1);
  await vote(bob, p3, -1);
  await vote(carol, p3, -1);

  const profile = await profileOf(bob, alice);
  assert.equal(profile.publicScore, 2);
  assert.equal(JSON.stringify(profile).toLowerCase().includes('like'), false);
  assert.equal((await profileOf(alice, bob)).publicScore, 0);
});

test('total vote score follows votes changing, retracting and posts being deleted', async () => {
  const p1 = await newPost(alice, 'One');
  const p2 = await newPost(alice, 'Two');
  await vote(bob, p1, 1);
  await vote(carol, p2, 1);
  assert.equal((await profileOf(dave, alice)).publicScore, 2);

  await vote(bob, p1, -1); // change: +1 -> -1
  assert.equal((await profileOf(dave, alice)).publicScore, 0);
  await request(app).delete(`/api/posts/${p1}/vote`).set('Authorization', `Bearer ${bob.token}`); // retract
  assert.equal((await profileOf(dave, alice)).publicScore, 1);
  await as(alice).delete(`/api/posts/${p2}`); // US-51: its votes no longer count
  assert.equal((await profileOf(dave, alice)).publicScore, 0);
});

test('a user with no posts has a total vote score of 0; the score can be negative', async () => {
  assert.equal((await profileOf(alice, dave)).publicScore, 0);
  const p = await newPost(dave, 'Unpopular');
  await vote(alice, p, -1);
  await vote(bob, p, -1);
  assert.equal((await profileOf(alice, dave)).publicScore, -2);
});
