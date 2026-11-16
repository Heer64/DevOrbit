// [Sprint 6 · M1] US-04 Reset a forgotten password (FR-1, NFR-3a, NFR-19).
//  AC1 "Given I submit a registered email on the reset page, when the request is processed, then a single-use reset
//       link valid for 1 hour is emailed to me."
//  AC2 "Given I submit an email that is not registered, ... then I see the same confirmation message, so account
//       existence is not revealed."
//  AC3 "Given I open a valid reset link and enter a new valid password, when I submit, then the password is updated
//       and all my existing sessions are invalidated."
// Emails go to the in-memory test outbox (lib/mailer.js, MAIL_TRANSPORT=memory by default under NODE_ENV=test).
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';
import PasswordResetToken from '../src/models/PasswordResetToken.js';
import { testOutbox } from '../src/lib/mailer.js';
import { waitForPasswordResetWork } from '../src/routes/passwordReset.js';
import { RESET_MESSAGES, MAX_RESET_EMAILS_PER_HOUR, hashResetToken } from '../src/lib/passwordResetRules.js';

const NEW_PASSWORD = 'a-brand-new-password';
const MAIL_ENV = ['MAIL_TRANSPORT', 'BREVO_API_KEY', 'MAIL_FROM', 'APP_URL'];

let app;
let savedMailEnv;
before(async () => {
  ({ app } = await setup());
});
after(teardown);
beforeEach(() => {
  testOutbox.clear();
  savedMailEnv = Object.fromEntries(MAIL_ENV.map((key) => [key, process.env[key]]));
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedMailEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const forgot = (email) => request(app).post('/api/auth/forgot-password').send({ email });
const verify = (token) => request(app).post('/api/auth/reset-password/verify').send({ token });
const reset = (token, password = NEW_PASSWORD) => request(app).post('/api/auth/reset-password').send({ token, password });
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const tokenIn = (mail) => (mail?.text || '').match(/#token=([A-Za-z0-9_-]{43})/)?.[1];

// Ask for a link and return the token from the email.
async function requestLink(email) {
  const res = await forgot(email);
  assert.equal(res.status, 200);
  await waitForPasswordResetWork();
  const token = tokenIn(testOutbox.last());
  assert.ok(token, 'the email contains a reset link');
  return token;
}

async function quietly(fn) {
  const saved = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = saved;
  }
}

test('AC1: a registered email gets one email with a reset link to the frontend', async () => {
  const account = await signup(app, 'Riya Reset');
  const res = await forgot(`  ${account.email.toUpperCase()} `); // trimmed and case-insensitive, like login
  assert.equal(res.status, 200);
  assert.equal(res.body.message, RESET_MESSAGES.requested);
  await waitForPasswordResetWork();

  const mails = testOutbox.all();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, account.email);
  assert.equal(mails[0].subject, 'Reset your DevOrbit password');
  assert.match(mails[0].text, /^Hi Riya Reset,/);
  assert.match(mails[0].text, /expires in 1 hour/);
  // The token is in the URL fragment, which browsers never send to a server.
  assert.match(mails[0].text, /http:\/\/localhost:5173\/reset-password#token=[A-Za-z0-9_-]{43}/);
  assert.match(mails[0].html, /reset-password#token=/);
  // The response never contains the link.
  assert.doesNotMatch(JSON.stringify(res.body), /token/i);
});

test('AC1: the link is valid for 1 hour and only its hash is stored', async () => {
  const account = await signup(app, 'Hash Check');
  const startedAt = Date.now();
  const token = await requestLink(account.email);

  const record = await PasswordResetToken.findOne({ user: account.user.id }).select('+tokenHash').lean();
  assert.equal(record.tokenHash, hashResetToken(token));
  assert.notEqual(record.tokenHash, token);
  assert.equal(record.usedAt, null);
  const ttl = record.expiresAt.getTime() - startedAt;
  assert.ok(ttl > 59 * 60_000 && ttl <= 60 * 60_000 + 5_000, `expires about 1 hour later (got ${ttl} ms)`);

  const check = await verify(token);
  assert.equal(check.status, 200);
  assert.equal(check.body.valid, true);
  assert.ok(check.body.expiresAt);
});

test('AC1: APP_URL decides where the link points (never the request Host header)', async () => {
  process.env.APP_URL = 'https://devorbit.example.app/';
  const account = await signup(app, 'Link Base');
  const res = await request(app).post('/api/auth/forgot-password').set('Host', 'evil.example').send({ email: account.email });
  assert.equal(res.status, 200);
  await waitForPasswordResetWork();
  assert.match(testOutbox.last().text, /https:\/\/devorbit\.example\.app\/reset-password#token=/);
  assert.doesNotMatch(testOutbox.last().text, /evil\.example/);
});

test('AC2: an unregistered email gets exactly the same answer, and no email is sent', async () => {
  const account = await signup(app, 'Known User');
  const known = await forgot(account.email);
  const unknown = await forgot('nobody-here@example.com');
  await waitForPasswordResetWork();

  assert.equal(unknown.status, known.status);
  assert.deepEqual(unknown.body, known.body);
  assert.equal(testOutbox.all().length, 1); // only the registered account got mail
  assert.equal(testOutbox.last().to, account.email);
});

test('a missing or malformed email is a 400 (this reveals nothing about accounts)', async () => {
  const missing = await request(app).post('/api/auth/forgot-password').send({});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.message, RESET_MESSAGES.emailRequired);
  const bad = await forgot('not-an-email');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.message, RESET_MESSAGES.emailInvalid);
  const object = await forgot({ $ne: null }); // NoSQL-injection shape
  assert.equal(object.status, 400);
  await waitForPasswordResetWork();
  assert.equal(testOutbox.all().length, 0);
});

test('AC3: a valid link + new password changes the password and ends every session', async () => {
  const account = await signup(app, 'Session Ender'); // session 1 (this "browser")
  const second = await login(account.email, account.password); // session 2 (another device)
  assert.equal(second.status, 200);
  assert.equal(await Session.countDocuments({ user: account.user.id }), 2);
  assert.equal((await authed(app, account.token).get('/api/auth/me')).status, 200);

  const token = await requestLink(account.email);
  const res = await reset(token);
  assert.equal(res.status, 200);
  assert.equal(res.body.message, RESET_MESSAGES.done);
  assert.match(res.headers['set-cookie'].join(';'), /devorbit_refresh=;/); // this browser's cookie is cleared

  // All sessions are gone: access tokens still inside their 15 minutes stop working at once, and so do refresh cookies.
  assert.equal(await Session.countDocuments({ user: account.user.id }), 0);
  assert.equal((await authed(app, account.token).get('/api/auth/me')).status, 401);
  assert.equal((await authed(app, second.body.accessToken).get('/api/auth/me')).status, 401);
  const refresh = await request(app).post('/api/auth/refresh').set('Cookie', account.cookies);
  assert.equal(refresh.status, 401);

  // Old password no longer works; the new one does, and it is stored as a bcrypt hash.
  assert.equal((await login(account.email, account.password)).status, 401);
  assert.equal((await login(account.email, NEW_PASSWORD)).status, 200);
  const user = await User.findById(account.user.id).select('+passwordHash');
  assert.match(user.passwordHash, /^\$2[aby]\$12\$/);
});

test('AC1: the link works only once', async () => {
  const account = await signup(app, 'Single Use');
  const token = await requestLink(account.email);
  assert.equal((await reset(token)).status, 200);

  const again = await reset(token, 'another-password-2');
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'reset_link_invalid');
  assert.equal((await verify(token)).status, 400);
  assert.equal((await login(account.email, 'another-password-2')).status, 401);
});

test('AC1: two submits of the same link at the same moment: exactly one succeeds', async () => {
  const account = await signup(app, 'Double Click');
  const token = await requestLink(account.email);
  const results = await Promise.all([reset(token, 'first-password-1'), reset(token, 'second-password-2')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
});

test('AC1: an expired link (older than 1 hour) is refused and changes nothing', async () => {
  const account = await signup(app, 'Too Late');
  const token = await requestLink(account.email);
  await PasswordResetToken.updateOne({ user: account.user.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

  assert.equal((await verify(token)).status, 400);
  const res = await reset(token);
  assert.equal(res.status, 400);
  assert.equal(res.body.message, RESET_MESSAGES.linkInvalid);
  assert.equal((await login(account.email, account.password)).status, 200); // password unchanged
});

test('a new request replaces the earlier link (only the newest one works)', async () => {
  const account = await signup(app, 'Two Links');
  const first = await requestLink(account.email);
  const second = await requestLink(account.email);
  assert.notEqual(first, second);
  assert.equal((await verify(first)).status, 400);
  assert.equal((await reset(first)).status, 400);
  assert.equal((await reset(second)).status, 200);
});

test('a too-short or too-long password is refused without using up the link', async () => {
  const account = await signup(app, 'Typo User');
  const token = await requestLink(account.email);

  const short = await reset(token, 'short');
  assert.equal(short.status, 400);
  assert.equal(short.body.message, 'Password must be at least 8 characters.');
  const long = await reset(token, 'x'.repeat(129));
  assert.equal(long.status, 400);

  assert.equal((await verify(token)).status, 200); // still usable
  assert.equal((await reset(token)).status, 200);
});

test('fake, malformed or injected tokens are refused', async () => {
  const account = await signup(app, 'Fake Token');
  await requestLink(account.email);
  for (const token of ['', 'abc', 'A'.repeat(43), 'A'.repeat(44), { $ne: null }, ['x'], null]) {
    const res = await reset(token);
    assert.equal(res.status, 400, `token=${JSON.stringify(token)}`);
    assert.equal(res.body.code, 'reset_link_invalid');
    assert.equal((await verify(token)).status, 400);
  }
  assert.equal((await login(account.email, account.password)).status, 200);
});

test(`at most ${MAX_RESET_EMAILS_PER_HOUR} emails per account per hour, with the same answer every time`, async () => {
  const account = await signup(app, 'Inbox Flood');
  const answers = [];
  for (let i = 0; i < MAX_RESET_EMAILS_PER_HOUR + 2; i += 1) {
    answers.push((await forgot(account.email)).body);
    await waitForPasswordResetWork();
  }
  assert.equal(testOutbox.all().length, MAX_RESET_EMAILS_PER_HOUR);
  assert.ok(answers.every((body) => body.message === RESET_MESSAGES.requested));
});

test('resetting the password also lifts a login lock from wrong passwords', async () => {
  const account = await signup(app, 'Locked Out');
  for (let i = 0; i < 5; i += 1) await login(account.email, 'wrong-password');
  assert.equal((await login(account.email, account.password)).status, 423);

  const token = await requestLink(account.email);
  assert.equal((await reset(token)).status, 200);
  assert.equal((await login(account.email, NEW_PASSWORD)).status, 200);
});

test('email not set up: every email gets the same 503 and nothing is stored (AC2 still holds)', async () => {
  process.env.MAIL_TRANSPORT = 'brevo'; // without BREVO_API_KEY / MAIL_FROM
  delete process.env.BREVO_API_KEY;
  const account = await signup(app, 'No Mail');
  const { result, lines } = await quietly(async () => [await forgot(account.email), await forgot('ghost@example.com')]);
  const [known, unknown] = result;
  assert.equal(known.status, 503);
  assert.deepEqual(unknown.body, known.body);
  assert.equal(known.body.message, RESET_MESSAGES.mailUnavailable);
  assert.equal(await PasswordResetToken.countDocuments({ user: account.user.id }), 0);
  assert.ok(lines.some((line) => /BREVO_API_KEY/.test(line))); // the server log says what is missing
});

test('Brevo: the email is sent through Brevo, and a Brevo failure changes nothing for the visitor', async () => {
  Object.assign(process.env, { MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'xkeysib-test-key-123', MAIL_FROM: 'team@devorbit.example' });
  const account = await signup(app, 'Brevo User');
  const savedFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 201 };
    };
    assert.equal((await forgot(account.email)).status, 200);
    await waitForPasswordResetWork();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(calls[0].options.headers['api-key'], 'xkeysib-test-key-123');
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(body.to, [{ email: account.email }]);
    assert.equal(body.sender.email, 'team@devorbit.example');
    assert.match(body.htmlContent, /reset-password#token=[A-Za-z0-9_-]{43}/);

    // Brevo down: same answer for the visitor, and the log has neither the email address, the link nor the key.
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    const { result, lines } = await quietly(async () => {
      const res = await forgot(account.email);
      await waitForPasswordResetWork();
      return res;
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.message, RESET_MESSAGES.requested);
    const log = lines.join('\n');
    assert.match(log, /could not be sent/);
    assert.doesNotMatch(log, new RegExp(account.email.replace(/[.+]/g, '\\$&')));
    assert.doesNotMatch(log, /token=|xkeysib/);
  } finally {
    globalThis.fetch = savedFetch;
  }
});
