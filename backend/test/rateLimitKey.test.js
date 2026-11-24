// [Sprint 7 · M8] D5 fix (Sprint 4 re-test): a forwarded IP address with a port.
// "Through smee.io the forwarded address includes a port (140.82.115.16:15734). Because each delivery
//  comes from a different port, each one gets its own rate-limit bucket."
// No MongoDB needed: the pure helper, plus /api/health (which never touches the database).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import {
  FORWARDED_WITHOUT_TRUST_PROXY_WARNING,
  UNKNOWN_CLIENT_KEY,
  clientAddress,
  rateLimitKey,
  resetRateLimitKeyWarnings,
} from '../src/lib/rateLimitKey.js';

const API_LIMIT = 120; // the /api limiter in createApp()
const fakeRequest = (ip, extra = {}) => ({ ip, socket: { remoteAddress: '10.0.0.9' }, headers: {}, ...extra });

describe('rateLimitKey (pure)', () => {
  test('IPv4 without a port is used as it is', () => {
    assert.equal(rateLimitKey(fakeRequest('203.0.113.5')), '203.0.113.5');
  });

  test('IPv4 with a port loses the port, so every port is the same client', () => {
    assert.equal(rateLimitKey(fakeRequest('203.0.113.5:4321')), '203.0.113.5');
    assert.equal(rateLimitKey(fakeRequest('140.82.115.16:15734')), '140.82.115.16');
    assert.equal(rateLimitKey(fakeRequest('203.0.113.5:4321')), rateLimitKey(fakeRequest('203.0.113.5:4322')));
  });

  test('bracketed IPv6 with or without a port loses the brackets and the port', () => {
    assert.equal(rateLimitKey(fakeRequest('[2001:db8::1]:4321')), '2001:db8::1');
    assert.equal(rateLimitKey(fakeRequest('[2001:db8::1]')), '2001:db8::1');
  });

  test('plain IPv6 is never cut at a colon', () => {
    assert.equal(rateLimitKey(fakeRequest('2001:db8::1')), '2001:db8::1');
    assert.equal(rateLimitKey(fakeRequest('::1')), '::1');
    assert.equal(rateLimitKey(fakeRequest('2001:DB8::ABCD')), '2001:db8::abcd', 'same address in any letter case');
  });

  test('IPv4 written as IPv6 counts as the same client as plain IPv4', () => {
    assert.equal(rateLimitKey(fakeRequest('::ffff:203.0.113.5')), '203.0.113.5');
  });

  test('a missing address falls back to the socket, then to one shared "unknown" bucket', () => {
    assert.equal(rateLimitKey(fakeRequest(undefined)), '10.0.0.9');
    assert.equal(rateLimitKey(fakeRequest('')), '10.0.0.9');
    assert.equal(rateLimitKey({ headers: {} }), UNKNOWN_CLIENT_KEY);
    assert.equal(rateLimitKey(undefined), UNKNOWN_CLIENT_KEY);
  });

  test('clientAddress trims and handles odd input safely', () => {
    assert.equal(clientAddress('  203.0.113.5:80 '), '203.0.113.5');
    assert.equal(clientAddress(null), '');
    assert.equal(clientAddress(42), '');
    // Not an address and not "ip:port": kept (still limits) rather than dropped.
    assert.equal(rateLimitKey(fakeRequest('proxy-name')), 'proxy-name');
  });

  test('warns once when X-Forwarded-For arrives while trust proxy is off (the D1 symptom)', () => {
    const savedEnv = process.env.NODE_ENV;
    const savedWarn = console.warn;
    const warnings = [];
    process.env.NODE_ENV = 'development';
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      resetRateLimitKeyWarnings();
      const app = { get: (name) => (name === 'trust proxy' ? false : undefined) };
      const req = fakeRequest('10.0.0.9', { app, get: (name) => (name === 'x-forwarded-for' ? '203.0.113.5' : undefined) });
      rateLimitKey(req);
      rateLimitKey(req);
      assert.deepEqual(warnings, [FORWARDED_WITHOUT_TRUST_PROXY_WARNING]);

      // Trust proxy on: no warning.
      resetRateLimitKeyWarnings();
      warnings.length = 0;
      const trusted = { get: (name) => (name === 'trust proxy' ? 1 : undefined) };
      rateLimitKey(fakeRequest('203.0.113.5', { app: trusted, get: () => '203.0.113.5' }));
      assert.deepEqual(warnings, []);
    } finally {
      process.env.NODE_ENV = savedEnv;
      console.warn = savedWarn;
      resetRateLimitKeyWarnings();
    }
  });
});

describe('a real express-rate-limit limiter with rateLimitKey', () => {
  function tinyApp({ keyGenerator, validate } = {}) {
    const app = express();
    app.set('trust proxy', 'loopback'); // supertest connects from 127.0.0.1, so X-Forwarded-For is used
    app.use(rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false, keyGenerator, validate }));
    app.get('/', (_req, res) => res.json({ ok: true }));
    return app;
  }
  const hit = (app, forwarded) => request(app).get('/').set('X-Forwarded-For', forwarded);

  test('before the fix: a new port each time means a new bucket each time (D5)', async () => {
    const app = tinyApp({ validate: false }); // the default key (req.ip, port included); its warning is the bug itself
    for (let port = 4321; port < 4326; port += 1) {
      assert.equal((await hit(app, `203.0.113.5:${port}`)).status, 200, `port ${port} is never limited`);
    }
  });

  test('with the fix: 203.0.113.5:4321 then :4322 share one bucket, so the limit applies', async () => {
    const app = tinyApp({ keyGenerator: rateLimitKey });
    assert.equal((await hit(app, '203.0.113.5:4321')).status, 200);
    assert.equal((await hit(app, '203.0.113.5:4322')).status, 200);
    assert.equal((await hit(app, '203.0.113.5:4323')).status, 429, 'third request from the same client');
    assert.equal((await hit(app, '203.0.113.5')).status, 429, 'the same client without a port too');
    // Another client behind the same proxy is not affected.
    assert.equal((await hit(app, '198.51.100.7:4321')).status, 200);
  });
});

describe('createApp() limiters use rateLimitKey', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, TRUST_PROXY: process.env.TRUST_PROXY };
  const savedError = console.error;
  const savedWarn = console.warn;
  let logged = [];
  let createApp;

  before(async () => {
    // The limiters are skipped when NODE_ENV=test, and this test is about the limiters.
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-123456';
    console.error = (...args) => { logged.push(args); };
    console.warn = (...args) => { logged.push(args); };
    ({ createApp } = await import('../src/app.js'));
  });

  after(() => {
    console.error = savedError;
    console.warn = savedWarn;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('TRUST_PROXY=loopback: "ip:port" from smee is one client; the /api limit is reached', async () => {
    process.env.TRUST_PROXY = 'loopback';
    logged = [];
    const app = createApp();
    for (let i = 0; i < API_LIMIT; i += 1) {
      const res = await request(app).get('/api/health').set('X-Forwarded-For', `203.0.113.5:${4000 + i}`);
      assert.equal(res.status, 200, `request ${i + 1}`);
    }
    const blocked = await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.5:5999');
    assert.equal(blocked.status, 429, 'request 121 from the same client, on yet another port');
    assert.equal((await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.6:4000')).status, 200, 'another client is fine');
    assert.equal(
      logged.some((args) => /ERR_ERL_INVALID_IP_ADDRESS/.test(args.map(String).join(' '))),
      false,
      'express-rate-limit no longer complains about the address'
    );
  });
});

// Guard for later changes: a new IP-based limiter must not bring D5 back.
test('every rateLimit({...}) in backend/src sets a keyGenerator', () => {
  const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(srcRoot);
  let limiters = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let at = text.indexOf('rateLimit({');
    while (at !== -1) {
      limiters += 1;
      // The options object: up to the matching "})".
      let depth = 0;
      let end = at + 'rateLimit('.length;
      for (; end < text.length; end += 1) {
        if (text[end] === '{') depth += 1;
        if (text[end] === '}') { depth -= 1; if (depth === 0) break; }
      }
      const options = text.slice(at, end + 1);
      assert.match(options, /keyGenerator\s*:/, `${path.relative(srcRoot, file)}: a limiter without keyGenerator`);
      at = text.indexOf('rateLimit({', end);
    }
  }
  assert.ok(limiters >= 6, `found ${limiters} limiters`);
});
