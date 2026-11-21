// [Sprint 7 · M5] Settings page: change password (old password required, other sessions logged out).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';
import PasswordResetToken from '../src/models/PasswordResetToken.js';
import { newResetToken } from '../src/lib/passwordResetRules.js';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
before(async () => { ({ app } = await setup()); });
after(teardown);

const NEW_PASSWORD = 'a brand new password';

// A second, separate sign-in of the same account (another browser or device).
async function loginAgain(account, password = account.password) {
  const res = await request(app).post('/api/auth/login').send({ email: account.email, password });
  assert.equal(res.status, 200);
  return { token: res.body.accessToken, cookies: res.headers['set-cookie'] };
}

const change = (token, body) => authed(app, token).post('/api/settings/password').send(body);

test('changing the password needs a login', async () => {
  const res = await request(app).post('/api/settings/password').send({ currentPassword: 'x', newPassword: NEW_PASSWORD });
  assert.equal(res.status, 401);
});

test('the old password is required, and the new one must be valid and different', async () => {
  const account = await signup(app, 'Rules Person');
  const missing = await change(account.token, { newPassword: NEW_PASSWORD });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.message, 'Enter your current password.');

  const short = await change(account.token, { currentPassword: account.password, newPassword: 'short' });
  assert.equal(short.status, 400);
  assert.equal(short.body.message, 'Password must be at least 8 characters.');

  const same = await change(account.token, { currentPassword: account.password, newPassword: account.password });
  assert.equal(same.status, 400);
  assert.equal(same.body.message, 'Choose a new password that is different from your current one.');

  // Nothing changed: the original password still logs in.
  await loginAgain(account);
});

test('a wrong old password is refused with 400 (not 401) and changes nothing', async () => {
  const account = await signup(app, 'Wrong Old');
  const other = await loginAgain(account);
  const before = await User.findById(account.user.id).select('+passwordHash');

  const res = await change(account.token, { currentPassword: 'not my password', newPassword: NEW_PASSWORD });
  assert.equal(res.status, 400, '401 would make the app sign the user out for a typo');
  assert.equal(res.body.code, 'current_password_wrong');
  assert.equal(res.body.message, 'Your current password is not correct.');

  const afterwards = await User.findById(account.user.id).select('+passwordHash');
  assert.equal(afterwards.passwordHash, before.passwordHash);
  assert.equal(await Session.countDocuments({ user: account.user.id }), 2, 'no session was ended');
  assert.equal((await authed(app, other.token).get('/api/auth/me')).status, 200);

  // An absurdly long "old password" is just wrong too.
  const long = await change(account.token, { currentPassword: 'x'.repeat(5000), newPassword: NEW_PASSWORD });
  assert.equal(long.status, 400);
  assert.equal(long.body.code, 'current_password_wrong');
});

test('the right old password changes it; other sessions end, this one stays', async () => {
  const account = await signup(app, 'Change Me'); // session A (this browser)
  const laptop = await loginAgain(account); // session B
  const phone = await loginAgain(account); // session C
  assert.equal(await Session.countDocuments({ user: account.user.id }), 3);

  const res = await change(account.token, { currentPassword: account.password, newPassword: NEW_PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(res.body.signedOutSessions, 2);
  assert.equal(res.body.message, 'Your password has been changed. 2 other sessions were signed out.');
  // The browser that made the change keeps its refresh cookie (nothing is cleared).
  assert.equal(res.headers['set-cookie'], undefined);

  // This session still works, and can still refresh.
  assert.equal(await Session.countDocuments({ user: account.user.id }), 1);
  assert.equal((await authed(app, account.token).get('/api/auth/me')).status, 200);
  const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', account.cookies);
  assert.equal(refreshed.status, 200);

  // The other sessions are logged out at once: their access tokens and refresh cookies are dead.
  for (const other of [laptop, phone]) {
    assert.equal((await authed(app, other.token).get('/api/auth/me')).status, 401);
    assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', other.cookies)).status, 401);
  }

  // Old password no longer logs in, the new one does. Stored as bcrypt cost 12, never in plain text.
  const old = await request(app).post('/api/auth/login').send({ email: account.email, password: account.password });
  assert.equal(old.status, 401);
  await loginAgain(account, NEW_PASSWORD);
  const user = await User.findById(account.user.id).select('+passwordHash');
  assert.match(user.passwordHash, /^\$2[aby]\$12\$/);
  assert.ok(!user.passwordHash.includes(NEW_PASSWORD));
});

test('with no other sessions, the message says so', async () => {
  const account = await signup(app, 'Only Here');
  const res = await change(account.token, { currentPassword: account.password, newPassword: NEW_PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(res.body.signedOutSessions, 0);
  assert.equal(res.body.message, 'Your password has been changed. You were not signed in anywhere else.');
});

test('a password reset link that is still open stops working after the change', async () => {
  const account = await signup(app, 'Reset Link');
  const { token, tokenHash } = newResetToken();
  await PasswordResetToken.create({ user: account.user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });

  const res = await change(account.token, { currentPassword: account.password, newPassword: NEW_PASSWORD });
  assert.equal(res.status, 200);

  const verify = await request(app).post('/api/auth/reset-password/verify').send({ token });
  assert.equal(verify.status, 400);
});

test('other accounts are not touched', async () => {
  const me = await signup(app, 'Me Myself');
  const bystander = await signup(app, 'By Stander');
  const res = await change(me.token, { currentPassword: me.password, newPassword: NEW_PASSWORD });
  assert.equal(res.status, 200);
  assert.equal((await authed(app, bystander.token).get('/api/auth/me')).status, 200);
  await request(app).post('/api/auth/login').send({ email: bystander.email, password: bystander.password }).expect(200);
});
