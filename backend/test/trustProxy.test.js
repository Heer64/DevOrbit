// [Sprint 6 · M1] D1 fix (Sprint 4 exit checks): Express "trust proxy" from TRUST_PROXY.
// "Behind Render's proxy every client would share the proxy's IP for rate limiting."
// No MongoDB needed: only /api/health is called, and it never touches the database.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { trustProxySetting, MAX_PROXY_HOPS } from '../src/lib/trustProxy.js';

const API_LIMIT = 120; // the /api limiter in createApp(): 120 requests per minute per client IP

describe('trustProxySetting (pure)', () => {
  test('off by default and for the usual "off" words', () => {
    for (const raw of [undefined, null, '', '   ', 'false', 'FALSE', '0', 'off', 'no']) {
      assert.deepEqual(trustProxySetting(raw), { value: false, warning: '' }, `raw=${raw}`);
    }
  });

  test('a number of proxy hops (Render = 1)', () => {
    assert.deepEqual(trustProxySetting('1'), { value: 1, warning: '' });
    assert.deepEqual(trustProxySetting(' 2 '), { value: 2, warning: '' });
    assert.deepEqual(trustProxySetting(String(MAX_PROXY_HOPS)), { value: MAX_PROXY_HOPS, warning: '' });
  });

  test('"true" is refused: any client could choose its own IP', () => {
    const result = trustProxySetting('true');
    assert.equal(result.value, false);
    assert.match(result.warning, /not allowed/);
  });

  test('out-of-range hop counts fall back to false with a warning', () => {
    for (const raw of [String(MAX_PROXY_HOPS + 1), '999', '-1', '1.5']) {
      const result = trustProxySetting(raw);
      assert.equal(result.value, false, `raw=${raw}`);
      assert.notEqual(result.warning, '', `raw=${raw}`);
    }
  });

  test('named ranges and IP / subnet lists', () => {
    assert.deepEqual(trustProxySetting('loopback'), { value: ['loopback'], warning: '' });
    assert.deepEqual(trustProxySetting('Loopback, 10.0.0.0/8'), { value: ['loopback', '10.0.0.0/8'], warning: '' });
    assert.deepEqual(trustProxySetting('127.0.0.1,::1'), { value: ['127.0.0.1', '::1'], warning: '' });
    assert.deepEqual(trustProxySetting('fd00::/8'), { value: ['fd00::/8'], warning: '' });
  });

  test('anything else falls back to false with a warning', () => {
    for (const raw of ['yes please', '10.0.0.0/33', '300.1.1.1', '10.0.0.0/8/1', 'loopback,banana', ',', '::1/129']) {
      const result = trustProxySetting(raw);
      assert.equal(result.value, false, `raw=${raw}`);
      assert.notEqual(result.warning, '', `raw=${raw}`);
    }
  });
});

describe('createApp() with TRUST_PROXY', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, TRUST_PROXY: process.env.TRUST_PROXY };
  const savedError = console.error;
  const savedWarn = console.warn;
  let logged = [];
  let createApp;

  before(async () => {
    // The limiters are skipped when NODE_ENV=test, and this file is about the limiters.
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

  function appWith(trustProxy) {
    if (trustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = trustProxy;
    logged = [];
    return createApp();
  }

  const health = (app, ip) => request(app).get('/api/health').set('X-Forwarded-For', ip);

  async function useUpLimit(app, ip) {
    for (let i = 0; i < API_LIMIT; i += 1) {
      const res = await health(app, ip);
      assert.equal(res.status, 200, `request ${i + 1} from ${ip}`);
    }
    assert.equal((await health(app, ip)).status, 429, `request ${API_LIMIT + 1} from ${ip} is rate limited`);
  }

  test('not set: trust proxy stays off (unchanged local behaviour)', () => {
    const app = appWith(undefined);
    assert.equal(app.get('trust proxy'), false);
  });

  test('TRUST_PROXY=1 (Render): each forwarded client gets its own rate-limit bucket', async () => {
    const app = appWith('1');
    assert.equal(app.get('trust proxy'), 1);
    await useUpLimit(app, '203.0.113.10');
    // A different user behind the same proxy is NOT blocked by the first user's requests.
    assert.equal((await health(app, '203.0.113.20')).status, 200);
    // No express-rate-limit validation error (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) was logged.
    assert.equal(logged.some((args) => /ERR_ERL/.test(args.map(String).join(' '))), false);
  });

  test('TRUST_PROXY=loopback (local smee / ngrok): forwarded clients are told apart too', async () => {
    const app = appWith('loopback');
    assert.deepEqual(app.get('trust proxy'), ['loopback']);
    await useUpLimit(app, '198.51.100.1');
    assert.equal((await health(app, '198.51.100.2')).status, 200);
  });

  test('TRUST_PROXY=true is refused and logged; the app runs with trust proxy off', () => {
    const app = appWith('true');
    assert.equal(app.get('trust proxy'), false);
    assert.equal(logged.some((args) => /TRUST_PROXY=true is not allowed/.test(args.map(String).join(' '))), true);
  });
});
