// [Sprint 4 · M2] US-32 Connect a repository (FR-11).
// "Given I have authorized GitHub, when I pick a repository from my list, then the repository is
//  connected and the project shows the connection as Active."
// GitHub itself is never called: globalThis.fetch is replaced per test with a fake GitHub.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import GithubConnection from '../src/models/GithubConnection.js';
import Project from '../src/models/Project.js';
import Activity from '../src/models/Activity.js';
import { encryptToken } from '../src/lib/githubCrypto.js';

const TOKEN = 'gho_M2_TEST_TOKEN_never_leaves_server_9876';
const GITHUB_ENV = {
  GITHUB_CLIENT_ID: 'Iv1.testclientid',
  GITHUB_CLIENT_SECRET: 'test-client-secret-value-abcdef',
  GITHUB_CALLBACK_URL: 'http://localhost:5000/api/github/callback',
  GITHUB_TOKEN_KEY: 'b'.repeat(64),
};
const GITHUB_USER_ID = 4242;

let app;
let owner, admin, contributor, viewer, outsider;
let projectId, otherProjectId;

const as = (account) => authed(app, account.token);
// helpers.authed() has no put(); kept local so the shared helper file is unchanged.
const put = (account, url) => request(app).put(url).set('Authorization', `Bearer ${account.token}`);
const base = (id = projectId) => `/api/projects/${id}/github`;
const listUrl = (id) => `${base(id)}/repositories`;
const selectUrl = (id) => `${base(id)}/repository`;

function setGithubEnv(on) {
  for (const [name, value] of Object.entries(GITHUB_ENV)) {
    if (on) process.env[name] = value;
    else delete process.env[name];
  }
}

const rawRepo = (id, fullName, extra = {}) => ({
  id,
  name: fullName.split('/')[1],
  full_name: fullName,
  owner: { login: fullName.split('/')[0] },
  private: false,
  html_url: `https://github.com/${fullName}`,
  default_branch: 'main',
  description: '',
  archived: false,
  permissions: { admin: true, push: true, pull: true },
  updated_at: '2026-10-31T10:00:00Z',
  ...extra,
});
const REPOS = [
  rawRepo(101, 'octo-owner/devorbit', { private: true }),
  rawRepo(102, 'octo-owner/notes'),
  rawRepo(103, 'campus-org/shared-app', { permissions: { admin: false, push: true, pull: true } }),
];

// Fake GitHub: /user/repos answers `repos` (or a forced status). Records every call.
let realFetch;
let githubCalls;
function fakeGithub({ repos = REPOS, status = 200, headers = {}, throws = false } = {}) {
  githubCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    githubCalls.push({ url: String(url), options });
    if (throws) throw new Error('getaddrinfo ENOTFOUND api.github.com');
    if (new URL(url).pathname === '/user/repos') {
      const body = status === 200 ? repos : { message: 'GitHub says no' };
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    }
    throw new Error(`Unexpected request to ${url}`);
  };
}

// What M1's callback stores after the Owner approves on GitHub (US-31).
async function authorize(project = projectId, { githubUserId = GITHUB_USER_ID, githubLogin = 'octo-owner', token = TOKEN } = {}) {
  return GithubConnection.findOneAndUpdate(
    { project },
    { project, authorizedBy: owner.user.id, githubUserId, githubLogin, scopes: ['repo'], encryptedToken: encryptToken(token), authorizedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

let logged;
const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'];
const originalConsole = {};

before(async () => {
  ({ app } = await setup());
  realFetch = globalThis.fetch;
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Repo Owner', 'Repo Admin', 'Repo Contributor', 'Repo Viewer', 'Repo Outsider'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'Repo Project', visibility: 'Public' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  const other = await as(outsider).post('/api/projects').send({ name: 'Outsider Project' });
  otherProjectId = other.body.project._id;
});

beforeEach(async () => {
  setGithubEnv(true);
  fakeGithub();
  await GithubConnection.deleteMany({});
  await Project.updateOne({ _id: projectId }, { $set: { githubRepo: '' } });
  logged = [];
  for (const method of consoleMethods) {
    originalConsole[method] = console[method];
    console[method] = (...args) => { logged.push(args.map(String).join(' ')); };
  }
});

afterEach(() => {
  for (const method of consoleMethods) console[method] = originalConsole[method];
  globalThis.fetch = realFetch;
});

after(async () => {
  setGithubEnv(false);
  await teardown();
});

const noTokenAnywhere = (...bodies) => {
  for (const body of bodies) assert.equal(JSON.stringify(body).includes(TOKEN), false, 'token in a response');
  assert.equal(logged.join('\n').includes(TOKEN), false, 'token in a log line');
};

// --- Acceptance criterion ------------------------------------------------------------------------

test('AC: authorized Owner picks a repository from their list; it is connected and shows as Active', async () => {
  await authorize();

  const before = await as(owner).get(base());
  assert.equal(before.status, 200);
  assert.equal(before.body.connectionState, 'needs_repository');
  assert.equal(before.body.active, false);
  assert.equal(before.body.repository, null);
  assert.equal(before.body.canSelectRepository, true);

  const list = await as(owner).get(listUrl());
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.githubLogin, 'octo-owner');
  assert.deepEqual(list.body.repositories.map((r) => r.fullName), ['octo-owner/devorbit', 'octo-owner/notes', 'campus-org/shared-app']);
  assert.equal(list.body.repositories[0].private, true);
  assert.equal(list.body.repositories[2].admin, false);
  assert.equal(list.body.selectedId, null);
  assert.equal(list.body.truncated, false);
  assert.equal(list.headers['cache-control'], 'no-store');

  const picked = await put(owner, selectUrl()).send({ repositoryId: 101 });
  assert.equal(picked.status, 200, JSON.stringify(picked.body));
  assert.equal(picked.body.connectionState, 'active');
  assert.equal(picked.body.active, true);
  assert.equal(picked.body.repository.fullName, 'octo-owner/devorbit');
  assert.equal(picked.body.repository.id, 101);
  assert.equal(picked.body.repository.htmlUrl, 'https://github.com/octo-owner/devorbit');
  assert.equal(picked.body.repository.connectedBy.name, 'Repo Owner');
  assert.equal(picked.body.connection.githubLogin, 'octo-owner');

  // Persisted, and every later status read shows Active.
  const saved = await GithubConnection.findOne({ project: projectId }).lean();
  assert.equal(saved.repository.githubId, 101);
  assert.equal(saved.repository.fullName, 'octo-owner/devorbit');
  assert.equal(saved.repository.githubUserId, GITHUB_USER_ID);
  assert.equal(String(saved.repository.connectedBy), owner.user.id);

  const after = await as(owner).get(base());
  assert.equal(after.body.connectionState, 'active');
  assert.equal(after.body.active, true);
  assert.equal(after.body.repository.fullName, 'octo-owner/devorbit');

  // The project header shows the repository (Project.githubRepo).
  const project = await as(owner).get(`/api/projects/${projectId}`);
  assert.equal((project.body.project || project.body).githubRepo, 'octo-owner/devorbit');

  // The list now marks the selection.
  assert.equal((await as(owner).get(listUrl())).body.selectedId, 101);

  noTokenAnywhere(before.body, list.body, picked.body, after.body);
});

test('the token is sent only to api.github.com, as a Bearer header', async () => {
  await authorize();
  await as(owner).get(listUrl());
  assert.ok(githubCalls.length >= 1);
  for (const call of githubCalls) {
    assert.equal(new URL(call.url).origin, 'https://api.github.com');
    assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`);
  }
});

test('the repository ID is accepted as digits too, and picking again replaces it (still one repository)', async () => {
  await authorize();
  assert.equal((await put(owner, selectUrl()).send({ repositoryId: '101' })).status, 200);
  const second = await put(owner, selectUrl()).send({ repositoryId: 102 });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.repository.fullName, 'octo-owner/notes');
  const saved = await GithubConnection.find({ project: projectId }).lean();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].repository.githubId, 102);
});

test('connecting and changing the repository are recorded in the activity feed', async () => {
  await authorize();
  await Activity.deleteMany({ project: projectId });
  await put(owner, selectUrl()).send({ repositoryId: 101 });
  await put(owner, selectUrl()).send({ repositoryId: 101 }); // same again: nothing new
  await put(owner, selectUrl()).send({ repositoryId: 102 });
  const events = await Activity.find({ project: projectId }).sort({ createdAt: 1, _id: 1 }).lean();
  assert.deepEqual(events.map((e) => e.summary), [
    'connected the GitHub repository "octo-owner/devorbit"',
    'changed the GitHub repository from "octo-owner/devorbit" to "octo-owner/notes"',
  ]);
  assert.ok(events.every((e) => e.type === 'project.updated' && String(e.actor) === owner.user.id));
});

// --- Owner only ------------------------------------------------------------------------------------

test('only the Owner can list repositories or choose one', async () => {
  await authorize();
  for (const account of [admin, contributor, viewer]) {
    const list = await as(account).get(listUrl());
    assert.equal(list.status, 403, JSON.stringify(list.body));
    assert.equal(list.body.code, 'owner_only');
    const pick = await put(account, selectUrl()).send({ repositoryId: 101 });
    assert.equal(pick.status, 403);
  }
  // Not a member at all, and a member of another project.
  assert.equal((await as(outsider).get(listUrl())).status, 403);
  assert.equal((await put(outsider, selectUrl()).send({ repositoryId: 101 })).status, 403);
  assert.equal((await as(owner).get(listUrl(otherProjectId))).status, 403);
  // Not signed in.
  assert.equal((await request(app).get(listUrl())).status, 401);
  assert.equal((await request(app).put(selectUrl()).send({ repositoryId: 101 })).status, 401);

  assert.equal(githubCalls.length, 0, 'GitHub is never asked on behalf of someone else');
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).repository, null);
});

test('Admins see the connected repository and Active state but cannot change it', async () => {
  await authorize();
  await put(owner, selectUrl()).send({ repositoryId: 101 });
  const adminView = await as(admin).get(base());
  assert.equal(adminView.status, 200);
  assert.equal(adminView.body.active, true);
  assert.equal(adminView.body.repository.fullName, 'octo-owner/devorbit');
  assert.equal(adminView.body.canSelectRepository, false);
  assert.equal((await as(contributor).get(base())).status, 403, 'integration settings stay Owner/Admin only (M1)');
});

test('invalid project IDs are rejected', async () => {
  assert.equal((await as(owner).get('/api/projects/not-an-id/github/repositories')).status, 400);
  assert.equal((await put(owner, '/api/projects/000000000000000000000000/github/repository').send({ repositoryId: 1 })).status, 404);
});

// --- Validation -----------------------------------------------------------------------------------

test('a repository that is not in the authorized account\'s list is refused and nothing is stored', async () => {
  await authorize();
  const res = await put(owner, selectUrl()).send({ repositoryId: 999999 });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'repository_not_available');
  assert.match(res.body.message, /@octo-owner/);
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).repository, null);
  assert.equal((await as(owner).get(base())).body.active, false);
});

test('malformed repository IDs are refused before GitHub is asked', async () => {
  await authorize();
  for (const body of [{}, { repositoryId: null }, { repositoryId: 'octo-owner/devorbit' }, { repositoryId: -5 }, { repositoryId: 1.5 }, { repositoryId: { $gt: 0 } }, { repositoryId: [101] }]) {
    const res = await put(owner, selectUrl()).send(body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} -> ${res.status}`);
    assert.equal(res.body.code, 'invalid_repository');
  }
  assert.equal(githubCalls.length, 0);
});

// --- Missing setup and GitHub problems ---------------------------------------------------------------

test('before GitHub is authorized: no list, no selection, not Active', async () => {
  const list = await as(owner).get(listUrl());
  assert.equal(list.status, 409);
  assert.equal(list.body.code, 'github_not_authorized');
  assert.equal((await put(owner, selectUrl()).send({ repositoryId: 101 })).body.code, 'github_not_authorized');
  const status = await as(owner).get(base());
  assert.equal(status.body.connectionState, 'not_connected');
  assert.equal(status.body.canSelectRepository, false);
  assert.equal(githubCalls.length, 0);
});

test('server GitHub settings missing: 503, and an existing connection is not shown as Active', async () => {
  await authorize();
  await put(owner, selectUrl()).send({ repositoryId: 101 });
  setGithubEnv(false);
  const list = await as(owner).get(listUrl());
  assert.equal(list.status, 503);
  assert.equal(list.body.code, 'github_not_configured');
  const status = await as(owner).get(base());
  assert.equal(status.body.connectionState, 'unavailable');
  assert.equal(status.body.active, false);
  assert.equal(status.body.canSelectRepository, false);
});

test('a stored token that can no longer be decrypted asks for re-authorization', async () => {
  await authorize();
  process.env.GITHUB_TOKEN_KEY = 'c'.repeat(64); // key rotated: still "configured", but cannot decrypt
  const res = await as(owner).get(listUrl());
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'github_reauthorize');
  assert.equal(githubCalls.length, 0);
  noTokenAnywhere(res.body);
});

test('GitHub rejects the token (revoked): re-authorize, nothing stored', async () => {
  await authorize();
  fakeGithub({ status: 401 });
  const list = await as(owner).get(listUrl());
  assert.equal(list.status, 409);
  assert.equal(list.body.code, 'github_reauthorize');
  const pick = await put(owner, selectUrl()).send({ repositoryId: 101 });
  assert.equal(pick.body.code, 'github_reauthorize');
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).repository, null);
  noTokenAnywhere(list.body, pick.body);
});

test('GitHub rate limit: 503 with Retry-After', async () => {
  await authorize();
  fakeGithub({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' } });
  const res = await as(owner).get(listUrl());
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'github_rate_limited');
  assert.equal(res.body.retryAfter, 60);
  assert.equal(res.headers['retry-after'], '60');
});

test('GitHub down or unreachable: 502 and nothing stored', async () => {
  await authorize();
  fakeGithub({ status: 500 });
  assert.equal((await as(owner).get(listUrl())).body.code, 'github_unavailable');
  fakeGithub({ throws: true });
  const pick = await put(owner, selectUrl()).send({ repositoryId: 101 });
  assert.equal(pick.status, 502);
  assert.equal(pick.body.code, 'github_unavailable');
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).repository, null);
  fakeGithub({ status: 403 });
  assert.equal((await as(owner).get(listUrl())).body.code, 'github_forbidden');
});

test('an account with no repositories gets an empty list, not an error', async () => {
  await authorize();
  fakeGithub({ repos: [] });
  const res = await as(owner).get(listUrl());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.repositories, []);
});

// --- Re-authorization (M1 callback upsert) ------------------------------------------------------

test('re-authorizing the same GitHub account keeps the repository Active', async () => {
  await authorize();
  await put(owner, selectUrl()).send({ repositoryId: 101 });
  await authorize(projectId, { token: `${TOKEN}-new` }); // what M1's callback does again
  const status = await as(owner).get(base());
  assert.equal(status.body.connectionState, 'active');
  assert.equal(status.body.repository.fullName, 'octo-owner/devorbit');
});

test('re-authorizing as a different GitHub account asks for the repository again', async () => {
  await authorize();
  await put(owner, selectUrl()).send({ repositoryId: 101 });
  await authorize(projectId, { githubUserId: 9999, githubLogin: 'someone-else' });
  const status = await as(owner).get(base());
  assert.equal(status.body.connectionState, 'needs_repository');
  assert.equal(status.body.active, false);
  assert.equal(status.body.repository, null);
  assert.equal((await as(owner).get(listUrl())).body.selectedId, null);
});

test('if the authorization changes while choosing, the choice is not attached to the new account', async () => {
  await authorize();
  // GitHub answers the list, but by then the project was re-authorized as another account.
  globalThis.fetch = async (url) => {
    await authorize(projectId, { githubUserId: 9999, githubLogin: 'someone-else' });
    return new Response(JSON.stringify(REPOS), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const res = await put(owner, selectUrl()).send({ repositoryId: 101 });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'github_changed');
  assert.equal((await GithubConnection.findOne({ project: projectId }).lean()).repository, null);
});
