// [Sprint 4 · M4] US-34 See GitHub events in the feed (FR-12, NFR-11a, NFR-11b).
// "Given a repository is connected, when a commit is pushed, or an issue or pull request is opened or
//  updated, then a feed entry showing event type, title, author and a link to GitHub appears within 60 seconds."
// GitHub is never called: deliveries are signed here, and globalThis.fetch is a fake GitHub.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import GithubConnection from '../src/models/GithubConnection.js';
import GithubFeedKey from '../src/models/GithubFeedKey.js';
import WebhookDelivery from '../src/models/WebhookDelivery.js';
import Activity from '../src/models/Activity.js';
import { encryptToken } from '../src/lib/githubCrypto.js';
import { signPayload } from '../src/lib/githubWebhooks.js';
import { webhookOptions, waitForWebhookWork } from '../src/routes/githubWebhook.js';

const TOKEN = 'gho_M4_TEST_TOKEN_never_leaves_server_4321';
const SECRET = 'm4-webhook-secret-for-tests-abcdef0123';
const ENV = {
  GITHUB_CLIENT_ID: 'Iv1.testclientid',
  GITHUB_CLIENT_SECRET: 'test-client-secret-value-abcdef',
  GITHUB_CALLBACK_URL: 'http://localhost:5000/api/github/callback',
  GITHUB_TOKEN_KEY: 'c'.repeat(64),
  GITHUB_WEBHOOK_SECRET: SECRET,
  GITHUB_WEBHOOK_URL: 'https://forge.example.com/api/github/webhook',
};
const GITHUB_USER_ID = 4242;
const REPO = { id: 101, full_name: 'octo-owner/devorbit' };
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);

let app;
let owner, admin, contributor;
let projectId;
let deliveryCounter = 0;

const as = (account) => authed(app, account.token);
const put = (account, url) => request(app).put(url).set('Authorization', `Bearer ${account.token}`);

function setEnv(on) {
  for (const [name, value] of Object.entries(ENV)) {
    if (on) process.env[name] = value;
    else delete process.env[name];
  }
}

// Sends a delivery the way GitHub does: raw JSON body, signed with the shared secret.
function deliver(event, payload, { deliveryId = `delivery-${++deliveryCounter}`, signature, secret = SECRET } = {}) {
  const body = JSON.stringify(payload);
  const req = request(app)
    .post('/api/github/webhook')
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', event)
    .set('X-GitHub-Delivery', deliveryId);
  const sig = signature === undefined ? signPayload(secret, Buffer.from(body)) : signature;
  if (sig !== null) req.set('X-Hub-Signature-256', sig);
  return req.send(body);
}

const pushPayload = (commits = [{ id: SHA1, message: 'Fix login bug\n\nDetails', author: 'octocat' }]) => ({
  ref: 'refs/heads/main',
  repository: REPO,
  sender: { login: 'octocat' },
  commits: commits.map((c) => ({
    id: c.id,
    message: c.message,
    url: `https://github.com/octo-owner/devorbit/commit/${c.id}`,
    author: { name: c.author, username: c.author },
  })),
});
const issuePayload = (action = 'opened', extra = {}) => ({
  action,
  repository: REPO,
  sender: { login: 'riya-gh' },
  issue: { number: 12, title: 'Login fails on Safari', html_url: 'https://github.com/octo-owner/devorbit/issues/12', updated_at: `2026-11-02T08:00:0${deliveryCounter % 10}Z`, ...extra },
});
const prPayload = (action = 'opened', extra = {}) => ({
  action,
  number: 7,
  repository: REPO,
  sender: { login: 'dev-gh' },
  pull_request: { number: 7, title: 'Add webhooks', html_url: 'https://github.com/octo-owner/devorbit/pull/7', updated_at: '2026-11-02T09:00:00Z', merged: false, head: { sha: SHA2 }, ...extra },
});

// M1 (authorize) + M2 (choose repository) stored directly.
async function connectRepository({ project = projectId, repositoryId = REPO.id, fullName = REPO.full_name, webhook = null } = {}) {
  return GithubConnection.findOneAndUpdate(
    { project },
    {
      project,
      authorizedBy: owner.user.id,
      githubUserId: GITHUB_USER_ID,
      githubLogin: 'octo-owner',
      scopes: ['repo'],
      encryptedToken: encryptToken(TOKEN),
      authorizedAt: new Date(),
      repository: {
        githubId: repositoryId, name: fullName.split('/')[1], fullName, owner: fullName.split('/')[0],
        private: false, htmlUrl: `https://github.com/${fullName}`, defaultBranch: 'main', admin: true,
        githubUserId: GITHUB_USER_ID, connectedBy: owner.user.id, connectedAt: new Date(),
      },
      webhook,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

const githubFeed = () => Activity.find({ project: projectId, type: /^github\./ }).sort({ createdAt: 1, _id: 1 }).lean();

// Fake GitHub for M2's PUT route + M4's hook calls.
let realFetch;
let githubCalls;
const rawRepo = (id, fullName, admin = true) => ({
  id, name: fullName.split('/')[1], full_name: fullName, owner: { login: fullName.split('/')[0] }, private: false,
  html_url: `https://github.com/${fullName}`, default_branch: 'main', permissions: { admin, push: true, pull: true },
});
function fakeGithub({ hookStatus = 201 } = {}) {
  githubCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const key = `${options.method || 'GET'} ${path}`;
    githubCalls.push({ key, body: options.body ? JSON.parse(options.body) : null });
    const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (key === 'GET /user/repos') return json(200, [rawRepo(101, 'octo-owner/devorbit'), rawRepo(102, 'octo-owner/notes'), rawRepo(103, 'campus-org/shared-app', false)]);
    if (key === 'POST /repos/octo-owner/devorbit/hooks') return json(hookStatus, hookStatus === 201 ? { id: 555 } : { message: 'no' });
    if (key === 'POST /repos/octo-owner/notes/hooks') return json(201, { id: 666 });
    if (key === 'DELETE /repos/octo-owner/devorbit/hooks/555') return json(204, null);
    throw new Error(`Unexpected request to ${key}`);
  };
}

let logged;
const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'];
const originalConsole = {};

before(async () => {
  ({ app } = await setup());
  realFetch = globalThis.fetch;
  [owner, admin, contributor] = await Promise.all(['Hook Owner', 'Hook Admin', 'Hook Contributor'].map((name) => signup(app, name)));
  const project = await as(owner).post('/api/projects').send({ name: 'Webhook Project' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  webhookOptions.sleep = async () => {};
  webhookOptions.baseDelayMs = 1;
});

beforeEach(async () => {
  setEnv(true);
  fakeGithub();
  await Promise.all([GithubConnection.deleteMany({}), WebhookDelivery.deleteMany({}), GithubFeedKey.deleteMany({}), Activity.deleteMany({ type: /^github\./ })]);
  logged = [];
  for (const method of consoleMethods) {
    originalConsole[method] = console[method];
    console[method] = (...args) => { logged.push(args.map(String).join(' ')); };
  }
});

afterEach(async () => {
  await waitForWebhookWork();
  for (const method of consoleMethods) console[method] = originalConsole[method];
  globalThis.fetch = realFetch;
  assert.equal(logged.join('\n').includes(TOKEN), false, 'token in a log line');
  assert.equal(logged.join('\n').includes(SECRET), false, 'webhook secret in a log line');
});

after(async () => {
  setEnv(false);
  globalThis.fetch = realFetch;
  await teardown();
});

// ---------------------------------------------------------------------------------------------
// Acceptance criterion
// ---------------------------------------------------------------------------------------------
test('AC: a pushed commit appears in the project feed with type, title, author and GitHub link', async () => {
  await connectRepository();
  const res = await deliver('push', pushPayload());
  assert.equal(res.status, 202, JSON.stringify(res.body));
  await waitForWebhookWork();

  const feed = await as(owner).get(`/api/projects/${projectId}/activity`);
  assert.equal(feed.status, 200);
  const entry = feed.body.activity.find((item) => item.type === 'github.commit');
  assert.ok(entry, 'commit in the feed');
  assert.equal(entry.actor, null);
  assert.equal(entry.targetType, 'github');
  assert.equal(entry.meta.title, 'Fix login bug');
  assert.equal(entry.meta.author, 'octocat');
  assert.equal(entry.meta.url, `https://github.com/octo-owner/devorbit/commit/${SHA1}`);
  assert.match(entry.summary, /pushed commit "Fix login bug" to main/);
  // "within 60 seconds": it is saved (and pushed live over socket.io by logActivity) right after the delivery.
  assert.ok(Date.now() - new Date(entry.createdAt).getTime() < 60_000);

  const delivery = await WebhookDelivery.findOne({ event: 'push' }).lean();
  assert.equal(delivery.status, 'processed');
  assert.equal(delivery.entries, 1);
  assert.equal(delivery.attempts, 1);
  assert.deepEqual(delivery.projects.map(String), [projectId]);
});

test('AC: an opened or updated issue and pull request appear in the feed', async () => {
  await connectRepository();
  // One at a time so the feed order is predictable (processing runs in the background).
  for (const [event, payload] of [
    ['issues', issuePayload('opened')],
    ['issues', issuePayload('closed')],
    ['pull_request', prPayload('opened')],
    ['pull_request', prPayload('closed', { merged: true, updated_at: '2026-11-02T10:00:00Z' })],
  ]) {
    assert.equal((await deliver(event, payload)).status, 202);
    await waitForWebhookWork();
  }

  const feed = await githubFeed();
  assert.deepEqual(feed.map((e) => [e.type, e.meta.action]), [
    ['github.issue', 'opened'],
    ['github.issue', 'closed'],
    ['github.pull_request', 'opened'],
    ['github.pull_request', 'merged'],
  ]);
  assert.equal(feed[0].meta.author, 'riya-gh');
  assert.equal(feed[0].meta.url, 'https://github.com/octo-owner/devorbit/issues/12');
  assert.equal(feed[3].summary, 'merged pull request #7 "Add webhooks"');
});

// ---------------------------------------------------------------------------------------------
// Signature (NFR-11a)
// ---------------------------------------------------------------------------------------------
test('a missing or wrong X-Hub-Signature-256 is rejected with 401 and nothing is stored', async () => {
  await connectRepository();
  const missing = await deliver('push', pushPayload(), { signature: null });
  assert.equal(missing.status, 401);
  const wrongSecret = await deliver('push', pushPayload(), { secret: 'not-the-real-secret-at-all-xyz' });
  assert.equal(wrongSecret.status, 401);
  const garbage = await deliver('push', pushPayload(), { signature: 'sha256=deadbeef' });
  assert.equal(garbage.status, 401);

  // Signed body, then the body is changed in transit.
  const body = JSON.stringify(pushPayload());
  const tampered = await request(app).post('/api/github/webhook')
    .set('Content-Type', 'application/json').set('X-GitHub-Event', 'push').set('X-GitHub-Delivery', 'tampered-1')
    .set('X-Hub-Signature-256', signPayload(SECRET, Buffer.from(body)))
    .send(body.replace('Fix login bug', 'Evil commit'));
  assert.equal(tampered.status, 401);

  await waitForWebhookWork();
  assert.equal(await WebhookDelivery.countDocuments(), 0);
  assert.equal((await githubFeed()).length, 0);
});

test('503 and no processing when the webhook secret is not configured on the server', async () => {
  await connectRepository();
  delete process.env.GITHUB_WEBHOOK_SECRET;
  const res = await deliver('push', pushPayload());
  assert.equal(res.status, 503);
  assert.equal(await WebhookDelivery.countDocuments(), 0);
});

test('400 for missing GitHub headers or a body that is not JSON (after the signature check)', async () => {
  const noEvent = await request(app).post('/api/github/webhook').set('Content-Type', 'application/json')
    .set('X-GitHub-Delivery', 'd-1').set('X-Hub-Signature-256', signPayload(SECRET, Buffer.from('{}'))).send('{}');
  assert.equal(noEvent.status, 400);
  const form = 'payload=%7B%7D';
  const notJson = await request(app).post('/api/github/webhook').set('Content-Type', 'application/x-www-form-urlencoded')
    .set('X-GitHub-Event', 'push').set('X-GitHub-Delivery', 'd-2').set('X-Hub-Signature-256', signPayload(SECRET, Buffer.from(form))).send(form);
  assert.equal(notJson.status, 400);
});

test('ping is answered with 200 and recorded for troubleshooting', async () => {
  const res = await deliver('ping', { zen: 'Design for failure.', hook_id: 555, repository: REPO }, { deliveryId: 'ping-1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.pong, true);
  const delivery = await WebhookDelivery.findOne({ deliveryId: 'ping-1' }).lean();
  assert.equal(delivery.status, 'ignored');
});

// ---------------------------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------------------------
test('the same delivery twice gives one feed entry', async () => {
  await connectRepository();
  const first = await deliver('push', pushPayload(), { deliveryId: 'same-delivery' });
  assert.equal(first.status, 202);
  const again = await deliver('push', pushPayload(), { deliveryId: 'same-delivery' });
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  await waitForWebhookWork();
  assert.equal((await githubFeed()).length, 1);
  assert.equal(await WebhookDelivery.countDocuments({ deliveryId: 'same-delivery' }), 1);
});

test('the same event redelivered under a new delivery ID still gives one feed entry', async () => {
  await connectRepository();
  await deliver('push', pushPayload(), { deliveryId: 'redeliver-a' });
  await waitForWebhookWork();
  // The commit pushed again (e.g. to a second branch) plus one new commit.
  await deliver('push', pushPayload([
    { id: SHA1, message: 'Fix login bug', author: 'octocat' },
    { id: SHA2, message: 'Add tests', author: 'octocat' },
  ]), { deliveryId: 'redeliver-b' });
  await waitForWebhookWork();

  const feed = await githubFeed();
  assert.deepEqual(feed.map((e) => e.meta.sha), [SHA1, SHA2]);
  const second = await WebhookDelivery.findOne({ deliveryId: 'redeliver-b' }).lean();
  assert.equal(second.entries, 1);
});

// ---------------------------------------------------------------------------------------------
// Which projects get the event
// ---------------------------------------------------------------------------------------------
test('events for a repository no project has connected are ignored', async () => {
  await connectRepository({ repositoryId: 999, fullName: 'octo-owner/other' });
  await deliver('push', pushPayload(), { deliveryId: 'unconnected' });
  await waitForWebhookWork();
  assert.equal((await githubFeed()).length, 0);
  const delivery = await WebhookDelivery.findOne({ deliveryId: 'unconnected' }).lean();
  assert.equal(delivery.status, 'ignored');
  assert.match(delivery.reason, /No project/);
});

test('after the connection is removed (US-33 disconnect), new events stop and old entries stay', async () => {
  await connectRepository();
  await deliver('push', pushPayload());
  await waitForWebhookWork();
  assert.equal((await githubFeed()).length, 1);

  await GithubConnection.deleteMany({ project: projectId });
  await deliver('issues', issuePayload('opened'), { deliveryId: 'after-disconnect' });
  await waitForWebhookWork();

  const feed = await githubFeed();
  assert.equal(feed.length, 1, 'no new entry');
  assert.equal(feed[0].type, 'github.commit', 'old entry kept');
  assert.equal((await WebhookDelivery.findOne({ deliveryId: 'after-disconnect' }).lean()).status, 'ignored');
});

test('a connection that is not Active (repository chosen under another GitHub account) gets nothing', async () => {
  const connection = await connectRepository();
  await GithubConnection.updateOne({ _id: connection._id }, { $set: { githubUserId: 9999 } }); // re-authorized as someone else
  await deliver('push', pushPayload(), { deliveryId: 'inactive' });
  await waitForWebhookWork();
  assert.equal((await githubFeed()).length, 0);
});

test('events and actions not shown in the feed are recorded as ignored', async () => {
  await connectRepository();
  await deliver('star', { action: 'created', repository: REPO, sender: { login: 'x' } }, { deliveryId: 'star' });
  await deliver('issues', issuePayload('labeled'), { deliveryId: 'labeled' });
  await waitForWebhookWork();
  assert.equal((await githubFeed()).length, 0);
  assert.equal((await WebhookDelivery.findOne({ deliveryId: 'star' }).lean()).status, 'ignored');
  assert.equal((await WebhookDelivery.findOne({ deliveryId: 'labeled' }).lean()).status, 'ignored');
});

// ---------------------------------------------------------------------------------------------
// Retry and logging (NFR-11a)
// ---------------------------------------------------------------------------------------------
test('failed processing is retried 3 times, then the final failure is logged and recorded', async () => {
  await connectRepository();
  const realCreate = Activity.create;
  let calls = 0;
  Activity.create = async () => { calls += 1; throw new Error('database unavailable'); };
  try {
    await deliver('push', pushPayload(), { deliveryId: 'always-fails' });
    await waitForWebhookWork();
  } finally {
    Activity.create = realCreate;
  }
  assert.equal(calls, 4, '1 attempt + 3 retries');
  const delivery = await WebhookDelivery.findOne({ deliveryId: 'always-fails' }).lean();
  assert.equal(delivery.status, 'failed');
  assert.equal(delivery.attempts, 4);
  assert.match(delivery.lastError, /Could not save the feed entry/);
  const finalLog = logged.filter((line) => line.includes('always-fails'));
  assert.equal(finalLog.length, 1, 'only the final failure is logged');
  assert.match(finalLog[0], /failed after 4 attempts/);
  assert.equal(finalLog[0].includes('Fix login bug'), false, 'no payload in the log');
  // The key was released, so a later redelivery can still add the entry.
  assert.equal(await GithubFeedKey.countDocuments(), 0);
});

test('a temporary failure succeeds on retry with one feed entry', async () => {
  await connectRepository();
  const realCreate = Activity.create;
  let calls = 0;
  Activity.create = async (...args) => { calls += 1; if (calls === 1) throw new Error('blip'); return realCreate.apply(Activity, args); };
  try {
    await deliver('push', pushPayload(), { deliveryId: 'flaky' });
    await waitForWebhookWork();
  } finally {
    Activity.create = realCreate;
  }
  const delivery = await WebhookDelivery.findOne({ deliveryId: 'flaky' }).lean();
  assert.equal(delivery.status, 'processed');
  assert.equal(delivery.attempts, 2);
  assert.equal((await githubFeed()).length, 1);
});

// ---------------------------------------------------------------------------------------------
// Webhook registration when the Owner chooses the repository (M2's PUT route)
// ---------------------------------------------------------------------------------------------
async function authorizeOnly() {
  return GithubConnection.findOneAndUpdate(
    { project: projectId },
    { project: projectId, authorizedBy: owner.user.id, githubUserId: GITHUB_USER_ID, githubLogin: 'octo-owner', scopes: ['repo'], encryptedToken: encryptToken(TOKEN), authorizedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

test('choosing a repository the account administers creates a signed webhook and shows it as active', async () => {
  await authorizeOnly();
  const res = await put(owner, `/api/projects/${projectId}/github/repository`).send({ repositoryId: 101 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.active, true);
  assert.equal(res.body.webhook.status, 'active');
  assert.deepEqual(res.body.webhook.events, ['push', 'issues', 'pull_request']);

  const hookCall = githubCalls.find((call) => call.key === 'POST /repos/octo-owner/devorbit/hooks');
  assert.ok(hookCall, 'hook created');
  assert.equal(hookCall.body.config.secret, SECRET);
  assert.equal(hookCall.body.config.url, ENV.GITHUB_WEBHOOK_URL);
  assert.equal(hookCall.body.config.content_type, 'json');

  const stored = await GithubConnection.findOne({ project: projectId }).lean();
  assert.equal(stored.webhook.hookId, 555);
  assert.equal(stored.webhook.repositoryId, 101);

  const status = await as(admin).get(`/api/projects/${projectId}/github`);
  assert.equal(status.body.webhook.status, 'active');
  for (const body of [res.body, status.body]) {
    const text = JSON.stringify(body);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes(SECRET), false);
    assert.equal(text.includes('hookId'), false);
  }
});

test('no admin rights on the repository: it is still connected, webhook shows "not set up", GitHub is not asked', async () => {
  await authorizeOnly();
  const res = await put(owner, `/api/projects/${projectId}/github/repository`).send({ repositoryId: 103 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.active, true);
  assert.equal(res.body.webhook.status, 'not_admin');
  assert.match(res.body.webhook.message, /not an admin/);
  assert.equal(githubCalls.some((call) => call.key.includes('/hooks')), false);
});

test('webhook settings missing on the server: repository still connected, webhook not_configured', async () => {
  await authorizeOnly();
  delete process.env.GITHUB_WEBHOOK_URL;
  const res = await put(owner, `/api/projects/${projectId}/github/repository`).send({ repositoryId: 101 });
  assert.equal(res.status, 200);
  assert.equal(res.body.webhook.status, 'not_configured');
});

test('GitHub failing to create the hook does not fail choosing the repository', async () => {
  await authorizeOnly();
  fakeGithub({ hookStatus: 502 });
  const res = await put(owner, `/api/projects/${projectId}/github/repository`).send({ repositoryId: 101 });
  assert.equal(res.status, 200);
  assert.equal(res.body.active, true);
  assert.equal(res.body.webhook.status, 'failed');
  assert.match(res.body.webhook.message, /retry/i);
});

test('changing the repository removes the hook from the old one and adds it to the new one', async () => {
  await authorizeOnly();
  assert.equal((await put(owner, `/api/projects/${projectId}/github/repository`).send({ repositoryId: 101 })).status, 200);
  const res = await put(owner, `/api/projects/${projectId}/github/repository`).send({ repositoryId: 102 });
  assert.equal(res.status, 200);
  assert.ok(githubCalls.some((call) => call.key === 'DELETE /repos/octo-owner/devorbit/hooks/555'), 'old hook removed');
  assert.ok(githubCalls.some((call) => call.key === 'POST /repos/octo-owner/notes/hooks'), 'new hook created');
  const stored = await GithubConnection.findOne({ project: projectId }).lean();
  assert.equal(stored.webhook.hookId, 666);
  assert.equal(stored.webhook.repositoryId, 102);
});

// ---------------------------------------------------------------------------------------------
// Delivery log for troubleshooting
// ---------------------------------------------------------------------------------------------
test('Owner and Admin can see recent deliveries (metadata only); others cannot', async () => {
  await connectRepository();
  await deliver('push', pushPayload(), { deliveryId: 'log-1' });
  await deliver('issues', issuePayload('labeled'), { deliveryId: 'log-2' });
  await waitForWebhookWork();

  for (const account of [owner, admin]) {
    const res = await as(account).get(`/api/projects/${projectId}/github/deliveries`);
    assert.equal(res.status, 200);
    const ids = res.body.deliveries.map((d) => d.deliveryId);
    assert.deepEqual(new Set(ids), new Set(['log-1', 'log-2']));
    const push = res.body.deliveries.find((d) => d.deliveryId === 'log-1');
    assert.equal(push.status, 'processed');
    assert.equal(push.event, 'push');
    assert.equal(JSON.stringify(res.body).includes('Fix login bug'), false, 'no payload content');
  }
  const forbidden = await as(contributor).get(`/api/projects/${projectId}/github/deliveries`);
  assert.equal(forbidden.status, 403);
  const anonymous = await request(app).get(`/api/projects/${projectId}/github/deliveries`);
  assert.equal(anonymous.status, 401);
});
