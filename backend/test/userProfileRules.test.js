// [Sprint 5 · M3] US-06 / US-07 profile rules (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIVACY_SETTINGS,
  PROFILE_FIELDS,
  badPrivacySetting,
  portfolioPathOf,
  profileView,
} from '../src/lib/userProfileRules.js';

const USER_ID = 'u'.repeat(24);
const user = (overrides = {}) => ({
  _id: USER_ID,
  name: 'Bob Reactdev',
  username: 'bob.reactdev',
  email: 'bob@example.com',
  passwordHash: 'secret-hash',
  loginFailedAttempts: 2,
  headline: 'Frontend developer',
  bio: 'I build calm interfaces.',
  avatarUrl: '/uploads/avatars/abc.png',
  skills: ['React', 'CSS'],
  githubUrl: 'https://github.com/bob',
  focus: 'Design systems',
  profileDiscoverable: false,
  portfolioPublic: true,
  ...overrides,
});

test('US-06 AC1: the profile shows photo, bio, skill tags, follower count and public score', () => {
  const view = profileView(user(), { followerCount: 4, publicScore: 12 }, 'v'.repeat(24));
  assert.equal(view.name, 'Bob Reactdev');
  assert.equal(view.username, 'bob.reactdev');
  assert.equal(view.avatarUrl, '/uploads/avatars/abc.png');
  assert.equal(view.bio, 'I build calm interfaces.');
  assert.deepEqual(view.skills, ['React', 'CSS']);
  assert.equal(view.followerCount, 4);
  assert.equal(view.publicScore, 12);
  assert.equal(view.isMe, false);
});

test('US-06 AC2: hidden fields are never in the view (allow-list only)', () => {
  const view = profileView(user(), {}, null);
  assert.deepEqual(Object.keys(view).sort(), [
    'avatarUrl', 'bio', 'followerCount', 'headline', 'isMe', 'name', 'portfolio', 'publicScore', 'skills', 'username',
  ]);
  const text = JSON.stringify(view);
  for (const secret of ['bob@example.com', 'secret-hash', USER_ID, 'Design systems', 'profileDiscoverable', 'portfolioPublic']) {
    assert.ok(!text.includes(secret), `${secret} must not be sent`);
  }
});

test('US-06: only the needed fields are read from the database', () => {
  const fields = PROFILE_FIELDS.split(' ');
  for (const secret of ['email', 'passwordHash', 'loginFailedAttempts', 'loginLockedUntil', 'profileDiscoverable']) {
    assert.ok(!fields.includes(secret), `${secret} must not be loaded`);
  }
});

test('US-07 AC2: a public portfolio is linked, a private one is "not available" with no link', () => {
  assert.deepEqual(profileView(user({ portfolioPublic: true })).portfolio, { available: true, path: '/portfolio/bob.reactdev' });
  assert.deepEqual(profileView(user({ portfolioPublic: false })).portfolio, { available: false, path: null });
  // Accounts saved before the switch existed count as public (the model default).
  assert.equal(profileView(user({ portfolioPublic: undefined })).portfolio.available, true);
});

test('US-06: empty or missing fields come back as safe defaults', () => {
  const view = profileView({ _id: USER_ID, name: 'New Person', username: 'new.person' });
  assert.equal(view.headline, '');
  assert.equal(view.bio, '');
  assert.equal(view.avatarUrl, '');
  assert.deepEqual(view.skills, []);
  assert.equal(view.followerCount, 0);
  assert.equal(view.publicScore, 0);
});

test('FR-26: follower count is a whole number of 0 or more; the score may be negative', () => {
  assert.equal(profileView(user(), { followerCount: -3, publicScore: -5 }).followerCount, 0);
  assert.equal(profileView(user(), { followerCount: 'x', publicScore: 'x' }).followerCount, 0);
  assert.equal(profileView(user(), { followerCount: 2.7 }).followerCount, 2);
  assert.equal(profileView(user(), { publicScore: -5 }).publicScore, -5);
  assert.equal(profileView(user(), { publicScore: 'x' }).publicScore, 0);
});

test('isMe is true only for the viewer\'s own profile', () => {
  assert.equal(profileView(user(), {}, USER_ID).isMe, true);
  assert.equal(profileView(user(), {}, 'v'.repeat(24)).isMe, false);
  assert.equal(profileView(user(), {}).isMe, false);
});

test('US-07: privacy switches must be true or false', () => {
  assert.deepEqual(PRIVACY_SETTINGS, ['profileDiscoverable', 'portfolioPublic']);
  assert.equal(badPrivacySetting({}), null);
  assert.equal(badPrivacySetting({ profileDiscoverable: false, portfolioPublic: true }), null);
  assert.equal(badPrivacySetting({ bio: 'not a setting' }), null);
  assert.equal(badPrivacySetting({ profileDiscoverable: 'no' }), 'profileDiscoverable');
  assert.equal(badPrivacySetting({ portfolioPublic: 0 }), 'portfolioPublic');
  assert.equal(badPrivacySetting({ portfolioPublic: null }), 'portfolioPublic');
});

test('portfolio links are URL-safe', () => {
  assert.equal(portfolioPathOf('max_member'), '/portfolio/max_member');
  assert.equal(portfolioPathOf('a b'), '/portfolio/a%20b');
});
