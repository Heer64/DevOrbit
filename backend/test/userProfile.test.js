// [Sprint 5 · M3] US-06 View another user's profile, US-07 Set privacy preferences.
// GET   /api/profile/users/:username   (login required)
// PATCH /api/profile/me                { profileDiscoverable, portfolioPublic }
// GET   /api/profile/people?q=         (collaborator search)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
let alice, bob;

const as = (account) => authed(app, account.token);
const names = (list) => list.map((item) => item.name);
const profileOf = (viewer, username) => as(viewer).get(`/api/profile/users/${encodeURIComponent(username)}`);

before(async () => {
  ({ app } = await setup());
  [alice, bob] = await Promise.all(['Alice Viewer', 'Bob Skilltag'].map((name) => signup(app, name)));
  const res = await as(bob).patch('/api/profile/me').send({ headline: 'Frontend developer', bio: 'I build calm interfaces.', skills: ['Svelte', 'CSS'] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

after(teardown);

test('US-06 AC1: a logged-in user sees another user\'s photo, bio, skill tags, follower count and score', async () => {
  const res = await profileOf(alice, bob.user.username);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { profile } = res.body;
  assert.equal(profile.name, 'Bob Skilltag');
  assert.equal(profile.username, bob.user.username);
  assert.equal(profile.bio, 'I build calm interfaces.');
  assert.equal(profile.headline, 'Frontend developer');
  assert.deepEqual(profile.skills, ['Svelte', 'CSS']);
  assert.equal(profile.avatarUrl, '');
  assert.equal(profile.followerCount, 0);
  assert.equal(profile.publicScore, 0);
  assert.equal(profile.isMe, false);
  assert.deepEqual(profile.portfolio, { available: true, path: `/portfolio/${bob.user.username}` });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('US-06 AC2: hidden fields are never exposed', async () => {
  const res = await profileOf(alice, bob.user.username);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes(bob.email), 'email is never sent');
  assert.ok(!text.includes(bob.user.id), 'the user ID is never sent');
  for (const field of ['email', 'passwordHash', 'loginFailedAttempts', 'loginLockedUntil', 'profileDiscoverable', 'portfolioPublic', '_id']) {
    assert.ok(!(field in res.body.profile), `${field} must not be sent`);
  }
});

test('US-06: a photo is shown once the user uploads one', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(996, 1)]);
  const upload = await request(app).post('/api/profile/me/avatar').set('Authorization', `Bearer ${bob.token}`).attach('avatar', jpeg, { filename: 'b.jpg', contentType: 'image/jpeg' });
  assert.equal(upload.status, 200, JSON.stringify(upload.body));
  const res = await profileOf(alice, bob.user.username);
  assert.equal(res.body.profile.avatarUrl, upload.body.user.avatarUrl);
});

test('US-06: usernames match without caring about case; unknown users are 404', async () => {
  const upper = await profileOf(alice, bob.user.username.toUpperCase());
  assert.equal(upper.status, 200);
  const missing = await profileOf(alice, 'nobody.here.123');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.message, 'User not found.');
  const bad = await profileOf(alice, 'bad name!');
  assert.equal(bad.status, 404);
});

test('US-06: opening your own profile says it is you', async () => {
  const res = await profileOf(bob, bob.user.username);
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.isMe, true);
});

test('US-06: the profile needs a login (Actor: Registered User)', async () => {
  const res = await request(app).get(`/api/profile/users/${bob.user.username}`);
  assert.equal(res.status, 401);
});

test('US-07 AC1: turning off "appear in collaborator search" hides me from skill-tag search', async () => {
  const listed = await as(alice).get('/api/profile/people?q=svelte');
  assert.deepEqual(names(listed.body.people), ['Bob Skilltag']);

  const off = await as(bob).patch('/api/profile/me').send({ profileDiscoverable: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.user.profileDiscoverable, false);

  for (const q of ['svelte', 'css', 'bob', '']) {
    const res = await as(alice).get(`/api/profile/people?q=${q}`);
    assert.ok(!names(res.body.people).includes('Bob Skilltag'), `hidden for q="${q}"`);
  }
  // The profile itself still opens from a direct link; only search is affected.
  assert.equal((await profileOf(alice, bob.user.username)).status, 200);

  const on = await as(bob).patch('/api/profile/me').send({ profileDiscoverable: true });
  assert.equal(on.status, 200);
  assert.deepEqual(names((await as(alice).get('/api/profile/people?q=svelte')).body.people), ['Bob Skilltag']);
});

test('US-07 AC2: turning off "public portfolio" makes the link say "not available"', async () => {
  const off = await as(bob).patch('/api/profile/me').send({ portfolioPublic: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.user.portfolioPublic, false);

  const shared = await request(app).get(`/api/public/portfolio/${bob.user.username}`);
  assert.equal(shared.status, 404);
  assert.equal(shared.body.message, 'This portfolio is not available.');

  const profile = await profileOf(alice, bob.user.username);
  assert.deepEqual(profile.body.profile.portfolio, { available: false, path: null });

  const on = await as(bob).patch('/api/profile/me').send({ portfolioPublic: true });
  assert.equal(on.status, 200);
  assert.equal((await request(app).get(`/api/public/portfolio/${bob.user.username}`)).status, 200);
  assert.equal((await profileOf(alice, bob.user.username)).body.profile.portfolio.available, true);
});

test('US-07: both settings are saved together and come back on /me', async () => {
  const res = await as(alice).patch('/api/profile/me').send({ profileDiscoverable: false, portfolioPublic: false });
  assert.equal(res.status, 200);
  const me = await as(alice).get('/api/profile/me');
  assert.equal(me.body.user.profileDiscoverable, false);
  assert.equal(me.body.user.portfolioPublic, false);
  await as(alice).patch('/api/profile/me').send({ profileDiscoverable: true, portfolioPublic: true });
});

test('US-07 / NFR-21: a privacy setting that is not true or false is refused and nothing is saved', async () => {
  for (const body of [{ profileDiscoverable: 'no' }, { portfolioPublic: 0 }, { portfolioPublic: null }, { profileDiscoverable: 'false', bio: 'changed' }]) {
    const res = await as(alice).patch('/api/profile/me').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.message, 'Privacy settings must be true or false.');
  }
  const me = await as(alice).get('/api/profile/me');
  assert.equal(me.body.user.profileDiscoverable, true);
  assert.equal(me.body.user.portfolioPublic, true);
  assert.notEqual(me.body.user.bio, 'changed');
});
