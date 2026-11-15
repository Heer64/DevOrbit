// [Sprint 6 · M8] FR-27: "the first Platform Admin shall be created by a seed script or environment configuration".
// Both ways are tested here against a real MongoDB: PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD (run by server.js
// at start-up) and the seed script's admin@seed.devorbit.test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import User from '../src/models/User.js';
import { ADMIN_BOOTSTRAP_LOG, ensurePlatformAdminFromEnv } from '../src/lib/platformAdmin.js';
import { seedDatabase, seedEmail, SEED_USERS } from '../src/seed/seedData.js';

let app;
const PASSWORD = 'admin password 2026';
const env = (email, password = PASSWORD, extra = {}) => ({ PLATFORM_ADMIN_EMAIL: email, PLATFORM_ADMIN_PASSWORD: password, ...extra });
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const roleOf = async (email) => (await User.findOne({ email }).lean())?.platformRole;

before(async () => {
  ({ app } = await setup());
});

after(async () => {
  await teardown();
});

test('nothing happens when the settings are not there, and a half-filled setting is reported, not used', async () => {
  const before = await User.countDocuments();
  assert.deepEqual(await ensurePlatformAdminFromEnv({}), { outcome: 'not_configured' });
  const half = await ensurePlatformAdminFromEnv({ PLATFORM_ADMIN_EMAIL: 'half@example.com' });
  assert.equal(half.outcome, 'invalid');
  assert.match(half.problem, /PLATFORM_ADMIN_PASSWORD/);
  const short = await ensurePlatformAdminFromEnv(env('short@example.com', 'short'));
  assert.equal(short.outcome, 'invalid');
  assert.equal(await User.countDocuments(), before, 'no account created');
});

test('no account with that e-mail: it is created as Platform Admin and can log in and open the admin API', async () => {
  const result = await ensurePlatformAdminFromEnv(env('Boss@Example.com', PASSWORD, { PLATFORM_ADMIN_NAME: 'Boss Admin' }));
  assert.deepEqual(result, { outcome: 'created' });
  const stored = await User.findOne({ email: 'boss@example.com' }).lean();
  assert.equal(stored.platformRole, 'admin');
  assert.equal(stored.name, 'Boss Admin');
  assert.ok(stored.username);
  assert.notEqual(stored.passwordHash, PASSWORD, 'the password is stored hashed');

  const res = await login('boss@example.com', PASSWORD);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.platformRole, 'admin');
  assert.equal((await authed(app, res.body.accessToken).get('/api/admin/users')).status, 200);
});

test('running again (every server start) changes nothing, and lifts a suspension of that admin (recovery)', async () => {
  assert.deepEqual(await ensurePlatformAdminFromEnv(env('boss@example.com')), { outcome: 'already_admin' });
  await User.updateOne({ email: 'boss@example.com' }, { $set: { suspendedAt: new Date() } });
  assert.equal((await login('boss@example.com', PASSWORD)).status, 403);
  assert.deepEqual(await ensurePlatformAdminFromEnv(env('boss@example.com')), { outcome: 'already_admin' });
  assert.equal((await login('boss@example.com', PASSWORD)).status, 200);
  assert.equal(await User.countDocuments({ email: 'boss@example.com' }), 1);
});

test('an existing account is promoted only when PLATFORM_ADMIN_PASSWORD is its real password', async () => {
  const owner = await signup(app, 'Real Owner');
  assert.deepEqual(await ensurePlatformAdminFromEnv(env(owner.email, owner.password)), { outcome: 'promoted' });
  assert.equal(await roleOf(owner.email), 'admin');
  // The new role applies to the session the user already has.
  assert.equal((await authed(app, owner.token).get('/api/admin/users')).status, 200);
});

test('someone who registered the e-mail first is NOT promoted, and their password is not changed', async () => {
  const stranger = await signup(app, 'Early Stranger');
  const result = await ensurePlatformAdminFromEnv(env(stranger.email, 'the operators password'));
  assert.deepEqual(result, { outcome: 'password_mismatch' });
  assert.equal(await roleOf(stranger.email), 'user');
  assert.equal((await authed(app, stranger.token).get('/api/admin/users')).status, 403);
  assert.equal((await login(stranger.email, stranger.password)).status, 200, 'their own password still works');
  assert.equal((await login(stranger.email, 'the operators password')).status, 401);
});

test('the log lines name the settings, never the e-mail or the password', () => {
  for (const line of Object.values(ADMIN_BOOTSTRAP_LOG)) {
    assert.match(line, /Platform Admin/);
    assert.doesNotMatch(line, /@|password 2026/);
  }
});

test('the seed script creates the first Platform Admin (admin@seed.devorbit.test); the other seed users are not admins', async () => {
  const result = await seedDatabase({ password: 'seed-password-123' });
  assert.equal(result.seeded, true);
  const adminRow = result.users.find((u) => u.email === seedEmail('admin'));
  assert.equal(adminRow.platformRole, 'admin');
  assert.equal(adminRow.roleLabel, 'Platform Admin');

  for (const seed of SEED_USERS) {
    assert.equal(await roleOf(seedEmail(seed.key)), seed.key === 'admin' ? 'admin' : 'user', seed.key);
  }

  const res = await login(seedEmail('admin'), 'seed-password-123');
  assert.equal(res.status, 200);
  assert.equal(res.body.user.platformRole, 'admin');
  const list = await authed(app, res.body.accessToken).get('/api/admin/users').query({ q: 'seed.devorbit.test' });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, SEED_USERS.length);

  // The seed admin is not put in any seed project.
  const projects = await authed(app, res.body.accessToken).get('/api/projects');
  assert.deepEqual(projects.body.projects, []);
});
