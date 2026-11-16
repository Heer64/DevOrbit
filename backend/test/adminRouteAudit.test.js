// [Sprint 6 · M8] Authorization audit of every moderator and admin route on the server (NFR-19, US-56, US-57, US-58).
//
// It reads the routes from the routers themselves, so a route added later (for example M7's moderator queue in
// routes/moderation.js) is audited without changing this file. For each route and each kind of caller:
//   no login -> 401   suspended account -> 401   normal user -> 403   moderator -> 403 on admin routes
//   and the right role gets past the guard (any answer except 401/403).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup } from './helpers.js';
import User from '../src/models/User.js';
import adminRoutes from '../src/routes/admin.js';
import moderationRoutes from '../src/routes/moderation.js';
import { requireAuth } from '../src/middleware/auth.js';
import { requireModerator, requirePlatformAdmin } from '../src/middleware/platformRoles.js';

let app;
let user, moderator, admin, suspended;

// Every route of an Express router: [{ method, path }].
function routesOf(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods)
        .filter((method) => method !== '_all')
        .map((method) => ({ method, path: layer.route.path }))
    );
}

// Real URL for a route: every :param becomes an ID that exists nowhere, so allowed calls change nothing.
const urlFor = (base, path) => `${base}${path.replace(/:[A-Za-z]+/g, () => new mongoose.Types.ObjectId().toString())}`;

function call(method, url, token) {
  let req = request(app)[method](url);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  // A valid-looking body, so that any 403 comes from the guard and not from input checks.
  if (method !== 'get' && method !== 'delete') req = req.send({ role: 'moderator' });
  return req;
}

const GROUPS = [
  {
    name: 'admin',
    base: '/api/admin',
    router: adminRoutes,
    guard: requirePlatformAdmin,
    allowed: ['admin'],
    refused: ['user', 'moderator'],
  },
  {
    name: 'moderation',
    base: '/api/moderation',
    router: moderationRoutes,
    guard: requireModerator,
    allowed: ['moderator', 'admin'],
    refused: ['user'],
  },
];

before(async () => {
  ({ app } = await setup());
  [user, moderator, admin, suspended] = await Promise.all(
    ['Uma User', 'Mo Moderator', 'Ada Admin', 'Sid Suspended'].map((n) => signup(app, n))
  );
  await User.updateOne({ _id: moderator.user.id }, { $set: { platformRole: 'moderator' } });
  await User.updateOne({ _id: admin.user.id }, { $set: { platformRole: 'admin' } });
  // Suspended directly, keeping its session: the guard itself must refuse it (not only the deleted session).
  await User.updateOne({ _id: suspended.user.id }, { $set: { platformRole: 'admin', suspendedAt: new Date() } });
});

after(async () => {
  await teardown();
});

const tokens = () => ({ user: user.token, moderator: moderator.token, admin: admin.token });

for (const group of GROUPS) {
  test(`${group.name}: the first two steps of the router are requireAuth and the role guard (no route can skip them)`, () => {
    const firstTwo = group.router.stack.slice(0, 2);
    assert.equal(firstTwo.length, 2);
    assert.equal(firstTwo[0].route, undefined, 'router-level middleware, not a route');
    assert.equal(firstTwo[0].handle, requireAuth);
    assert.equal(firstTwo[1].handle, group.guard);
    assert.ok(routesOf(group.router).length >= 1, 'the router has routes to audit');
  });

  test(`${group.name}: every route refuses no login (401), a suspended account (401) and the wrong roles (403)`, async () => {
    for (const { method, path } of routesOf(group.router)) {
      const url = urlFor(group.base, path);
      const label = `${method.toUpperCase()} ${group.base}${path}`;

      assert.equal((await call(method, url)).status, 401, `${label} without login`);
      const blocked = await call(method, url, suspended.token);
      assert.equal(blocked.status, 401, `${label} as a suspended admin`);
      assert.equal(blocked.body.code, 'account_suspended');

      for (const role of group.refused) {
        const res = await call(method, url, tokens()[role]);
        assert.equal(res.status, 403, `${label} as ${role}`);
        assert.equal(res.body.code, 'forbidden');
      }
      for (const role of group.allowed) {
        const res = await call(method, url, tokens()[role]);
        assert.ok(![401, 403].includes(res.status), `${label} as ${role} got ${res.status}`);
      }
    }
  });
}

test('/api/admin and /api/moderation are served only by these two routers', () => {
  const appRouter = app._router || app.router;
  const routers = (url) =>
    appRouter.stack
      .filter((layer) => layer.handle && Array.isArray(layer.handle.stack) && layer.regexp.test(url))
      .map((layer) => layer.handle);
  assert.deepEqual(routers('/api/admin/users'), [adminRoutes]);
  assert.deepEqual(routers('/api/moderation/access'), [moderationRoutes]);
});

test('the role is read from the database on each request: a token never carries it', async () => {
  const claims = JSON.parse(Buffer.from(admin.token.split('.')[1], 'base64url').toString());
  assert.deepEqual(Object.keys(claims).sort(), ['email', 'exp', 'iat', 'id', 'sid']);

  // Take the role away in the database: the same token is refused on the very next request.
  await User.updateOne({ _id: admin.user.id }, { $set: { platformRole: 'user' } });
  assert.equal((await call('get', '/api/admin/users', admin.token)).status, 403);
  await User.updateOne({ _id: admin.user.id }, { $set: { platformRole: 'admin' } });
  assert.equal((await call('get', '/api/admin/users', admin.token)).status, 200);
});
