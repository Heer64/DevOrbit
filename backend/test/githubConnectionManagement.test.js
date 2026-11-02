// [Sprint 4 · M3] US-33 Manage the GitHub connection (FR-35, NFR-4).
//   "Owner/Admin can view status, disconnect and re-authorize. After disconnect, new events stop
//    coming in but old feed entries stay."
// GitHub itself is never called: globalThis.fetch is replaced per test with a fake GitHub.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Activity from '../src/models/Activity.js';
import GithubConnection from '../src/models/GithubConnection.js';
import GithubOAuthState from '../src/models/GithubOAuthState.js';
import GithubOAuthCancelledState from '../src/models/GithubOAuthCancelledState.js';
import Project from '../src/models/Project.js';
import { decryptToken, encryptToken } from '../src/lib/githubCrypto.js';
import { logActivity } from '../src/lib/activity.js';
import { canRecordGithubEvent, projectsAcceptingGithubEvents } from '../src/lib/githubEventGate.js';
// [Sprint 4 · M4] US-34 pipeline, used by the integration tests at the end of this file.
import WebhookDelivery from '../src/models/WebhookDelivery.js';
import { signPayload } from '../src/lib/githubWebhooks.js';
import { webhookOptions, waitForWebhookWork } from '../src/routes/githubWebhook.js';

const TOKEN = 'gho_US33_OLD_TOKEN_never_leaves_server_0001';
const NEW_TOKEN = 'gho_US33_NEW_TOKEN_never_leaves_server_0002';
const CLIENT_SECRET = 'us33-client-secret-value';
const GITHUB_ENV = {
  GITHUB_CLIENT_ID: 'Iv1.us33client',
  GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  GITHUB_CALLBACK_URL: 'http://localhost:5000/api/github/callback',
  GITHUB_TOKEN_KEY: 'b'.repeat(64),
};
// [Sprint 4 · M4] US-34 webhook settings, switched on only by the tests that need them.
const WEBHOOK_SECRET = 'us33-webhook-secret-for-tests-0123456789';
const WEBHOOK_ENV = { GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET, GITHUB_WEBHOOK_URL: 'https://forge.example.com/api/github/webhook' };
function setWebhookEnv(on) {
  for (const [name, value] of Object.entries(WEBHOOK_ENV)) {
    if (on) process.env[name] = value;
    else delete process.env[name];
  }
}
const GITHUB_USER = { id: 4242, login: 'octo-owner' };
const REPO = { githubId: 101, fullName: 'octo-owner/devorbit' };

let app;
let owner, admin, contributor, viewer, outsider;
let projectId;

const as = (account) => authed(app, account.token);
const base = (id = projectId) => `/api/projects/${id}/github`;
const disconnect = (account, body = { confirm: true }) => as(account).post(`${base()}/disconnect`).send(body);
const verify = (account) => as(account).post(`${base()}/verify`);

function setGithubEnv(on) {
  for (const [name, value] of Object.entries(GITHUB_ENV)) {
    if (on) process.env[name] = value;
    else delete process.env[name];
  }
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const rawRepo = (id = REPO.githubId, fullName = REPO.fullName) => ({
  id, name: fullName.split('/')[1], full_name: fullName, owner: { login: fullName.split('/')[0] },
  private: true, html_url: `https://github.com/${fullName}`, default_branch: 'main', permissions: { admin: true },
});

// Fake GitHub. Every answer can be overridden; records every call.
let realFetch;
let githubCalls;
function fakeGithub({
  user = json(GITHUB_USER),
  repository = json(rawRepo()),
  revoke = new Response(null, { status: 204 }),
  token,
  createHook = json({ id: 88 }, 201), // [Sprint 4 · M4] POST /repos/{owner}/{repo}/hooks
  deleteHook = new Response(null, { status: 204 }), // [Sprint 4 · M4] DELETE /repos/{owner}/{repo}/hooks/{id}
} = {}) {
  githubCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    githubCalls.push({ url: String(url), options });
    const { host, pathname } = new URL(url);
    const answer = (value) => {
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(options) : value.clone();
    };
    if (host === 'github.com' && pathname === '/login/oauth/access_token') {
      return answer(token ?? json({ access_token: NEW_TOKEN, token_type: 'bearer', scope: 'repo' }));
    }
    if (host === 'api.github.com' && pathname === '/user') return answer(user);
    if (host === 'api.github.com' && pathname === `/repositories/${REPO.githubId}`) return answer(repository);
    if (host === 'api.github.com' && pathname === `/applications/${GITHUB_ENV.GITHUB_CLIENT_ID}/token`) return answer(revoke);
    if (host === 'api.github.com' && pathname === `/repos/${REPO.fullName}/hooks` && options.method === 'POST') return answer(createHook);
    if (host === 'api.github.com' && pathname.startsWith(`/repos/${REPO.fullName}/hooks/`) && options.method === 'DELETE') return answer(deleteHook);
    throw new Error(`Unexpected request to ${url}`);
  };
}

// What M1's callback + M2's PUT leave behind: an authorized project with the repository chosen.
async function connectWithRepository({ token = TOKEN, extra = {} } = {}) {
  await GithubConnection.findOneAndUpdate(
    { project: projectId },
    {
      project: projectId,
      authorizedBy: owner.user.id,
      githubUserId: GITHUB_USER.id,
      githubLogin: GITHUB_USER.login,
      scopes: ['repo'],
      encryptedToken: encryptToken(token),
      authorizedAt: new Date(),
      repository: {
        githubId: REPO.githubId, name: 'devorbit', fullName: REPO.fullName, owner: 'octo-owner', private: true,
        htmlUrl: `https://github.com/${REPO.fullName}`, defaultBranch: 'main', admin: true,
        githubUserId: GITHUB_USER.id, connectedBy: owner.user.id, connectedAt: new Date(),
      },
      // A fresh, connected record even when one was disconnected earlier in the same test.
      status: 'connected', disconnectedAt: null, disconnectedBy: null,
      needsReauthorization: false, reauthorizationReason: '', lastCheckedAt: null, repositoryCheck: null,
      ...extra,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await Project.updateOne({ _id: projectId }, { $set: { githubRepo: REPO.fullName } });
}

// Starts the OAuth flow (Connect or Re-authorize) as `account`; returns what the browser holds.
async function startFlow(account) {
  const res = await as(account).post(`${base()}/authorize`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const state = new URL(res.body.url).searchParams.get('state');
  const setCookie = (res.headers['set-cookie'] || []).find((line) => line.startsWith('devorbit_github_state='));
  return { state, cookie: setCookie.split(';')[0] };
}
const callback = (query, cookie) => request(app).get(`/api/github/callback?${new URLSearchParams(query)}`).set('Cookie', cookie);

const githubEvent = (summary = 'pushed 1 commit to main') => logActivity({
  project: projectId,
  actor: null,
  type: 'github.commit',
  summary,
  targetType: 'github',
  targetLabel: REPO.fullName,
  meta: { author: 'octo-owner', repositoryId: REPO.githubId, url: `https://github.com/${REPO.fullName}/commit/abc123` },
});

let logged;
const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'];
const originalConsole = {};
const noSecretAnywhere = (...bodies) => {
  for (const body of bodies) {
    const text = JSON.stringify(body);
    for (const secret of [TOKEN, NEW_TOKEN, CLIENT_SECRET]) assert.equal(text.includes(secret), false, 'secret in a response');
  }
  for (const secret of [TOKEN, NEW_TOKEN, CLIENT_SECRET]) assert.equal(logged.join('\n').includes(secret), false, 'secret in a log line');
};

before(async () => {
  ({ app } = await setup());
  realFetch = globalThis.fetch;
  webhookOptions.sleep = async () => {}; // [Sprint 4 · M4] no real back-off waits in tests
  webhookOptions.baseDelayMs = 1;
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['US33 Owner', 'US33 Admin', 'US33 Contributor', 'US33 Viewer', 'US33 Outsider'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'US-33 Project', visibility: 'Public' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

beforeEach(async () => {
  setGithubEnv(true);
  fakeGithub();
  await GithubConnection.deleteMany({});
  await GithubOAuthState.deleteMany({});
  await GithubOAuthCancelledState.deleteMany({});
  await Activity.deleteMany({ project: projectId });
  await Project.updateOne({ _id: projectId, 'members.user': admin.user.id }, { $set: { 'members.$.role': 'Admin', githubRepo: '' } });
  logged = [];
  for (const method of consoleMethods) {
    originalConsole[method] = console[method];
    console[method] = (...args) => { logged.push(args.map(String).join(' ')); };
  }
});

afterEach(() => {
  setWebhookEnv(false);
  for (const method of consoleMethods) console[method] = originalConsole[method];
  globalThis.fetch = realFetch;
});

after(async () => {
  setGithubEnv(false);
  await teardown();
});

// --- AC1: view status ------------------------------------------------------------------------

test('AC1: Owner and Admin open integration settings and see the repository name and status', async () => {
  await connectWithRepository();
  for (const account of [owner, admin]) {
    const res = await as(account).get(base());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.repository.fullName, REPO.fullName);
    assert.equal(res.body.connectionState, 'active');
    assert.equal(res.body.active, true);
    assert.equal(res.body.canDisconnect, true);
    assert.equal(res.body.canReauthorize, true);
    assert.equal(res.body.canVerify, true);
    assert.equal(res.body.acceptingEvents, true);
    assert.equal(res.body.connection.githubLogin, GITHUB_USER.login);
    noSecretAnywhere(res.body);
  }
});

// --- AC2: disconnect -------------------------------------------------------------------------

test('AC2: Admin confirms Disconnect; new GitHub events stop and earlier entries remain', async () => {
  await connectWithRepository();
  // Earlier feed entries, a GitHub event among them.
  const earlierEvent = await githubEvent('pushed 2 commits to main');
  assert.ok(earlierEvent, 'events are accepted while connected');
  assert.deepEqual(await projectsAcceptingGithubEvents(REPO.githubId), [projectId]);
  const earlier = await Activity.find({ project: projectId }).lean();
  assert.equal(earlier.length, 1);

  const res = await disconnect(admin);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.connectionState, 'disconnected');
  assert.equal(res.body.active, false);
  assert.equal(res.body.acceptingEvents, false);
  assert.equal(res.body.disconnectedBy.name, 'US33 Admin');
  assert.equal(res.body.revokedOnGithub, true);
  assert.equal(res.body.repository.fullName, REPO.fullName, 'the last repository is still shown');

  // New events stop: the gate says no, and logActivity drops them.
  assert.deepEqual(await projectsAcceptingGithubEvents(REPO.githubId), []);
  assert.equal(await canRecordGithubEvent(projectId, REPO.githubId), false);
  assert.equal(await githubEvent('pushed 1 commit to main'), null);
  for (const type of ['github.issue', 'github.pull_request']) {
    assert.equal(await logActivity({ project: projectId, actor: null, type, summary: 'opened #7', meta: { repositoryId: REPO.githubId } }), null);
  }

  // Earlier entries stay; the only new entry is the disconnect itself.
  const feed = await Activity.find({ project: projectId }).sort({ createdAt: 1, _id: 1 }).lean();
  assert.deepEqual(feed.map((e) => e.type), ['github.commit', 'project.updated']);
  assert.equal(String(feed[0]._id), String(earlier[0]._id));
  assert.equal(feed[1].summary, `disconnected GitHub (repository "${REPO.fullName}")`);
  assert.equal(String(feed[1].actor), admin.user.id);

  // And the API feed shows them too.
  const api = await as(owner).get(`/api/projects/${projectId}/activity`);
  assert.equal(api.status, 200);
  assert.ok(JSON.stringify(api.body).includes('pushed 2 commits to main'));
  noSecretAnywhere(res.body, api.body);
});

test('AC2: disconnect removes the token, revokes it on GitHub, keeps the account and repository', async () => {
  await connectWithRepository();
  const res = await disconnect(owner);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const stored = await GithubConnection.findOne({ project: projectId }).select('+encryptedToken').lean();
  assert.equal(stored.status, 'disconnected');
  assert.equal(stored.encryptedToken, undefined, 'no token stored after disconnect');
  assert.equal(String(stored.disconnectedBy), owner.user.id);
  assert.equal(stored.githubUserId, GITHUB_USER.id);
  assert.equal(stored.githubLogin, GITHUB_USER.login);
  assert.equal(stored.repository.githubId, REPO.githubId);

  const revoke = githubCalls.find((call) => call.url.endsWith(`/applications/${GITHUB_ENV.GITHUB_CLIENT_ID}/token`));
  assert.ok(revoke, 'token revoked on GitHub');
  assert.equal(revoke.options.method, 'DELETE');
  assert.deepEqual(JSON.parse(revoke.options.body), { access_token: TOKEN });

  assert.equal((await Project.findById(projectId).lean()).githubRepo, '', 'the header stops showing the repository');
  noSecretAnywhere(res.body);
});

test('AC2: disconnect needs explicit confirmation and cannot run twice', async () => {
  await connectWithRepository();
  const unconfirmed = await disconnect(owner, {});
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.body.code, 'confirmation_required');
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).status, 'connected');

  assert.equal((await disconnect(owner)).status, 200);
  const again = await disconnect(admin);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'github_disconnected');
});

test('disconnect still works when GitHub is down or the server cannot revoke; the database wins', async () => {
  await connectWithRepository();
  fakeGithub({ revoke: new Error('getaddrinfo ENOTFOUND api.github.com') });
  const res = await disconnect(owner);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.revokedOnGithub, false);
  assert.equal(res.body.connectionState, 'disconnected');
  assert.equal(await githubEvent(), null);

  // Without server GitHub settings there is nothing to revoke with, but disconnect still works.
  await connectWithRepository();
  setGithubEnv(false);
  fakeGithub();
  const unconfigured = await disconnect(admin);
  assert.equal(unconfigured.status, 200, JSON.stringify(unconfigured.body));
  assert.equal(unconfigured.body.revokedOnGithub, false);
  assert.equal(githubCalls.length, 0, 'no revoke without the app credentials');
});

test('a Connect or Re-authorize started before the disconnect cannot reconnect it afterwards', async () => {
  await connectWithRepository();
  const flow = await startFlow(admin);
  assert.equal((await disconnect(owner)).status, 200);
  assert.equal(await GithubOAuthState.countDocuments({ project: projectId }), 0);

  const res = await callback({ code: 'late-code', state: flow.state }, flow.cookie);
  assert.equal(res.headers.location, `http://localhost:5173/project/${projectId}?github=expired`);
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).status, 'disconnected');
});

test('after disconnect M2\'s repository list and selection answer github_disconnected', async () => {
  await connectWithRepository();
  await disconnect(owner);
  const list = await as(owner).get(`${base()}/repositories`);
  assert.equal(list.status, 409);
  assert.equal(list.body.code, 'github_disconnected');
  const pick = await request(app).put(`${base()}/repository`).set('Authorization', `Bearer ${owner.token}`).send({ repositoryId: REPO.githubId });
  assert.equal(pick.status, 409);
  assert.equal(pick.body.code, 'github_disconnected');
});

// --- AC3: re-authorize -----------------------------------------------------------------------

test('AC3: an expired authorization is detected, and after Re-authorize the connection is Active again', async () => {
  await connectWithRepository();
  fakeGithub({ user: json({ message: 'Bad credentials' }, 401) });
  const check = await verify(admin);
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.deepEqual(check.body.check, { token: 'rejected', repository: 'not_checked' });
  assert.equal(check.body.connectionState, 'needs_reauthorization');
  assert.equal(check.body.active, false);
  assert.equal(check.body.reauthorizationReason, 'token_rejected');

  // The Admin chooses Re-authorize and approves on GitHub.
  fakeGithub();
  const flow = await startFlow(admin);
  assert.equal((await GithubOAuthState.findOne({}).lean()).purpose, 'reauthorize');
  const res = await callback({ code: 'fresh-code', state: flow.state }, flow.cookie);
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `http://localhost:5173/project/${projectId}?github=reauthorized`);

  // The kept repository was checked with the new token before counting as Active.
  assert.ok(githubCalls.some((call) => call.url === `https://api.github.com/repositories/${REPO.githubId}` && call.options.headers.Authorization === `Bearer ${NEW_TOKEN}`));
  const status = await as(owner).get(base());
  assert.equal(status.body.connectionState, 'active');
  assert.equal(status.body.active, true);
  assert.equal(status.body.needsReauthorization, false);
  assert.equal(status.body.repository.fullName, REPO.fullName);
  assert.equal(status.body.connection.authorizedBy.name, 'US33 Admin');

  const stored = await GithubConnection.findOne({ project: projectId }).select('+encryptedToken').lean();
  assert.equal(decryptToken(stored.encryptedToken), NEW_TOKEN, 'the new token replaced the old one, encrypted');
  noSecretAnywhere(check.body, status.body);
});

test('AC3: Owner or Admin re-authorizes a disconnected integration and it returns to Active with its repository', async () => {
  for (const account of [owner, admin]) {
    await connectWithRepository();
    await disconnect(owner);
    await Activity.deleteMany({ project: projectId });

    fakeGithub();
    const flow = await startFlow(account);
    const res = await callback({ code: 'reconnect-code', state: flow.state }, flow.cookie);
    assert.equal(res.headers.location, `http://localhost:5173/project/${projectId}?github=reauthorized`);

    const status = await as(account).get(base());
    assert.equal(status.body.connectionState, 'active', JSON.stringify(status.body));
    assert.equal(status.body.disconnectedAt, null);
    assert.equal(status.body.acceptingEvents, true);
    assert.equal((await Project.findById(projectId).lean()).githubRepo, REPO.fullName, 'the header shows the repository again');

    // Events flow again.
    assert.ok(await githubEvent('pushed after reconnect'));
    const feed = await Activity.find({ project: projectId }).sort({ createdAt: 1, _id: 1 }).lean();
    assert.deepEqual(feed.map((e) => e.summary), [`reconnected GitHub as @${GITHUB_USER.login}`, 'pushed after reconnect']);
    await GithubConnection.deleteMany({});
  }
});

test('requirement 5: a valid token alone never makes it Active; repository access is checked too', async () => {
  await connectWithRepository();
  fakeGithub({ repository: json({ message: 'Not Found' }, 404) });
  const check = await verify(owner);
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.deepEqual(check.body.check, { token: 'valid', repository: 'not_accessible' });
  assert.equal(check.body.connectionState, 'repository_unavailable');
  assert.equal(check.body.active, false);

  // Re-authorizing while GitHub cannot be asked about the repository: authorized, but not Active yet.
  fakeGithub({ repository: new Error('socket hang up') });
  const flow = await startFlow(owner);
  await callback({ code: 'c', state: flow.state }, flow.cookie);
  const unverified = await as(owner).get(base());
  assert.equal(unverified.body.connectionState, 'unverified');
  assert.equal(unverified.body.active, false);

  // Check connection confirms both, and only then is it Active.
  fakeGithub();
  const ok = await verify(owner);
  assert.deepEqual(ok.body.check, { token: 'valid', repository: 'accessible' });
  assert.equal(ok.body.connectionState, 'active');
});

test('re-authorizing as a different GitHub account asks for a repository again (M2 rule kept)', async () => {
  await connectWithRepository();
  fakeGithub({ user: json({ id: 9999, login: 'someone-else' }) });
  const flow = await startFlow(admin);
  await callback({ code: 'c', state: flow.state }, flow.cookie);
  assert.equal(githubCalls.some((call) => call.url.includes('/repositories/')), false, 'no check for a repository of another account');
  const status = await as(owner).get(base());
  assert.equal(status.body.connectionState, 'needs_repository');
  assert.equal(status.body.acceptingEvents, false);
});

test('a token GitHub rejects during M2\'s repository listing is recorded as needing re-authorization', async () => {
  await connectWithRepository();
  globalThis.fetch = async () => json({ message: 'Bad credentials' }, 401);
  const list = await as(owner).get(`${base()}/repositories`);
  assert.equal(list.body.code, 'github_reauthorize');
  assert.equal((await as(admin).get(base())).body.connectionState, 'needs_reauthorization');

  // A rotated server key is recorded the same way, with its own reason.
  await GithubConnection.updateOne({ project: projectId }, { $set: { needsReauthorization: false, reauthorizationReason: '' } });
  process.env.GITHUB_TOKEN_KEY = 'c'.repeat(64);
  const check = await verify(owner);
  assert.equal(check.body.connectionState, 'needs_reauthorization');
  assert.equal(check.body.reauthorizationReason, 'token_unreadable');
});

test('Check connection: rate limits and outages change nothing (NFR-11b)', async () => {
  await connectWithRepository();
  fakeGithub({ user: json({ message: 'rate' }, 403, { 'x-ratelimit-remaining': '0', 'retry-after': '45' }) });
  const limited = await verify(owner);
  assert.equal(limited.status, 503);
  assert.equal(limited.body.code, 'github_rate_limited');
  assert.equal(limited.headers['retry-after'], '45');

  fakeGithub({ user: new Error('ECONNRESET') });
  const down = await verify(owner);
  assert.equal(down.status, 502);
  assert.equal(down.body.code, 'github_unavailable');

  const stored = await GithubConnection.findOne({ project: projectId }).lean();
  assert.equal(stored.needsReauthorization, false);
  assert.equal(stored.lastCheckedAt, null);
  assert.equal((await as(owner).get(base())).body.connectionState, 'active');
});

test('Check connection on a disconnected or missing connection is refused', async () => {
  assert.equal((await verify(owner)).body.code, 'github_not_authorized');
  await connectWithRepository();
  await disconnect(owner);
  const res = await verify(admin);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'github_disconnected');
});

// --- Who may do what -------------------------------------------------------------------------

test('roles: Contributors, Viewers and outsiders cannot view, check, disconnect or re-authorize', async () => {
  await connectWithRepository();
  for (const account of [contributor, viewer, outsider]) {
    assert.equal((await as(account).get(base())).status, 403);
    assert.equal((await verify(account)).status, 403);
    assert.equal((await disconnect(account)).status, 403);
    assert.equal((await as(account).post(`${base()}/authorize`)).status, 403);
  }
  assert.equal((await request(app).post(`${base()}/disconnect`).send({ confirm: true })).status, 401);
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).status, 'connected');
  assert.equal(await GithubOAuthState.countDocuments({}), 0);
});

test('roles: connecting GitHub for the very first time stays Owner only (US-31)', async () => {
  const res = await as(admin).post(`${base()}/authorize`);
  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'Only the project Owner can connect GitHub.');
  assert.equal((await as(admin).get(base())).body.canAuthorize, false);
  assert.equal(await GithubOAuthState.countDocuments({}), 0);
});

test('roles: an Admin who loses the role before GitHub returns cannot finish re-authorizing', async () => {
  await connectWithRepository();
  const flow = await startFlow(admin);
  await Project.updateOne({ _id: projectId, 'members.user': admin.user.id }, { $set: { 'members.$.role': 'Contributor' } });
  const res = await callback({ code: 'c', state: flow.state }, flow.cookie);
  assert.equal(res.headers.location, `http://localhost:5173/project/${projectId}?github=forbidden`);
  const stored = await GithubConnection.findOne({ project: projectId }).select('+encryptedToken').lean();
  assert.equal(decryptToken(stored.encryptedToken), TOKEN, 'nothing changed');
});

test('NFR-4: no response or log line contains a token or the client secret across US-33 actions', async () => {
  await connectWithRepository();
  const bodies = [];
  bodies.push((await as(owner).get(base())).body);
  bodies.push((await verify(admin)).body);
  const flow = await startFlow(admin);
  const cb = await callback({ code: 'c', state: flow.state }, flow.cookie);
  bodies.push(cb.headers, cb.text);
  bodies.push((await disconnect(owner)).body);
  bodies.push((await as(admin).get(base())).body);
  noSecretAnywhere(...bodies);
});

// --- Integration with M4's webhook pipeline (US-34) -------------------------------------------

const ACTIVE_HOOK = { status: 'active', hookId: 77, repositoryId: REPO.githubId, message: '', updatedAt: new Date() };

function deliverPush(deliveryId) {
  // A different commit per delivery, so M4's duplicate guard (GithubFeedKey) never merges two tests.
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

test('M4: disconnect takes the webhook off GitHub before revoking the token, and clears it', async () => {
  setWebhookEnv(true);
  await connectWithRepository({ extra: { webhook: ACTIVE_HOOK } });
  const res = await disconnect(admin);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.webhookRemoved, true);
  assert.equal(res.body.webhook, null);

  const hookCall = githubCalls.findIndex((call) => call.url === `https://api.github.com/repos/${REPO.fullName}/hooks/77` && call.options.method === 'DELETE');
  const revokeCall = githubCalls.findIndex((call) => call.url.endsWith(`/applications/${GITHUB_ENV.GITHUB_CLIENT_ID}/token`));
  assert.ok(hookCall >= 0, 'hook removed on GitHub');
  assert.ok(revokeCall > hookCall, 'removed with the token before it was revoked');
  assert.equal(githubCalls[hookCall].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).webhook, null);
  noSecretAnywhere(res.body);
});

test('M4: a delivery after disconnect is ignored (not retried as a failure); old entries stay', async () => {
  setWebhookEnv(true);
  await connectWithRepository({ extra: { webhook: ACTIVE_HOOK } });
  assert.equal((await deliverPush('before-disconnect')).status, 202);
  await waitForWebhookWork();
  const before = await Activity.find({ project: projectId, type: /^github\./ }).lean();
  assert.equal(before.length, 1, 'events flow while connected');

  await disconnect(owner);
  assert.equal((await deliverPush('after-disconnect')).status, 202);
  await waitForWebhookWork();

  const delivery = await WebhookDelivery.findOne({ deliveryId: 'after-disconnect' }).lean();
  assert.equal(delivery.status, 'ignored');
  assert.ok((delivery.attempts || 0) <= 1, 'no retries');
  const after = await Activity.find({ project: projectId, type: /^github\./ }).lean();
  assert.equal(after.length, 1, 'no new GitHub entry');
  assert.equal(String(after[0]._id), String(before[0]._id), 'the earlier entry stays');
});

test('M4: reconnecting sets the webhook up again so events flow back in', async () => {
  setWebhookEnv(true);
  await connectWithRepository({ extra: { webhook: ACTIVE_HOOK } });
  await disconnect(owner);

  fakeGithub();
  const flow = await startFlow(admin);
  const res = await callback({ code: 'reconnect', state: flow.state }, flow.cookie);
  assert.equal(res.headers.location, `http://localhost:5173/project/${projectId}?github=reauthorized`);
  const create = githubCalls.find((call) => call.url === `https://api.github.com/repos/${REPO.fullName}/hooks` && call.options.method === 'POST');
  assert.ok(create, 'webhook created again');
  assert.equal(create.options.headers.Authorization, `Bearer ${NEW_TOKEN}`);

  const status = await as(owner).get(base());
  assert.equal(status.body.connectionState, 'active');
  assert.equal(status.body.webhook.status, 'active');
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).webhook.hookId, 88);

  assert.equal((await deliverPush('after-reconnect')).status, 202);
  await waitForWebhookWork();
  assert.equal((await WebhookDelivery.findOne({ deliveryId: 'after-reconnect' }).lean()).status, 'processed');
});
