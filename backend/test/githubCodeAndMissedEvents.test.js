// [Sprint 7 · M8] D3 (real Code & files) and missed GitHub events, through the API with a real database.
// GitHub itself is never called: globalThis.fetch is replaced per test with a fake GitHub.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Activity from '../src/models/Activity.js';
import GithubConnection from '../src/models/GithubConnection.js';
import Project from '../src/models/Project.js';
import WebhookDelivery from '../src/models/WebhookDelivery.js';
import { encryptToken } from '../src/lib/githubCrypto.js';
import { clearCodeCache } from '../src/lib/githubCode.js';
import { signPayload } from '../src/lib/githubWebhooks.js';
import { runMissedEventsCheck } from '../src/lib/githubMissedEvents.js';
import { MAX_REDELIVERIES_PER_RUN } from '../src/lib/githubMissedEventsRules.js';
import { webhookOptions, waitForWebhookWork } from '../src/routes/githubWebhook.js';

const TOKEN = 'gho_S7M8_TOKEN_never_leaves_server_0001';
const GITHUB_ENV = {
  GITHUB_CLIENT_ID: 'Iv1.s7m8client',
  GITHUB_CLIENT_SECRET: 's7m8-client-secret-value',
  GITHUB_CALLBACK_URL: 'http://localhost:5000/api/github/callback',
  GITHUB_TOKEN_KEY: 'c'.repeat(64),
};
const WEBHOOK_SECRET = 's7m8-webhook-secret-for-tests-0123456789';
const WEBHOOK_ENV = { GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET, GITHUB_WEBHOOK_URL: 'https://forge.example.com/api/github/webhook' };
const GITHUB_USER = { id: 5151, login: 'octo-owner' };
const REPO = { githubId: 101, fullName: 'octo-owner/devorbit' };
const HOOK_ID = 77;
const ACTIVE_HOOK = { status: 'active', hookId: HOOK_ID, repositoryId: REPO.githubId, message: '', updatedAt: new Date() };

let app;
let owner, admin, contributor, viewer, outsider;
let projectId;

const as = (account) => authed(app, account.token);
const codeUrl = (id = projectId) => `/api/projects/${id}/github/code`;
const recheckUrl = (id = projectId) => `/api/projects/${id}/github/webhook/recheck`;

function setEnv(values, on) {
  for (const [name, value] of Object.entries(values)) {
    if (on) process.env[name] = value;
    else delete process.env[name];
  }
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const rawRepo = (extra = {}) => ({
  id: REPO.githubId, name: 'devorbit', full_name: REPO.fullName, owner: { login: 'octo-owner' }, private: true,
  html_url: `https://github.com/${REPO.fullName}`, default_branch: 'main', stargazers_count: 7, forks_count: 2,
  open_issues_count: 5, pushed_at: '2026-11-20T10:00:00Z', permissions: { admin: true }, ...extra,
});
const contents = () => [
  { name: 'README.md', type: 'file', html_url: `https://github.com/${REPO.fullName}/blob/main/README.md` },
  { name: 'src', type: 'dir', html_url: `https://github.com/${REPO.fullName}/tree/main/src` },
  { name: 'package.json', type: 'file', html_url: `https://github.com/${REPO.fullName}/blob/main/package.json` },
];

// Fake GitHub: answers can be replaced per test; every call is recorded.
let realFetch;
let calls;
let answers;
function fakeGithub(overrides = {}) {
  calls = [];
  answers = {
    repository: json(rawRepo()),
    contents: json(contents()),
    deliveries: json([]),
    redeliver: new Response(null, { status: 202 }),
    ...overrides,
  };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', options });
    const { host, pathname } = new URL(url);
    const answer = (value) => (typeof value === 'function' ? value(url, options) : value.clone());
    if (host !== 'api.github.com') throw new Error(`Unexpected request to ${url}`);
    if (pathname === `/repositories/${REPO.githubId}`) return answer(answers.repository);
    if (pathname === `/repos/${REPO.fullName}/contents`) return answer(answers.contents);
    if (pathname === `/repos/${REPO.fullName}/hooks/${HOOK_ID}/deliveries`) return answer(answers.deliveries);
    if (pathname.startsWith(`/repos/${REPO.fullName}/hooks/${HOOK_ID}/deliveries/`) && options.method === 'POST') return answer(answers.redeliver);
    throw new Error(`Unexpected request to ${url}`);
  };
}
const githubCallsTo = (part) => calls.filter((call) => call.url.includes(part));

async function connect({ project = projectId, extra = {} } = {}) {
  await GithubConnection.findOneAndUpdate(
    { project },
    {
      project,
      authorizedBy: owner.user.id,
      githubUserId: GITHUB_USER.id,
      githubLogin: GITHUB_USER.login,
      scopes: ['repo'],
      encryptedToken: encryptToken(TOKEN),
      authorizedAt: new Date(),
      repository: {
        githubId: REPO.githubId, name: 'devorbit', fullName: REPO.fullName, owner: 'octo-owner', private: true,
        htmlUrl: `https://github.com/${REPO.fullName}`, defaultBranch: 'main', admin: true,
        githubUserId: GITHUB_USER.id, connectedBy: owner.user.id, connectedAt: new Date(),
      },
      webhook: ACTIVE_HOOK,
      status: 'connected', disconnectedAt: null, disconnectedBy: null,
      needsReauthorization: false, reauthorizationReason: '', lastCheckedAt: null, repositoryCheck: null, webhookLeft: null,
      ...extra,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

const noToken = (...bodies) => {
  for (const body of bodies) assert.equal(JSON.stringify(body).includes(TOKEN), false, 'token in a response');
};

// GitHub's delivery log.
const NOW = Date.now();
let nextDeliveryId = 1000;
const logEntry = (guid, { status = 502, event = 'push', minutesAgo = 30, redelivery = false } = {}) => ({
  id: nextDeliveryId++, guid, delivered_at: new Date(NOW - minutesAgo * 60_000).toISOString(), redelivery,
  status_code: status, event, action: event === 'push' ? null : 'opened', repository_id: REPO.githubId,
});
const redeliveredIds = () => githubCallsTo('/attempts').map((call) => Number(/deliveries\/(\d+)\/attempts/.exec(call.url)[1]));

function deliverPush(deliveryId) {
  const sha = createHash('sha1').update(deliveryId).digest('hex');
  const body = JSON.stringify({
    ref: 'refs/heads/main',
    repository: { id: REPO.githubId, full_name: REPO.fullName },
    sender: { login: 'octocat' },
    commits: [{ id: sha, message: `Commit for ${deliveryId}`, url: `https://github.com/${REPO.fullName}/commit/${sha}`, author: { name: 'octocat', username: 'octocat' } }],
  });
  return request(app)
    .post('/api/github/webhook')
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', 'push')
    .set('X-GitHub-Delivery', deliveryId)
    .set('X-Hub-Signature-256', signPayload(WEBHOOK_SECRET, Buffer.from(body)))
    .send(body);
}

before(async () => {
  ({ app } = await setup());
  realFetch = globalThis.fetch;
  webhookOptions.sleep = async () => {};
  webhookOptions.baseDelayMs = 1;
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['S7M8 Owner', 'S7M8 Admin', 'S7M8 Contributor', 'S7M8 Viewer', 'S7M8 Outsider'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'Sprint 7 M8 Project', visibility: 'Public' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

beforeEach(async () => {
  setEnv(GITHUB_ENV, true);
  setEnv(WEBHOOK_ENV, true);
  fakeGithub();
  clearCodeCache();
  await GithubConnection.deleteMany({});
  await WebhookDelivery.deleteMany({});
  await Activity.deleteMany({ project: projectId });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

after(async () => {
  setEnv(GITHUB_ENV, false);
  setEnv(WEBHOOK_ENV, false);
  await teardown();
});

// --- D3: Code & files -----------------------------------------------------------------------

test('D3: every member (Viewer too) sees the real repository numbers and top-level files, no token', async () => {
  await connect();
  for (const account of [owner, admin, contributor, viewer]) {
    clearCodeCache();
    const res = await as(account).get(codeUrl());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.state, 'active');
    assert.deepEqual(res.body.repository, { fullName: REPO.fullName, htmlUrl: `https://github.com/${REPO.fullName}`, defaultBranch: 'main', private: true });
    assert.deepEqual(res.body.stats, { stars: 7, forks: 2, openIssuesAndPrs: 5, pushedAt: '2026-11-20T10:00:00Z' });
    assert.deepEqual(res.body.files.map((f) => `${f.type}:${f.name}`), ['dir:src', 'file:package.json', 'file:README.md']);
    assert.notEqual(res.body.stats.forks, 12, 'not the old sample "12 forks"');
    noToken(res.body);
  }
  assert.equal(githubCallsTo(`/repositories/${REPO.githubId}`)[0].options.headers.Authorization, `Bearer ${TOKEN}`);
});

test('D3: not signed in 401, not a member 403; nothing is asked from GitHub', async () => {
  await connect();
  assert.equal((await request(app).get(codeUrl())).status, 401);
  assert.equal((await as(outsider).get(codeUrl())).status, 403);
  assert.equal(calls.length, 0);
});

test('D3: no repository yet -> not_connected / needs_repository / disconnected, without fake data', async () => {
  let res = await as(viewer).get(codeUrl());
  assert.equal(res.body.state, 'not_connected');
  assert.equal(res.body.stats, null);
  assert.deepEqual(res.body.files, []);

  await connect({ extra: { repository: null, webhook: null } });
  res = await as(viewer).get(codeUrl());
  assert.equal(res.body.state, 'needs_repository');

  await connect({ extra: { status: 'disconnected', disconnectedAt: new Date() } });
  res = await as(viewer).get(codeUrl());
  assert.equal(res.body.state, 'disconnected');
  assert.equal(res.body.repository, null);
  assert.equal(calls.length, 0, 'GitHub is not called for any of these');
});

test('D3: answers are cached for about a minute (reloads do not call GitHub again)', async () => {
  await connect();
  await as(owner).get(codeUrl());
  await as(viewer).get(codeUrl());
  assert.equal(githubCallsTo(`/repositories/${REPO.githubId}`).length, 1);
});

test('D3: GitHub rejects the token (401) -> unavailable + recorded as needing re-authorization, never a 500', async () => {
  await connect();
  fakeGithub({ repository: json({ message: 'Bad credentials' }, 401) });
  const res = await as(contributor).get(codeUrl());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.state, 'unavailable');
  assert.equal(res.body.reason, 'reauthorize');
  assert.equal(res.body.stats, null);
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).needsReauthorization, true);
  // The next request answers from the database, without asking GitHub.
  const again = await as(contributor).get(codeUrl());
  assert.equal(again.body.reason, 'reauthorize');
  assert.equal(githubCallsTo(`/repositories/${REPO.githubId}`).length, 1);
  noToken(res.body, again.body);
});

test('D3: a deleted repository or a GitHub outage -> unavailable with the stored name, never fake numbers', async () => {
  await connect();
  fakeGithub({ repository: json({ message: 'Not Found' }, 404) });
  let res = await as(owner).get(codeUrl());
  assert.equal(res.body.state, 'unavailable');
  assert.equal(res.body.reason, 'repository_unavailable');
  assert.equal(res.body.repository.fullName, REPO.fullName);
  assert.equal(res.body.stats, null);

  clearCodeCache();
  fakeGithub({ repository: () => { throw new TypeError('fetch failed'); } });
  res = await as(owner).get(codeUrl());
  assert.equal(res.status, 200);
  assert.equal(res.body.reason, 'unavailable');
});

test('D3: an empty repository says so', async () => {
  await connect();
  fakeGithub({ contents: json({ message: 'This repository is empty.' }, 404) });
  const res = await as(owner).get(codeUrl());
  assert.equal(res.body.state, 'active');
  assert.equal(res.body.empty, true);
  assert.deepEqual(res.body.files, []);
});

// --- Missed events: POST /recheck -------------------------------------------------------------

test('missed events: only deliveries GitHub failed to send AND we never stored are re-sent', async () => {
  await connect();
  await WebhookDelivery.create({ deliveryId: 'g-stored', event: 'push', repositoryId: REPO.githubId, status: 'processed' });
  const missed1 = logEntry('g-asleep-1', { status: 0, minutesAgo: 50 });
  const missed2 = logEntry('g-asleep-2', { status: 502, event: 'issues', minutesAgo: 40 });
  fakeGithub({
    deliveries: json([
      logEntry('g-ok', { status: 202, minutesAgo: 5 }),
      logEntry('g-stored', { status: 504, minutesAgo: 10 }),
      logEntry('g-ping', { status: 503, event: 'ping', minutesAgo: 15 }),
      missed2,
      missed1,
    ]),
  });

  const res = await as(admin).post(recheckUrl());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.redelivered, 2);
  assert.equal(res.body.checked, 4, 'push/issues deliveries of the last 24 hours');
  assert.match(res.body.message, /send 2 missed events again/);
  assert.deepEqual(redeliveredIds(), [missed1.id, missed2.id], 'oldest first');
  assert.equal(githubCallsTo('/attempts')[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  noToken(res.body);
});

test('missed events: a re-sent delivery goes through the normal webhook once; checking again finds nothing', async () => {
  await connect();
  const entry = logEntry('g-while-asleep', { status: 0 });
  fakeGithub({ deliveries: json([entry]) });
  assert.equal((await as(owner).post(recheckUrl())).body.redelivered, 1);

  // GitHub sends it again with the same delivery ID: added to the feed once.
  assert.equal((await deliverPush('g-while-asleep')).status, 202);
  await waitForWebhookWork();
  assert.equal((await deliverPush('g-while-asleep')).body.duplicate, true, 'a second copy is not processed');
  await waitForWebhookWork();
  assert.equal(await Activity.countDocuments({ project: projectId, type: /^github\./ }), 1);

  // The log still shows the failed attempt, but we have it now.
  calls = [];
  const again = await as(owner).post(recheckUrl());
  assert.equal(again.body.redelivered, 0);
  assert.equal(again.body.message, 'No missed GitHub events in the last 24 hours.');
  assert.equal(githubCallsTo('/attempts').length, 0);
});

test(`missed events: at most ${MAX_REDELIVERIES_PER_RUN} re-sends per check`, async () => {
  await connect();
  fakeGithub({ deliveries: json(Array.from({ length: 30 }, (_, i) => logEntry(`g-many-${i}`, { minutesAgo: 100 - i }))) });
  const res = await as(owner).post(recheckUrl());
  assert.equal(res.body.redelivered, MAX_REDELIVERIES_PER_RUN);
  assert.equal(githubCallsTo('/attempts').length, MAX_REDELIVERIES_PER_RUN);
});

test('missed events: Contributors, Viewers and outsiders cannot run the check', async () => {
  await connect();
  for (const account of [contributor, viewer, outsider]) {
    assert.equal((await as(account).post(recheckUrl())).status, 403, account.user.name);
  }
  assert.equal((await request(app).post(recheckUrl())).status, 401);
  assert.equal(calls.length, 0);
});

test('missed events: nothing to check -> 409 / 503 with a reason', async () => {
  let res = await as(owner).post(recheckUrl());
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'github_not_authorized');

  await connect({ extra: { status: 'disconnected', disconnectedAt: new Date() } });
  assert.equal((await as(owner).post(recheckUrl())).body.code, 'github_disconnected');

  await connect({ extra: { webhook: { status: 'not_admin', hookId: null, repositoryId: REPO.githubId, message: '', updatedAt: new Date() } } });
  assert.equal((await as(owner).post(recheckUrl())).body.code, 'webhook_not_active');

  await connect();
  setEnv(WEBHOOK_ENV, false);
  res = await as(owner).post(recheckUrl());
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'webhook_not_configured');
  assert.equal(calls.length, 0);
});

test('missed events: GitHub rejects the token -> 409 github_reauthorize and recorded; no admin rights -> 502', async () => {
  await connect();
  fakeGithub({ deliveries: json({ message: 'Bad credentials' }, 401) });
  let res = await as(owner).post(recheckUrl());
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'github_reauthorize');
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).needsReauthorization, true);

  await connect();
  fakeGithub({ deliveries: json({ message: 'Not Found' }, 404) });
  res = await as(owner).post(recheckUrl());
  assert.equal(res.status, 502);
  assert.equal(res.body.code, 'github_not_admin');
  noToken(res.body);
});

// --- Missed events: the 15-minute check ---------------------------------------------------------

test('15-minute check: every Active webhook once (a shared repository once), disconnected ones skipped', async () => {
  await connect();
  // A second project with the same repository and hook, and a third one that is disconnected.
  const second = new mongoose.Types.ObjectId();
  const third = new mongoose.Types.ObjectId();
  await connect({ project: second });
  await connect({ project: third, extra: { status: 'disconnected', disconnectedAt: new Date() } });
  const entry = logEntry('g-periodic', { status: 0 });
  fakeGithub({ deliveries: json([entry]) });

  const summary = await runMissedEventsCheck();
  assert.equal(summary.webhooks, 1, 'the shared webhook is read once');
  assert.equal(summary.redelivered, 1);
  assert.equal(githubCallsTo('/hooks/77/deliveries?').length, 1);
  assert.deepEqual(redeliveredIds(), [entry.id]);
  await GithubConnection.deleteMany({ project: { $in: [second, third] } });
});

test('15-minute check: does nothing without webhook settings, and never throws on GitHub errors', async () => {
  await connect();
  setEnv(WEBHOOK_ENV, false);
  assert.equal((await runMissedEventsCheck()).notConfigured, true);
  assert.equal(calls.length, 0);

  setEnv(WEBHOOK_ENV, true);
  fakeGithub({ deliveries: () => { throw new TypeError('fetch failed'); } });
  const summary = await runMissedEventsCheck();
  assert.equal(summary.skipped, 1);
  assert.equal(summary.redelivered, 0);
});

test('the project still exists after all of this (sanity)', async () => {
  assert.ok(await Project.exists({ _id: projectId }));
});
