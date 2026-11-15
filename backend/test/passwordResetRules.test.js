// [Sprint 6 · M1] US-04: the pure rules (lib/passwordResetRules.js) and the email transports (lib/mailer.js).
// No MongoDB and no network: Brevo is a fake fetch.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESET_LINK_TTL_MS,
  appBaseUrl,
  hashResetToken,
  isValidEmail,
  looksLikeResetToken,
  newResetToken,
  normalizeEmail,
  passwordProblem,
  resetEmail,
  resetLinkFor,
} from '../src/lib/passwordResetRules.js';
import { BREVO_SEND_URL, mailConfig, sendMail, testOutbox } from '../src/lib/mailer.js';

describe('passwordResetRules', () => {
  test('the link is valid for exactly 1 hour (AC1)', () => {
    assert.equal(RESET_LINK_TTL_MS, 60 * 60 * 1000);
  });

  test('tokens are random 256-bit base64url strings; only the SHA-256 hash is stored', () => {
    const a = newResetToken();
    const b = newResetToken();
    assert.notEqual(a.token, b.token);
    assert.equal(a.token.length, 43);
    assert.ok(looksLikeResetToken(a.token));
    assert.equal(a.tokenHash, hashResetToken(a.token));
    assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(a.tokenHash, a.token);
  });

  test('looksLikeResetToken rejects anything that is not a token', () => {
    for (const value of [
      '',
      'abc',
      'A'.repeat(42),
      'A'.repeat(44),
      `${'A'.repeat(42)}=`,
      `${'A'.repeat(42)} `,
      null,
      undefined,
      42,
      {},
      ['x'],
    ]) {
      assert.equal(looksLikeResetToken(value), false, `value=${JSON.stringify(value)}`);
    }
  });

  test('emails are trimmed and lower-cased like at login; non-strings become empty', () => {
    assert.equal(normalizeEmail('  Riya@Example.COM '), 'riya@example.com');
    assert.equal(normalizeEmail({ $ne: null }), '');
    assert.equal(normalizeEmail(undefined), '');
    assert.ok(isValidEmail('riya@example.com'));
    assert.equal(isValidEmail('riya@example'), false);
    assert.equal(isValidEmail('no spaces@example.com'), false);
  });

  test('new passwords follow the sign-up rules (8 to 128 characters)', () => {
    assert.equal(passwordProblem('long-enough'), '');
    assert.equal(passwordProblem('x'.repeat(128)), '');
    assert.equal(passwordProblem('short'), 'Password must be at least 8 characters.');
    assert.equal(passwordProblem('x'.repeat(129)), 'Password must be 128 characters or fewer.');
    assert.equal(passwordProblem(''), 'Enter a new password.');
    assert.equal(passwordProblem(12345678), 'Enter a new password.');
  });

  test('the link points to the frontend from APP_URL / CLIENT_ORIGIN, with the token in the fragment', () => {
    assert.equal(appBaseUrl({}), 'http://localhost:5173');
    assert.equal(appBaseUrl({ CLIENT_ORIGIN: 'https://devorbit.vercel.app, http://localhost:5173' }), 'https://devorbit.vercel.app');
    assert.equal(
      appBaseUrl({ APP_URL: 'https://app.example.com/devorbit/', CLIENT_ORIGIN: 'http://x.test' }),
      'https://app.example.com/devorbit'
    );
    // Anything odd in APP_URL is ignored rather than put in an email.
    for (const bad of ['javascript:alert(1)', 'https://user:pass@evil.example', 'https://a.example/?x=1', 'not a url']) {
      assert.equal(appBaseUrl({ APP_URL: bad }), 'http://localhost:5173', bad);
    }
    assert.equal(resetLinkFor('https://a.example', 'TOKEN_abc-123'), 'https://a.example/reset-password#token=TOKEN_abc-123');
  });

  test('the email names the user, the link and the 1-hour limit, and escapes HTML', () => {
    const link = 'https://a.example/reset-password#token=abc';
    const mail = resetEmail({ name: 'Riya <b>Kapoor</b>', link });
    assert.equal(mail.subject, 'Reset your DevOrbit password');
    assert.match(mail.text, /Hi Riya <b>Kapoor<\/b>,/); // plain text needs no escaping
    assert.ok(mail.text.includes(link));
    assert.match(mail.text, /expires in 1 hour/);
    assert.match(mail.html, /Riya &lt;b&gt;Kapoor&lt;\/b&gt;/);
    assert.doesNotMatch(mail.html, /<b>Kapoor/);
    assert.ok(mail.html.includes(`href="${link}"`));
    assert.equal(resetEmail({ name: '', link }).text.split('\n')[0], 'Hi,');
  });
});

describe('mailer', () => {
  test('which transport is used', () => {
    const pick = (env) => {
      const c = mailConfig(env);
      return `${c.transport || '(none)'}:${c.ready}`;
    };
    assert.equal(pick({ NODE_ENV: 'test' }), 'memory:true');
    assert.equal(pick({ NODE_ENV: 'development' }), 'log:true');
    assert.equal(pick({}), 'log:true');
    assert.equal(pick({ NODE_ENV: 'production' }), '(none):false');
    assert.equal(pick({ NODE_ENV: 'production', MAIL_TRANSPORT: 'log' }), 'log:false'); // never print links in production logs
    assert.equal(pick({ MAIL_TRANSPORT: 'brevo' }), 'brevo:false');
    assert.equal(pick({ MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'k', MAIL_FROM: 'not-an-email' }), 'brevo:false');
    assert.equal(pick({ MAIL_TRANSPORT: 'BREVO', BREVO_API_KEY: 'k', MAIL_FROM: 'team@example.com' }), 'brevo:true');
    assert.equal(pick({ MAIL_TRANSPORT: 'smtp' }), 'smtp:false');
    assert.match(mailConfig({ MAIL_TRANSPORT: 'brevo' }).problem, /BREVO_API_KEY and MAIL_FROM/);
  });

  test('memory transport keeps the email for tests', async () => {
    testOutbox.clear();
    await sendMail({ to: 'a@example.com', subject: 'S', text: 'T', html: '<p>H</p>' }, { env: { NODE_ENV: 'test' } });
    assert.equal(testOutbox.all().length, 1);
    assert.equal(testOutbox.last().to, 'a@example.com');
    testOutbox.clear();
    assert.equal(testOutbox.last(), null);
  });

  test('brevo transport calls the Brevo API with the key in a header and the HTML body', async () => {
    let call;
    const fetchImpl = async (url, options) => {
      call = { url, options };
      return { ok: true, status: 201 };
    };
    const env = { MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'xkeysib-abc', MAIL_FROM: 'team@example.com', MAIL_FROM_NAME: 'DevOrbit Team' };
    await sendMail({ to: 'riya@example.com', subject: 'Reset', text: 'T', html: '<p>H</p>' }, { env, fetchImpl });
    assert.equal(call.url, BREVO_SEND_URL);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['api-key'], 'xkeysib-abc');
    assert.deepEqual(JSON.parse(call.options.body), {
      sender: { email: 'team@example.com', name: 'DevOrbit Team' },
      to: [{ email: 'riya@example.com' }],
      subject: 'Reset',
      htmlContent: '<p>H</p>',
    });
  });

  test('a Brevo error or a missing setup rejects, without the key in the message', async () => {
    const env = { MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'xkeysib-secret', MAIL_FROM: 'team@example.com' };
    await assert.rejects(
      sendMail({ to: 'a@example.com', subject: 'S', text: 'T', html: 'H' }, { env, fetchImpl: async () => ({ ok: false, status: 401 }) }),
      (error) => /HTTP 401/.test(error.message) && !/xkeysib/.test(error.message)
    );
    await assert.rejects(sendMail({ to: 'a@example.com' }, { env: { NODE_ENV: 'production' } }), /not configured/);
  });
});
