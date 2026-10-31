// [Sprint 4 · M1] US-31 Authorize GitHub (FR-11, NFR-4).
// GitHub itself is never called: globalThis.fetch is replaced per test with a fake GitHub.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import GithubConnection from '../src/models/GithubConnection.js';
import GithubOAuthState from '../src/models/GithubOAuthState.js';
import { decryptToken } from '../src/lib/githubCrypto.js';
import { hashState } from '../src/lib/githubOAuth.js';

const TOKEN = 'gho_TEST_ACCESS_TOKEN_never_leaves_server_1234';
const CLIENT_SECRET = 'test-client-secret-value-abcdef';
const GITHUB_ENV = {
  GITHUB_CLIENT_ID: 'Iv1.testclientid',
  GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  GITHUB_CALLBACK_URL: 'http://localhost:5000/api/github/callback',
  GITHUB_TOKEN_KEY: 'a'.repeat(64),
};

let app;
let owner, admin, contributor, outsider;
let projectId;

const as = (account) => authed(app, account.token);
const github = (id = projectId) => `/api/projects/${id}/github`;

function setGithubEnv(on) {
  for (const [name, value] of Object.entries(GITHUB_ENV)) {
    if (on) process.env[name] = value;
    else delete process.env[name];
  }
}

// Fake GitHub: records every call, answers the token exchange and /user.
let realFetch;
let githubCalls;
function fakeGithub({ tokenResponse, userResponse } = {}) {
  githubCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    githubCalls.push({ url: String(url), options });
    if (String(url) === 'https://github.com/login/oauth/access_token') {
      const body = tokenResponse ?? { access_token: TOKEN, token_type: 'bearer', scope: 'repo' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url) === 'https://api.github.com/user') {
      const body = userResponse ?? { id: 4242, login: 'octo-owner' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected request to ${url}`);
  };
}

// Captures console output so we can prove the token is never logged.
let logged;
const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'];
const originalConsole = {};

// Starts the flow as the Owner. Returns { state, cookie } exactly as the browser would hold them.
async function startFlow(account = owner) {
  const res = await as(account).post(`${github()}/authorize`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const state = new URL(res.body.url).searchParams.get('state');
  const setCookie = (res.headers['set-cookie'] || []).find((line) => line.startsWith('devorbit_github_state='));
  assert.ok(setCookie, 'state cookie is set');
  return { state, cookie: setCookie.split(';')[0], setCookie };
}

const callback = (query, cookie) => {
  const req = request(app).get(`/api/github/callback?${new URLSearchParams(query)}`);
  return cookie ? req.set('Cookie', cookie) : req;
};

before(async () => {
  ({ app } = await setup());
  realFetch = globalThis.fetch;
  [owner, admin, contributor, outsider] = await Promise.all(
    ['GitHub Owner', 'GitHub Admin', 'GitHub Contributor', 'GitHub Outsider'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'GitHub Project', visibility: 'Public' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

beforeEach(async () => {
  setGithubEnv(true);
  fakeGithub();
  await GithubConnection.deleteMany({});
  await GithubOAuthState.deleteMany({});
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

// --- AC1: approve on GitHub -> back in FORGE with the authorization stored --------------------

test('AC1: Owner connects GitHub, approves, and returns to the project with authorization stored', async () => {
  const { state, cookie } = await startFlow();

  const res = await callback({ code: 'one-time-code', state }, cookie);
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `http://localhost:5173/project/${projectId}?github=connected`);

  const saved = await GithubConnection.findOne({ project: projectId }).select('+encryptedToken').lean();
  assert.ok(saved, 'connection stored');
  assert.equal(saved.githubLogin, 'octo-owner');
  assert.equal(saved.githubUserId, 4242);
  assert.equal(String(saved.authorizedBy), owner.user.id);
  assert.deepEqual(saved.scopes, ['repo']);

  // The code was exchanged server-side with the secret from the environment and the fixed callback URL.
  const exchange = githubCalls.find((call) => call.url === 'https://github.com/login/oauth/access_token');
  const sent = JSON.parse(exchange.options.body);
  assert.equal(sent.code, 'one-time-code');
  assert.equal(sent.client_id, GITHUB_ENV.GITHUB_CLIENT_ID);
  assert.equal(sent.client_secret, CLIENT_SECRET);
  assert.equal(sent.redirect_uri, GITHUB_ENV.GITHUB_CALLBACK_URL);

  const status = await as(owner).get(github());
  assert.equal(status.status, 200);
  assert.equal(status.body.connection.githubLogin, 'octo-owner');
  assert.equal(status.body.connection.authorizedBy.name, 'GitHub Owner');
});

// --- NFR-4: encrypted at rest, never sent to the browser, never logged ------------------------

test('NFR-4: the token is encrypted at rest and decrypts only with the server key', async () => {
  const { state, cookie } = await startFlow();
  await callback({ code: 'c', state }, cookie);

  const saved = await GithubConnection.findOne({ project: projectId }).select('+encryptedToken').lean();
  assert.ok(saved.encryptedToken.startsWith('v1.'));
  assert.ok(!saved.encryptedToken.includes(TOKEN), 'plain token is not stored');
  assert.equal(decryptToken(saved.encryptedToken), TOKEN);
  assert.throws(() => decryptToken(saved.encryptedToken, Buffer.alloc(32, 7)), 'a different key cannot read it');

  // Not selected by default, and stripped from JSON even when selected.
  const plain = await GithubConnection.findOne({ project: projectId });
  assert.equal(plain.encryptedToken, undefined);
  const withToken = await GithubConnection.findOne({ project: projectId }).select('+encryptedToken');
  assert.equal(JSON.stringify(withToken).includes('encryptedToken'), false);
});

test('NFR-4: no response and no log line ever contains the token or the client secret', async () => {
  const { state, cookie } = await startFlow();
  const cb = await callback({ code: 'c', state }, cookie);
  const responses = [
    cb,
    await as(owner).get(github()),
    await as(admin).get(github()),
    await as(owner).get(`/api/projects/${projectId}`),
  ];
  for (const res of responses) {
    const text = `${JSON.stringify(res.headers)} ${res.text || ''}`;
    assert.equal(text.includes(TOKEN), false, `token leaked in ${res.req?.path}`);
    assert.equal(text.includes(CLIENT_SECRET), false, `secret leaked in ${res.req?.path}`);
  }

  // A failure after the token was issued is logged by reason only.
  fakeGithub({ userResponse: { message: 'Bad credentials' } });
  const second = await startFlow();
  const failed = await callback({ code: 'c2', state: second.state }, second.cookie);
  assert.equal(failed.headers.location, `http://localhost:5173/project/${projectId}?github=error`);
  assert.ok(logged.length > 0, 'the failure was logged');
  for (const line of logged) {
    assert.equal(line.includes(TOKEN), false, 'token logged');
    assert.equal(line.includes(CLIENT_SECRET), false, 'secret logged');
  }
});

// --- AC2: deny on GitHub -> message, nothing stored ------------------------------------------

test('AC2: Owner denies access on GitHub -> told it was not made, nothing is stored', async () => {
  const { state, cookie } = await startFlow();
  const res = await callback({ error: 'access_denied', error_description: 'The user has denied your application access.', state }, cookie);
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `http://localhost:5173/project/${projectId}?github=denied`);
  assert.equal(await GithubConnection.countDocuments({}), 0);
  assert.equal(githubCalls.length, 0, 'GitHub was not called');
  assert.equal(await GithubOAuthState.countDocuments({}), 0, 'the state was used up');
});

test('AC2: denying a later attempt keeps the earlier authorization unchanged', async () => {
  const first = await startFlow();
  await callback({ code: 'c', state: first.state }, first.cookie);
  const before = await GithubConnection.findOne({ project: projectId }).select('+encryptedToken').lean();

  const second = await startFlow();
  await callback({ error: 'access_denied', state: second.state }, second.cookie);
  const afterDeny = await GithubConnection.findOne({ project: projectId }).select('+encryptedToken').lean();
  assert.equal(afterDeny.encryptedToken, before.encryptedToken);
  assert.equal(String(afterDeny.updatedAt), String(before.updatedAt));
});

// --- Safe callback and state check -----------------------------------------------------------

test('state: the authorize URL carries a fresh random state; only its hash is stored', async () => {
  const { state, setCookie } = await startFlow();
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Path=\/api\/github\/callback/);
  assert.match(setCookie, /SameSite=Lax/i);

  const stored = await GithubOAuthState.find({}).lean();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].stateHash, hashState(state));
  assert.equal(JSON.stringify(stored).includes(state), false, 'raw state not stored');

  const another = await startFlow();
  assert.notEqual(another.state, state);
});

test('state: the authorize URL asks GitHub to return to the configured callback only', async () => {
  const res = await as(owner).post(`${github()}/authorize`);
  const url = new URL(res.body.url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), GITHUB_ENV.GITHUB_CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), GITHUB_ENV.GITHUB_CALLBACK_URL);
  assert.equal(url.searchParams.get('scope'), 'repo');
  assert.equal(res.body.url.includes(CLIENT_SECRET), false);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('state: a callback without the matching browser cookie stores nothing', async () => {
  const { state } = await startFlow();
  const noCookie = await callback({ code: 'c', state });
  assert.equal(noCookie.headers.location, `http://localhost:5173/project/${projectId}?github=invalid`);

  const other = await startFlow();
  const wrongCookie = await callback({ code: 'c', state: other.state }, `devorbit_github_state=${'x'.repeat(43)}`);
  assert.equal(wrongCookie.headers.location, `http://localhost:5173/project/${projectId}?github=invalid`);

  assert.equal(await GithubConnection.countDocuments({}), 0);
  assert.equal(githubCalls.length, 0, 'code never exchanged');
});

test('state: unknown, malformed or missing state goes back without storing anything', async () => {
  const { cookie } = await startFlow();
  for (const state of ['A'.repeat(43), 'not-a-state', '']) {
    const res = await callback({ code: 'c', state }, cookie);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, 'http://localhost:5173/dashboard?github=expired');
  }
  assert.equal(await GithubConnection.countDocuments({}), 0);
  assert.equal(githubCalls.length, 0);
});

test('state: a state can be used once; replaying the callback does nothing', async () => {
  const { state, cookie } = await startFlow();
  const first = await callback({ code: 'c', state }, cookie);
  assert.match(first.headers.location, /github=connected$/);
  const callsAfterFirst = githubCalls.length;

  const replay = await callback({ code: 'c', state }, cookie);
  assert.equal(replay.headers.location, 'http://localhost:5173/dashboard?github=expired');
  assert.equal(githubCalls.length, callsAfterFirst, 'no second exchange');
});

test('state: an expired state is refused', async () => {
  const { state, cookie } = await startFlow();
  await GithubOAuthState.updateOne({ stateHash: hashState(state) }, { expiresAt: new Date(Date.now() - 1000) });
  const res = await callback({ code: 'c', state }, cookie);
  assert.equal(res.headers.location, `http://localhost:5173/project/${projectId}?github=expired`);
  assert.equal(await GithubConnection.countDocuments({}), 0);
});

test('safe callback: redirect target never comes from the query string', async () => {
  const { state, cookie } = await startFlow();
  const res = await callback({ code: 'c', state, redirect_uri: 'https://evil.example', next: 'https://evil.example' }, cookie);
  assert.ok(res.headers.location.startsWith('http://localhost:5173/project/'));
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('callback: GitHub refusing the code stores nothing', async () => {
  fakeGithub({ tokenResponse: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } });
  const { state, cookie } = await startFlow();
  const res = await callback({ code: 'stale', state }, cookie);
  assert.equal(res.headers.location, `http://localhost:5173/project/${projectId}?github=error`);
  assert.equal(await GithubConnection.countDocuments({}), 0);
});

// --- Who may do what -------------------------------------------------------------------------

test('roles: only the Owner can start the GitHub authorization', async () => {
  for (const account of [admin, contributor]) {
    const res = await as(account).post(`${github()}/authorize`);
    assert.equal(res.status, 403, JSON.stringify(res.body));
  }
  const res = await as(outsider).post(`${github()}/authorize`);
  assert.equal(res.status, 403);
  assert.equal(await GithubOAuthState.countDocuments({}), 0);
});

test('roles: Owner and Admin see integration settings; others do not', async () => {
  const ownerView = await as(owner).get(github());
  assert.equal(ownerView.status, 200);
  assert.deepEqual(ownerView.body, { configured: true, canAuthorize: true, connection: null });

  const adminView = await as(admin).get(github());
  assert.equal(adminView.status, 200);
  assert.equal(adminView.body.canAuthorize, false);

  assert.equal((await as(contributor).get(github())).status, 403);
  assert.equal((await as(outsider).get(github())).status, 403);
  assert.equal((await request(app).get(github())).status, 401);
});

test('config: without server GitHub settings the Owner is told it is not configured', async () => {
  setGithubEnv(false);
  const view = await as(owner).get(github());
  assert.equal(view.body.configured, false);
  const res = await as(owner).post(`${github()}/authorize`);
  assert.equal(res.status, 503);
  assert.equal(await GithubOAuthState.countDocuments({}), 0);

  // A key that is not 64 hex characters also counts as not configured.
  setGithubEnv(true);
  process.env.GITHUB_TOKEN_KEY = 'too-short';
  assert.equal((await as(owner).post(`${github()}/authorize`)).status, 503);
});

test('invalid project IDs are rejected', async () => {
  assert.equal((await as(owner).get('/api/projects/not-an-id/github')).status, 400);
  assert.equal((await as(owner).post('/api/projects/000000000000000000000000/github/authorize')).status, 404);
});
