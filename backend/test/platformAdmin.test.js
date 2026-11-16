// [Sprint 6 · M8] US-57 assign/revoke moderators and US-58 suspend/reactivate accounts (FR-27, NFR-19, NFR-21)
// against a real MongoDB, through the real API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';
import { PLATFORM_MESSAGES } from '../src/lib/platformRoleRules.js';

let app;
let admin, secondAdmin, alice, bob;

const as = (account) => authed(app, account.token);
const setRole = (actor, target, role) => as(actor).patch(`/api/admin/users/${target.user.id}/role`).send({ role });
const suspend = (actor, target) => as(actor).post(`/api/admin/users/${target.user.id}/suspend`);
const reactivate = (actor, target) => as(actor).post(`/api/admin/users/${target.user.id}/reactivate`);
const moderatorAccess = (account) => as(account).get('/api/moderation/access');
const login = (account, password = account.password) => request(app).post('/api/auth/login').send({ email: account.email, password });
const refresh = (account) => request(app).post('/api/auth/refresh').set('Cookie', account.cookies);
const storedRole = async (account) => (await User.findById(account.user.id).lean()).platformRole;

// Platform Admins never come from the API (FR-27: seed script or environment). In tests the role is set directly.
async function makeAdmin(account) {
  await User.updateOne({ _id: account.user.id }, { $set: { platformRole: 'admin' } });
  return account;
}

// A fresh normal account for tests that change it.
const freshUser = (name) => signup(app, name);

before(async () => {
  ({ app } = await setup());
  [admin, secondAdmin, alice, bob] = await Promise.all(
    ['Asha Admin', 'Arjun Admin', 'Alice Member', 'Bob Member'].map((name) => signup(app, name))
  );
  await makeAdmin(admin);
  await makeAdmin(secondAdmin);
});

after(async () => {
  await teardown();
});

// --- US-57 Assign and revoke moderators -----------------------------------------------------------

test('new accounts are normal users, and the app is told the role at login, refresh and /me', async () => {
  const fresh = await freshUser('Nina New');
  assert.equal(fresh.user.platformRole, 'user');
  assert.equal(await storedRole(fresh), 'user');
  assert.equal((await as(fresh).get('/api/auth/me')).body.user.platformRole, 'user');

  const asAdmin = await login(admin);
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.body.user.platformRole, 'admin');
  assert.equal((await refresh(admin)).body.user.platformRole, 'admin');
});

test('AC3: a user who is not a Platform Admin cannot change roles (403), and nothing changes', async () => {
  const target = await freshUser('Tara Target');
  const res = await setRole(alice, target, 'moderator');
  assert.equal(res.status, 403);
  assert.equal(res.body.message, PLATFORM_MESSAGES.adminOnly);
  assert.equal(await storedRole(target), 'user');

  // Not even a Content Moderator: only Platform Admins appoint moderators.
  const moderator = await freshUser('Mo Moderator');
  assert.equal((await setRole(admin, moderator, 'moderator')).status, 200);
  assert.equal((await setRole(moderator, target, 'moderator')).status, 403);
  assert.equal((await setRole(moderator, moderator, 'user')).status, 403, 'nor remove their own role through the admin API');
  assert.equal(await storedRole(target), 'user');
  assert.equal(await storedRole(moderator), 'moderator');

  // A user cannot make themselves moderator, and without a login it is 401.
  assert.equal((await setRole(alice, alice, 'moderator')).status, 403);
  assert.equal((await request(app).patch(`/api/admin/users/${target.user.id}/role`).send({ role: 'moderator' })).status, 401);
  assert.equal(await storedRole(alice), 'user');
});

test('AC1: once granted, the user can use moderator routes on their NEXT request, with the same login', async () => {
  const user = await freshUser('Gita Granted');
  const before = await moderatorAccess(user);
  assert.equal(before.status, 403);
  assert.equal(before.body.message, PLATFORM_MESSAGES.moderatorOnly);

  const res = await setRole(admin, user, 'moderator');
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, true);
  assert.equal(res.body.message, 'Gita Granted is now a Content Moderator.');
  assert.equal(res.body.user.platformRole, 'moderator');
  assert.equal(res.body.user.roleLabel, 'Content Moderator');

  // Same access token as before: no new login, no refresh.
  const after = await moderatorAccess(user);
  assert.equal(after.status, 200);
  assert.deepEqual(after.body, { canModerate: true, platformRole: 'moderator', roleLabel: 'Content Moderator' });
  assert.equal((await as(user).get('/api/auth/me')).body.user.platformRole, 'moderator');
});

test('AC2: once revoked, the next request to a moderator route is refused (403)', async () => {
  const user = await freshUser('Ravi Revoked');
  await setRole(admin, user, 'moderator');
  assert.equal((await moderatorAccess(user)).status, 200);

  const res = await setRole(admin, user, 'user');
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, true);
  assert.equal(res.body.message, 'Ravi Revoked is no longer a Content Moderator.');

  const after = await moderatorAccess(user);
  assert.equal(after.status, 403);
  assert.equal(await storedRole(user), 'user');
});

test('granting or revoking twice is safe (changed: false); another admin sees the same state', async () => {
  const user = await freshUser('Dina Double');
  assert.equal((await setRole(admin, user, 'moderator')).body.changed, true);
  const again = await setRole(secondAdmin, user, 'moderator');
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  assert.equal(again.body.message, 'Dina Double is already a Content Moderator.');
  assert.equal((await setRole(admin, user, 'user')).body.changed, true);
  assert.equal((await setRole(admin, user, 'user')).body.changed, false);
});

test('Platform Admins have moderator rights too, and their role cannot be changed through the API', async () => {
  assert.equal((await moderatorAccess(admin)).status, 200);

  const res = await setRole(admin, secondAdmin, 'user');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'admin_locked');
  assert.equal(res.body.message, PLATFORM_MESSAGES.adminRoleLocked);
  assert.equal((await setRole(admin, admin, 'moderator')).status, 409, 'not even their own');
  assert.equal(await storedRole(secondAdmin), 'admin');

  const promote = await setRole(admin, alice, 'admin');
  assert.equal(promote.status, 400);
  assert.equal(promote.body.message, PLATFORM_MESSAGES.adminRoleNotAssignable);
  assert.equal(await storedRole(alice), 'user');
});

test('role changes are validated before anything is stored (NFR-21)', async () => {
  for (const body of [{}, { role: '' }, { role: 'Moderator' }, { role: ['moderator'] }, { role: { $ne: 'user' } }]) {
    const res = await as(admin).patch(`/api/admin/users/${bob.user.id}/role`).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.field, 'role');
  }
  assert.equal((await as(admin).patch('/api/admin/users/not-an-id/role').send({ role: 'moderator' })).status, 400);
  const missing = await as(admin).patch(`/api/admin/users/${new mongoose.Types.ObjectId()}/role`).send({ role: 'moderator' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.message, PLATFORM_MESSAGES.userNotFound);
  assert.equal(await storedRole(bob), 'user');
});

// --- US-58 Suspend and reactivate accounts ----------------------------------------------------------

test('AC1: suspending refuses the existing session at once, ends every session, and blocks login', async () => {
  const user = await freshUser('Sam Suspended');
  // A second device: another login, another session.
  const phone = await login(user);
  assert.equal(phone.status, 200);
  assert.equal(await Session.countDocuments({ user: user.user.id }), 2);
  assert.equal((await as(user).get('/api/auth/me')).status, 200);

  const res = await suspend(admin, user);
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, true);
  assert.equal(res.body.sessionsEnded, 2);
  assert.equal(res.body.message, 'Sam Suspended is suspended and has been logged out everywhere.');
  assert.equal(res.body.user.suspended, true);
  assert.ok(res.body.user.suspendedAt);

  // Existing sessions: both access tokens and the refresh cookie are refused.
  assert.equal(await Session.countDocuments({ user: user.user.id }), 0);
  assert.equal((await as(user).get('/api/auth/me')).status, 401);
  assert.equal((await authed(app, phone.body.accessToken).get('/api/projects')).status, 401);
  assert.equal((await refresh(user)).status, 401);

  // A new login with the right password is refused with a clear message.
  const again = await login(user);
  assert.equal(again.status, 403);
  assert.equal(again.body.code, 'account_suspended');
  assert.equal(again.body.message, PLATFORM_MESSAGES.accountSuspended);
  assert.equal(again.body.accessToken, undefined);
  assert.equal(again.headers['set-cookie'], undefined, 'no refresh cookie for a suspended account');
  assert.equal(await Session.countDocuments({ user: user.user.id }), 0);

  // A wrong password gets the usual answer: it does not reveal that the account is suspended.
  const wrong = await login(user, 'not the password');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.message, 'Invalid email or password.');

  const stored = await User.findById(user.user.id).select('+suspendedBy').lean();
  assert.equal(String(stored.suspendedBy), admin.user.id, 'which admin suspended it is recorded');
});

test('AC2: after reactivation the user logs in with their usual password', async () => {
  const user = await freshUser('Rhea Reactivated');
  await suspend(admin, user);
  assert.equal((await login(user)).status, 403);

  const res = await reactivate(admin, user);
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, true);
  assert.equal(res.body.message, 'Rhea Reactivated is reactivated and can log in again.');
  assert.equal(res.body.user.suspended, false);
  assert.equal(res.body.user.suspendedAt, null);

  const back = await login(user);
  assert.equal(back.status, 200);
  assert.ok(back.body.accessToken);
  assert.equal((await authed(app, back.body.accessToken).get('/api/auth/me')).status, 200);
  // The sessions from before the suspension stay ended.
  assert.equal((await as(user).get('/api/auth/me')).status, 401);
  const stored = await User.findById(user.user.id).select('+suspendedBy').lean();
  assert.equal(stored.suspendedAt, null);
  assert.equal(stored.suspendedBy, null);
});

test('a session that slipped through (login at the same moment as the suspension) is still refused', async () => {
  const user = await freshUser('Lia Late');
  // Mark the account suspended WITHOUT ending its sessions, as if a login finished just after the admin's click.
  await User.updateOne({ _id: user.user.id }, { $set: { suspendedAt: new Date() } });
  assert.equal(await Session.countDocuments({ user: user.user.id }), 1);

  const res = await as(user).get('/api/auth/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'account_suspended');

  const renewed = await refresh(user);
  assert.equal(renewed.status, 403);
  assert.equal(renewed.body.code, 'account_suspended');
  assert.equal(renewed.body.accessToken, undefined);
  assert.equal(await Session.countDocuments({ user: user.user.id }), 0, 'the refresh attempt ended the session');
});

test('a suspended moderator loses moderator access too; reactivated, they get it back after logging in', async () => {
  const user = await freshUser('Mona Moderator');
  await setRole(admin, user, 'moderator');
  assert.equal((await moderatorAccess(user)).status, 200);

  await suspend(admin, user);
  assert.equal((await moderatorAccess(user)).status, 401);
  await reactivate(admin, user);
  const back = await login(user);
  assert.equal(back.body.user.platformRole, 'moderator', 'the role is kept through the suspension');
  assert.equal((await authed(app, back.body.accessToken).get('/api/moderation/access')).status, 200);
});

test('only a Platform Admin can suspend or reactivate (403), and never themselves or another admin', async () => {
  const target = await freshUser('Kiran Kept');
  const moderator = await freshUser('Meera Moderator');
  await setRole(admin, moderator, 'moderator');
  for (const actor of [alice, moderator]) {
    assert.equal((await suspend(actor, target)).status, 403);
    assert.equal((await reactivate(actor, target)).status, 403);
  }
  assert.equal((await request(app).post(`/api/admin/users/${target.user.id}/suspend`)).status, 401);
  assert.equal((await as(target).get('/api/auth/me')).status, 200, 'still logged in');

  const self = await suspend(admin, admin);
  assert.equal(self.status, 400);
  assert.equal(self.body.code, 'self');
  assert.equal(self.body.message, PLATFORM_MESSAGES.cannotSuspendSelf);

  const other = await suspend(admin, secondAdmin);
  assert.equal(other.status, 409);
  assert.equal(other.body.code, 'admin_locked');
  assert.equal((await as(secondAdmin).get('/api/auth/me')).status, 200);

  assert.equal((await as(admin).post('/api/admin/users/not-an-id/suspend')).status, 400);
  assert.equal((await as(admin).post(`/api/admin/users/${new mongoose.Types.ObjectId()}/reactivate`)).status, 404);
});

test('suspending twice is safe and still ends any session; reactivating an active account changes nothing', async () => {
  const user = await freshUser('Tom Twice');
  assert.equal((await suspend(admin, user)).body.changed, true);
  // Pretend a session was left behind somehow: the second suspend ends it too.
  await Session.create({ user: user.user.id, tokenHash: `left-behind-${Date.now()}`, expiresAt: new Date(Date.now() + 60_000) });
  const again = await suspend(secondAdmin, user);
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  assert.equal(again.body.sessionsEnded, 1);
  assert.equal(again.body.message, 'Tom Twice is already suspended.');

  const active = await freshUser('Ana Active');
  const res = await reactivate(admin, active);
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, false);
  assert.equal(res.body.message, 'Ana Active is already active.');
});

test('a removed account cannot keep using its session', async () => {
  const user = await freshUser('Gone Soon');
  await User.deleteOne({ _id: user.user.id });
  assert.equal((await as(user).get('/api/projects')).status, 401);
});

// --- Admin panel list --------------------------------------------------------------------------------

test('GET /api/admin/users lists accounts for the admin panel, with search and filters', async () => {
  const listed = await as(admin).get('/api/admin/users');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.page, 1);
  assert.equal(listed.body.pageSize, 20);
  assert.equal(listed.body.total, await User.countDocuments());
  const me = listed.body.users.find((row) => row.id === admin.user.id);
  assert.equal(me.isMe, true);
  assert.equal(me.platformRole, 'admin');

  // Nothing private: the row has a fixed set of fields.
  for (const row of listed.body.users) {
    assert.deepEqual(Object.keys(row).sort(), [
      'avatarUrl',
      'createdAt',
      'email',
      'id',
      'isMe',
      'name',
      'platformRole',
      'roleLabel',
      'suspended',
      'suspendedAt',
      'username',
    ]);
  }

  // Search by part of a name or e-mail, case-insensitive.
  const byName = await as(admin).get('/api/admin/users').query({ q: 'ALICE' });
  assert.deepEqual(
    byName.body.users.map((row) => row.id),
    [alice.user.id]
  );
  const byEmail = await as(admin)
    .get('/api/admin/users')
    .query({ q: bob.email.split('@')[0] });
  assert.deepEqual(
    byEmail.body.users.map((row) => row.id),
    [bob.user.id]
  );
  // Regex characters are matched literally (no error, no match-everything).
  const literal = await as(admin).get('/api/admin/users').query({ q: '.*' });
  assert.equal(literal.status, 200);
  assert.equal(literal.body.total, 0);

  // Filters: suspended accounts, moderators, admins.
  const suspended = await as(admin).get('/api/admin/users').query({ status: 'suspended' });
  assert.ok(suspended.body.total >= 1);
  assert.ok(suspended.body.users.every((row) => row.suspended));
  const active = await as(admin).get('/api/admin/users').query({ status: 'active' });
  assert.ok(active.body.users.every((row) => !row.suspended));
  const moderators = await as(admin).get('/api/admin/users').query({ role: 'moderator' });
  assert.ok(moderators.body.users.length >= 1);
  assert.ok(moderators.body.users.every((row) => row.platformRole === 'moderator'));
  const admins = await as(admin).get('/api/admin/users').query({ role: 'admin' });
  assert.deepEqual(admins.body.users.map((row) => row.id).sort(), [admin.user.id, secondAdmin.user.id].sort());

  // Summary over the whole platform.
  assert.equal(listed.body.summary.admins, 2);
  assert.equal(listed.body.summary.moderators, await User.countDocuments({ platformRole: 'moderator' }));
  assert.equal(listed.body.summary.suspended, await User.countDocuments({ suspendedAt: { $ne: null } }));
});

test('accounts created before platform roles existed show as normal users and can be found by role', async () => {
  const old = await freshUser('Olga Older');
  await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(old.user.id) }, { $unset: { platformRole: '', suspendedAt: '' } });
  assert.equal((await as(old).get('/api/auth/me')).body.user.platformRole, 'user', 'still logs in and works');
  const users = await as(admin).get('/api/admin/users').query({ role: 'user', q: 'Olga' });
  assert.equal(users.body.users[0].platformRole, 'user');
  assert.equal(users.body.users[0].suspended, false);
  // ...and can be made a moderator like anyone else.
  assert.equal((await setRole(admin, old, 'moderator')).body.changed, true);
});

test('the list pages through accounts, 20 at a time, in name order', async () => {
  const docs = Array.from({ length: 23 }, (_, i) => ({
    name: `Page Person ${String(i).padStart(2, '0')}`,
    username: `pageperson${i}x${process.pid}`,
    email: `page${i}-${process.pid}@example.com`,
    passwordHash: 'not-a-real-hash',
  }));
  await User.insertMany(docs);
  const first = await as(admin).get('/api/admin/users').query({ q: 'Page Person' });
  assert.equal(first.body.total, 23);
  assert.equal(first.body.users.length, 20);
  assert.equal(first.body.users[0].name, 'Page Person 00');
  const second = await as(admin).get('/api/admin/users').query({ q: 'Page Person', page: 2 });
  assert.deepEqual(
    second.body.users.map((row) => row.name),
    ['Page Person 20', 'Page Person 21', 'Page Person 22']
  );
  const past = await as(admin).get('/api/admin/users').query({ q: 'Page Person', page: 3 });
  assert.deepEqual(past.body.users, []);
});

test('bad list filters get 400 with the field name (NFR-21)', async () => {
  for (const [query, field] of [
    [{ status: 'banned' }, 'status'],
    [{ role: 'owner' }, 'role'],
    [{ page: '0' }, 'page'],
    [{ q: 'x'.repeat(81) }, 'q'],
  ]) {
    const res = await as(admin).get('/api/admin/users').query(query);
    assert.equal(res.status, 400, JSON.stringify(query));
    assert.equal(res.body.field, field);
  }
});
