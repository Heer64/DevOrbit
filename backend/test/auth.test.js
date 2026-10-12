import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
before(async () => { ({ app } = await setup()); });
after(teardown);

test('US-01 register creates an account and returns a session', async () => {
  const res = await request(app).post('/api/auth/signup').send({ name: 'Asha Rao', email: 'Asha@Example.com', password: 'a-long-password' });
  assert.equal(res.status, 201);
  assert.ok(res.body.accessToken);
  assert.equal(res.body.user.email, 'asha@example.com');
  assert.equal(res.body.user.passwordHash, undefined);
  assert.match(res.headers['set-cookie'].join(';'), /devorbit_refresh=.*HttpOnly/i);
});

test('US-01 passwords are stored as salted bcrypt hashes, never plain text', async () => {
  const password = 'plain-text-must-not-appear';
  await request(app).post('/api/auth/signup').send({ name: 'Hash Check', email: 'hash@example.com', password });
  const user = await User.findOne({ email: 'hash@example.com' }).select('+passwordHash');
  assert.notEqual(user.passwordHash, password);
  assert.ok(!user.passwordHash.includes(password));
  assert.match(user.passwordHash, /^\$2[aby]\$12\$/); // bcrypt, cost 12, salt embedded in the hash
  // Same password for a second user gives a different hash, which proves a per-user salt.
  await request(app).post('/api/auth/signup').send({ name: 'Hash Two', email: 'hash2@example.com', password });
  const other = await User.findOne({ email: 'hash2@example.com' }).select('+passwordHash');
  assert.notEqual(user.passwordHash, other.passwordHash);
});

test('US-01 rejects duplicate emails, bad emails and short passwords', async () => {
  await request(app).post('/api/auth/signup').send({ name: 'Dup', email: 'dup@example.com', password: 'long-enough-1' });
  const dup = await request(app).post('/api/auth/signup').send({ name: 'Dup', email: 'DUP@example.com', password: 'long-enough-1' });
  assert.equal(dup.status, 409);
  const badEmail = await request(app).post('/api/auth/signup').send({ name: 'X', email: 'nope', password: 'long-enough-1' });
  assert.equal(badEmail.status, 400);
  const shortPw = await request(app).post('/api/auth/signup').send({ name: 'X', email: 'short@example.com', password: 'short' });
  assert.equal(shortPw.status, 400);
});

test('US-02 log in works with the right password and fails with the wrong one', async () => {
  const account = await signup(app, 'Login User');
  const ok = await request(app).post('/api/auth/login').send({ email: account.email, password: account.password });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.accessToken);
  const bad = await request(app).post('/api/auth/login').send({ email: account.email, password: 'wrong-password' });
  assert.equal(bad.status, 401);
  const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever-1' });
  assert.equal(unknown.status, 401);
});

test('US-02 five wrong passwords lock the account for a while', async () => {
  const account = await signup(app, 'Lock User');
  for (let i = 0; i < 4; i += 1) {
    const res = await request(app).post('/api/auth/login').send({ email: account.email, password: 'wrong-password' });
    assert.equal(res.status, 401);
  }
  const locked = await request(app).post('/api/auth/login').send({ email: account.email, password: 'wrong-password' });
  assert.equal(locked.status, 423);
  const stillLocked = await request(app).post('/api/auth/login').send({ email: account.email, password: account.password });
  assert.equal(stillLocked.status, 423);
});

test('protected routes need a token', async () => {
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  assert.equal((await request(app).get('/api/projects')).status, 401);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-token')).status, 401);
});

test('US-03 log out revokes the session on the server', async () => {
  const account = await signup(app, 'Logout User');
  const before = await authed(app, account.token).get('/api/auth/me');
  assert.equal(before.status, 200);

  const out = await request(app).post('/api/auth/logout').set('Cookie', account.cookies);
  assert.equal(out.status, 200);
  assert.equal(await Session.countDocuments({ user: account.user.id }), 0);

  // The old access token no longer works even though it has not expired.
  const after = await authed(app, account.token).get('/api/auth/me');
  assert.equal(after.status, 401);
  // And the refresh cookie cannot bring the session back.
  const refresh = await request(app).post('/api/auth/refresh').set('Cookie', account.cookies);
  assert.equal(refresh.status, 401);
});
