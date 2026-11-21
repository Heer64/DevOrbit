// [Sprint 7 · M5] O9: the res.clearCookie deprecation in routes/auth.js.
//
// Express 4.21+ deprecates passing maxAge/expires to res.clearCookie and Express 5 ignores them. In Express 4 a
// maxAge even overrode the "expired" date, so the browser kept an empty refresh cookie for 7 days. Every clear now
// goes through clearRefreshCookie(): Expires in 1970, no Max-Age, and the same path/flags as when it was set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup } from './helpers.js';
import { refreshCookieClearOptions } from '../src/routes/auth.js';

let app;
// depd (used by Express) emits 'deprecation' on process when someone listens, instead of printing to stderr.
const deprecations = [];
const onDeprecation = (error) => deprecations.push(String(error?.message || error));

before(async () => {
  process.on('deprecation', onDeprecation);
  ({ app } = await setup());
});
after(async () => {
  process.off('deprecation', onDeprecation);
  await teardown();
});

function refreshCookieHeader(res) {
  const cookies = res.headers['set-cookie'] || [];
  return cookies.find((cookie) => cookie.startsWith('devorbit_refresh='));
}

function assertCleared(res) {
  const cookie = refreshCookieHeader(res);
  assert.ok(cookie, 'the refresh cookie is cleared');
  assert.match(cookie, /^devorbit_refresh=;/, 'empty value');
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/, 'already expired, so the browser deletes it');
  assert.doesNotMatch(cookie, /Max-Age/i, 'no Max-Age (that is what kept the cookie alive and caused the warning)');
  assert.match(cookie, /Path=\/api\/auth/, 'same path as when it was set, or the browser keeps the real one');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
}

test('the clear options have no maxAge or expires, and match how the cookie was set', () => {
  const options = refreshCookieClearOptions();
  assert.equal('maxAge' in options, false);
  assert.equal('expires' in options, false);
  assert.deepEqual(options, { httpOnly: true, secure: false, sameSite: 'lax', path: '/api/auth' });
});

test('refresh with an unknown cookie clears it properly', async () => {
  const res = await request(app).post('/api/auth/refresh').set('Cookie', 'devorbit_refresh=not-a-real-session');
  assert.equal(res.status, 401);
  assertCleared(res);
});

test('log out clears the cookie the same way', async () => {
  const account = await signup(app, 'Cookie Logout');
  const res = await request(app).post('/api/auth/logout').set('Cookie', account.cookies);
  assert.equal(res.status, 200);
  assertCleared(res);
});

test('a cookie whose session already ended is cleared on its next refresh', async () => {
  // (Password reset uses the same clearRefreshCookie helper; passwordReset.test.js checks that path.)
  const account = await signup(app, 'Cookie Gone');
  await request(app).post('/api/auth/logout').set('Cookie', account.cookies).expect(200);
  const res = await request(app).post('/api/auth/refresh').set('Cookie', account.cookies);
  assert.equal(res.status, 401);
  assertCleared(res);
});

test('none of this prints the Express clearCookie deprecation warning', () => {
  const clearCookieWarnings = deprecations.filter((message) => /clearCookie/i.test(message));
  assert.deepEqual(clearCookieWarnings, []);
});
