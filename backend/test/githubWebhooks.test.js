// [Sprint 4 · M4] US-34: webhook signature, retry/backoff (NFR-11a), rate limits (NFR-11b) and the
// GitHub calls that create / remove the repository webhook. No database; GitHub is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GithubApiError } from '../src/lib/githubRepos.js';
import {
  MIN_SECRET_LENGTH,
  WEBHOOK_EVENTS,
  createRepositoryWebhook,
  deleteRepositoryWebhook,
  runWithRetry,
  shortError,
  signPayload,
  validDeliveryId,
  verifySignature,
  webhookConfig,
  webhookView,
  withRateLimitBackoff,
} from '../src/lib/githubWebhooks.js';

const SECRET = 'webhook-secret-for-tests-0123456789';
const URL_ = 'https://forge.example.com/api/github/webhook';
const CONFIG = webhookConfig({ GITHUB_WEBHOOK_SECRET: SECRET, GITHUB_WEBHOOK_URL: URL_ });
const TOKEN = 'gho_M4_TEST_TOKEN_never_leaves_server';

test('webhookConfig needs a long enough secret and a URL; reports missing names only', () => {
  assert.equal(CONFIG.configured, true);
  const missing = webhookConfig({ GITHUB_WEBHOOK_SECRET: 'short', GITHUB_WEBHOOK_URL: 'not a url' });
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.missing, ['GITHUB_WEBHOOK_SECRET', 'GITHUB_WEBHOOK_URL']);
  assert.equal(missing.secret, '');
  assert.ok(MIN_SECRET_LENGTH >= 20);
});

test('verifySignature accepts GitHub\'s HMAC of the exact body and rejects everything else', () => {
  const body = Buffer.from('{"zen":"Keep it logically awesome."}');
  const good = signPayload(SECRET, body);
  assert.match(good, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verifySignature(SECRET, body, good), true);
  assert.equal(verifySignature(SECRET, body, good.toUpperCase().replace('SHA256', 'sha256')), true);
  assert.equal(verifySignature(SECRET, Buffer.from(`${body} `), good), false, 'body changed');
  assert.equal(verifySignature('another-secret-another-secret', body, good), false, 'wrong secret');
  assert.equal(verifySignature(SECRET, body, undefined), false);
  assert.equal(verifySignature(SECRET, body, 'sha1=abc'), false);
  assert.equal(verifySignature(SECRET, body, 'sha256=xyz'), false);
  assert.equal(verifySignature(SECRET, {}, good), false, 'not raw bytes');
  assert.equal(verifySignature('', body, good), false);
});

test('validDeliveryId accepts GitHub GUIDs only', () => {
  assert.equal(validDeliveryId('72d3162e-cc78-11e3-81ab-4c9367dc0958'), true);
  assert.equal(validDeliveryId(''), false);
  assert.equal(validDeliveryId('$where'), false);
  assert.equal(validDeliveryId('x'.repeat(101)), false);
});

test('runWithRetry: 3 retries with 1 s / 2 s / 4 s backoff, then gives up without throwing', async () => {
  const waits = [];
  let calls = 0;
  const result = await runWithRetry(async () => { calls += 1; throw new Error('db down'); }, { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(result.ok, false);
  assert.equal(calls, 4);
  assert.equal(result.attempts, 4);
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(result.error.message, 'db down');
});

test('runWithRetry: stops at the first success', async () => {
  let calls = 0;
  const result = await runWithRetry(async () => { calls += 1; if (calls < 3) throw new Error('blip'); return 'ok'; }, { sleep: async () => {} });
  assert.deepEqual({ ok: result.ok, attempts: result.attempts, value: result.value }, { ok: true, attempts: 3, value: 'ok' });
});

test('withRateLimitBackoff waits for a short rate-limit reset once, and rethrows long ones', async () => {
  const waits = [];
  let calls = 0;
  const value = await withRateLimitBackoff(async () => {
    calls += 1;
    if (calls === 1) throw new GithubApiError('rate_limited', 'limit', { status: 403, retryAfter: 3 });
    return 'done';
  }, { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(value, 'done');
  assert.deepEqual(waits, [3000]);

  await assert.rejects(
    withRateLimitBackoff(async () => { throw new GithubApiError('rate_limited', 'limit', { status: 403, retryAfter: 3600 }); }, { sleep: async () => assert.fail('should not wait an hour') }),
    (error) => error.kind === 'rate_limited'
  );
  await assert.rejects(withRateLimitBackoff(async () => { throw new GithubApiError('unavailable', 'x'); }, { sleep: async () => {} }), (e) => e.kind === 'unavailable');
});

// Fake GitHub for the hooks API. `routes` maps "METHOD /path" to a response maker.
function fakeGithub(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const keyName = `${options.method || 'GET'} ${path}`;
    calls.push({ key: keyName, options, body: options.body ? JSON.parse(options.body) : null });
    const handler = routes[keyName];
    if (!handler) throw new Error(`Unexpected request ${keyName}`);
    const [status, body, headers = {}] = handler();
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  };
  return { fetchImpl, calls };
}

test('createRepositoryWebhook creates a signed JSON hook for push, issues and pull_request', async () => {
  const github = fakeGithub({ 'POST /repos/octo-owner/devorbit/hooks': () => [201, { id: 555 }] });
  const result = await createRepositoryWebhook({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', config: CONFIG, fetchImpl: github.fetchImpl });
  assert.deepEqual(result, { hookId: 555 });
  const [call] = github.calls;
  assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(call.body.events, WEBHOOK_EVENTS);
  assert.deepEqual(call.body.config, { url: URL_, content_type: 'json', insecure_ssl: '0', secret: SECRET });
  assert.equal(call.body.active, true);
});

test('createRepositoryWebhook reuses and refreshes our hook when GitHub says it already exists (422)', async () => {
  const github = fakeGithub({
    'POST /repos/octo-owner/devorbit/hooks': () => [422, { message: 'Validation Failed', errors: [{ message: 'Hook already exists on this repository' }] }],
    'GET /repos/octo-owner/devorbit/hooks': () => [200, [{ id: 1, config: { url: 'https://other.example/hook' } }, { id: 777, config: { url: URL_ } }]],
    'PATCH /repos/octo-owner/devorbit/hooks/777': () => [200, { id: 777 }],
  });
  const result = await createRepositoryWebhook({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', config: CONFIG, fetchImpl: github.fetchImpl });
  assert.deepEqual(result, { hookId: 777 });
  assert.equal(github.calls.at(-1).body.config.secret, SECRET);
});

test('createRepositoryWebhook: no admin rights -> not_admin; rate limit -> waits once then succeeds', async () => {
  const notAdmin = fakeGithub({ 'POST /repos/campus-org/shared-app/hooks': () => [404, { message: 'Not Found' }] });
  await assert.rejects(
    createRepositoryWebhook({ accessToken: TOKEN, fullName: 'campus-org/shared-app', config: CONFIG, fetchImpl: notAdmin.fetchImpl }),
    (error) => error.kind === 'not_admin'
  );

  let first = true;
  const waits = [];
  const limited = fakeGithub({
    'POST /repos/octo-owner/devorbit/hooks': () => {
      if (first) { first = false; return [403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'retry-after': '2' }]; }
      return [201, { id: 9 }];
    },
  });
  const result = await createRepositoryWebhook({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', config: CONFIG, fetchImpl: limited.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(result, { hookId: 9 });
  assert.deepEqual(waits, [2000]);
});

test('createRepositoryWebhook refuses when the server is not configured, and errors never contain the token', async () => {
  await assert.rejects(
    createRepositoryWebhook({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', config: webhookConfig({}), fetchImpl: async () => assert.fail('no call') }),
    (error) => error.kind === 'not_configured'
  );
  const down = fakeGithub({ 'POST /repos/octo-owner/devorbit/hooks': () => [502, { message: 'bad gateway' }] });
  await assert.rejects(
    createRepositoryWebhook({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', config: CONFIG, fetchImpl: down.fetchImpl }),
    (error) => error.kind === 'unavailable' && !shortError(error).includes(TOKEN) && !error.message.includes(SECRET)
  );
});

test('deleteRepositoryWebhook removes the hook; an already-removed hook counts as removed', async () => {
  const github = fakeGithub({ 'DELETE /repos/octo-owner/devorbit/hooks/555': () => [204, null] });
  assert.deepEqual(await deleteRepositoryWebhook({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', hookId: 555, fetchImpl: github.fetchImpl }), { removed: true });
  const gone = fakeGithub({ 'DELETE /repos/octo-owner/devorbit/hooks/555': () => [404, { message: 'Not Found' }] });
  assert.deepEqual(await deleteRepositoryWebhook({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', hookId: 555, fetchImpl: gone.fetchImpl }), { removed: true });
  assert.deepEqual(await deleteRepositoryWebhook({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', hookId: null, fetchImpl: async () => assert.fail('no call') }), { removed: true });
});

test('webhookView shows status for the connected repository only, never the hook secret', () => {
  const connection = { repository: { githubId: 101 }, webhook: { status: 'active', hookId: 5, repositoryId: 101, message: 'ok', updatedAt: new Date(0) } };
  const view = webhookView(connection);
  assert.deepEqual(Object.keys(view).sort(), ['events', 'message', 'status', 'updatedAt']);
  assert.equal(view.status, 'active');
  assert.equal(webhookView({ repository: { githubId: 202 }, webhook: connection.webhook }), null, 'hook was for the old repository');
  assert.equal(webhookView({ repository: { githubId: 101 }, webhook: null }), null);
});
