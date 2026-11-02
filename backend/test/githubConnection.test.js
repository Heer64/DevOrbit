// [Sprint 4 · M3] US-33 Manage the GitHub connection: the rules in lib/githubConnection.js.
// No database and no network: GitHub is a fake `fetchImpl`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizePurpose,
  checkRepositoryAccess,
  connectionStatus,
  currentRepositoryAccess,
  githubEventsAccepted,
  isDisconnected,
  mayCompleteAuthorization,
  revokeGithubToken,
  verifyConnection,
} from '../src/lib/githubConnection.js';
import { canManageGithubConnection } from '../src/lib/permissions.js';

const TOKEN = 'gho_UNIT_TEST_TOKEN_never_leaves_server';
const AUTHORIZED_AT = new Date('2026-11-01T10:00:00Z');

const repository = (extra = {}) => ({
  githubId: 101,
  name: 'devorbit',
  fullName: 'octo-owner/devorbit',
  owner: 'octo-owner',
  private: true,
  htmlUrl: 'https://github.com/octo-owner/devorbit',
  defaultBranch: 'main',
  admin: true,
  githubUserId: 4242,
  connectedBy: { _id: 'u1', name: 'Riya Kapoor', username: 'riyak' },
  connectedAt: new Date('2026-11-01T11:00:00Z'),
  ...extra,
});

const connection = (extra = {}) => ({
  githubUserId: 4242,
  githubLogin: 'octo-owner',
  authorizedAt: AUTHORIZED_AT,
  repository: repository(),
  ...extra,
});

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const rawRepo = (id = 101) => ({ id, name: 'devorbit', full_name: 'octo-owner/devorbit', owner: { login: 'octo-owner' }, html_url: 'https://github.com/octo-owner/devorbit' });

// Fake GitHub: routes by path; records calls.
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const path = new URL(url).pathname;
    const answer = routes[path];
    if (answer === undefined) throw new Error(`Unexpected request to ${url}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(options) : answer.clone();
  };
  return { fetchImpl, calls };
}

// --- Permissions -------------------------------------------------------------------------------

test('roles: Owner and Admin manage the connection; Contributor, Viewer and visitors do not', () => {
  assert.equal(canManageGithubConnection('Owner'), true);
  assert.equal(canManageGithubConnection('Admin'), true);
  for (const role of ['Contributor', 'Viewer', null, undefined, 'owner']) assert.equal(canManageGithubConnection(role), false);
});

test('first connect stays Owner only (US-31); re-authorize is Owner or Admin, connected or disconnected', () => {
  assert.equal(authorizePurpose({ role: 'Owner', connection: null }), 'connect');
  assert.equal(authorizePurpose({ role: 'Admin', connection: null }), null);
  assert.equal(authorizePurpose({ role: 'Contributor', connection: null }), null);

  for (const record of [connection(), connection({ status: 'disconnected' })]) {
    assert.equal(authorizePurpose({ role: 'Owner', connection: record }), 'reauthorize');
    assert.equal(authorizePurpose({ role: 'Admin', connection: record }), 'reauthorize');
    assert.equal(authorizePurpose({ role: 'Contributor', connection: record }), null);
    assert.equal(authorizePurpose({ role: 'Viewer', connection: record }), null);
  }
});

test('the callback re-checks the role for the purpose the flow was started with', () => {
  assert.equal(mayCompleteAuthorization({ role: 'Owner', purpose: 'connect', connectionExists: false }), true);
  assert.equal(mayCompleteAuthorization({ role: 'Owner', purpose: 'reauthorize', connectionExists: true }), true);
  assert.equal(mayCompleteAuthorization({ role: 'Admin', purpose: 'reauthorize', connectionExists: true }), true);
  // An Admin can never create the first connection, even with a forged purpose.
  assert.equal(mayCompleteAuthorization({ role: 'Admin', purpose: 'reauthorize', connectionExists: false }), false);
  assert.equal(mayCompleteAuthorization({ role: 'Admin', purpose: 'connect', connectionExists: true }), false);
  assert.equal(mayCompleteAuthorization({ role: 'Contributor', purpose: 'reauthorize', connectionExists: true }), false);
  assert.equal(mayCompleteAuthorization({ role: null, purpose: 'reauthorize', connectionExists: true }), false);
});

// --- Status ------------------------------------------------------------------------------------

test('AC1: a connected repository shows its name and Active; Owner and Admin get the management actions', () => {
  for (const role of ['Owner', 'Admin']) {
    const status = connectionStatus({ connection: connection(), configured: true, role });
    assert.equal(status.connectionState, 'active');
    assert.equal(status.active, true);
    assert.equal(status.repository.fullName, 'octo-owner/devorbit');
    assert.equal(status.canDisconnect, true);
    assert.equal(status.canReauthorize, true);
    assert.equal(status.canVerify, true);
    assert.equal(status.canAuthorize, true);
    assert.equal(status.acceptingEvents, true);
    assert.equal(status.canSelectRepository, role === 'Owner'); // choosing stays Owner only (US-32)
  }
});

test('legacy records without the new fields keep M2\'s meaning (connected, Active)', () => {
  const legacy = connection(); // no status, no needsReauthorization, no repositoryCheck
  assert.equal(isDisconnected(legacy), false);
  assert.equal(connectionStatus({ connection: legacy, configured: true, role: 'Owner' }).connectionState, 'active');
});

test('AC2: a disconnected connection is not Active, accepts no events, and keeps what re-authorize needs', () => {
  const record = connection({ status: 'disconnected', disconnectedAt: new Date('2026-11-02T09:00:00Z'), disconnectedBy: { _id: 'u2', name: 'Admin Ana', username: 'ana' } });
  for (const role of ['Owner', 'Admin']) {
    const status = connectionStatus({ connection: record, configured: true, role });
    assert.equal(status.connectionState, 'disconnected');
    assert.equal(status.active, false);
    assert.equal(status.acceptingEvents, false);
    assert.equal(status.canDisconnect, false);
    assert.equal(status.canVerify, false);
    assert.equal(status.canSelectRepository, false);
    assert.equal(status.canReauthorize, true);
    assert.equal(status.canAuthorize, true);
    assert.deepEqual(status.disconnectedBy, { _id: 'u2', name: 'Admin Ana', username: 'ana' });
    assert.equal(status.repository.fullName, 'octo-owner/devorbit', 'the last repository is still shown');
  }
  // Disconnected wins even when the server is not configured or the token had been rejected.
  assert.equal(connectionStatus({ connection: { ...record, needsReauthorization: true }, configured: false, role: 'Owner' }).connectionState, 'disconnected');
});

test('AC3: a rejected or unreadable token shows needs_reauthorization (not Active) until re-authorized', () => {
  for (const reason of ['token_rejected', 'token_unreadable']) {
    const status = connectionStatus({ connection: connection({ needsReauthorization: true, reauthorizationReason: reason }), configured: true, role: 'Admin' });
    assert.equal(status.connectionState, 'needs_reauthorization');
    assert.equal(status.active, false);
    assert.equal(status.reauthorizationReason, reason);
    assert.equal(status.canReauthorize, true);
    assert.equal(status.acceptingEvents, true, 'an expired token does not stop webhook events; only disconnect does');
  }
  const owner = connectionStatus({ connection: connection({ needsReauthorization: true }), configured: true, role: 'Owner' });
  assert.equal(owner.canSelectRepository, false, 'no repository picking with a dead token');
});

test('a repository check only counts for the repository and authorization in use now', () => {
  const lost = { githubId: 101, authorizedAt: AUTHORIZED_AT, access: 'not_accessible', checkedAt: new Date() };
  assert.equal(currentRepositoryAccess(connection({ repositoryCheck: lost })), 'not_accessible');
  assert.equal(connectionStatus({ connection: connection({ repositoryCheck: lost }), configured: true, role: 'Owner' }).connectionState, 'repository_unavailable');

  const unverified = { ...lost, access: 'unverified' };
  assert.equal(connectionStatus({ connection: connection({ repositoryCheck: unverified }), configured: true, role: 'Owner' }).connectionState, 'unverified');

  // Owner picked another repository since the check, or re-authorized since: the old check is ignored.
  assert.equal(currentRepositoryAccess(connection({ repositoryCheck: { ...lost, githubId: 999 } })), null);
  assert.equal(currentRepositoryAccess(connection({ repositoryCheck: { ...lost, authorizedAt: new Date('2026-10-01') } })), null);
  assert.equal(connectionStatus({ connection: connection({ repositoryCheck: { ...lost, githubId: 999 } }), configured: true, role: 'Owner' }).connectionState, 'active');
});

test('Contributors and Viewers never get management actions', () => {
  for (const role of ['Contributor', 'Viewer']) {
    const status = connectionStatus({ connection: connection(), configured: true, role });
    assert.equal(status.canDisconnect || status.canReauthorize || status.canVerify || status.canAuthorize || status.canSelectRepository, false);
  }
});

test('M2 states are unchanged: not_connected, unavailable, needs_repository', () => {
  assert.equal(connectionStatus({ connection: null, configured: true, role: 'Owner' }).connectionState, 'not_connected');
  assert.equal(connectionStatus({ connection: connection(), configured: false, role: 'Owner' }).connectionState, 'unavailable');
  assert.equal(connectionStatus({ connection: connection({ repository: null }), configured: true, role: 'Owner' }).connectionState, 'needs_repository');
  assert.equal(connectionStatus({ connection: connection({ githubUserId: 9999 }), configured: true, role: 'Owner' }).connectionState, 'needs_repository');
  const none = connectionStatus({ connection: null, configured: true, role: 'Admin' });
  assert.equal(none.canAuthorize, false);
  assert.equal(none.canReauthorize, false);
  assert.equal(none.canDisconnect, false);
});

// --- Event gate --------------------------------------------------------------------------------

test('gate: events are accepted only for a connected project with that repository', () => {
  assert.equal(githubEventsAccepted(connection()), true);
  assert.equal(githubEventsAccepted(connection(), 101), true);
  assert.equal(githubEventsAccepted(connection(), '101'), true);
  assert.equal(githubEventsAccepted(connection(), 102), false, 'another repository');
  assert.equal(githubEventsAccepted(connection({ status: 'disconnected' })), false);
  assert.equal(githubEventsAccepted(connection({ status: 'disconnected' }), 101), false);
  assert.equal(githubEventsAccepted(connection({ repository: null })), false);
  assert.equal(githubEventsAccepted(connection({ githubUserId: 9999 })), false, 'repository chosen under another account');
  assert.equal(githubEventsAccepted(null), false);
});

// --- Verification ------------------------------------------------------------------------------

test('verify: token valid AND repository readable', async () => {
  const { fetchImpl, calls } = fakeFetch({ '/user': json({ id: 4242, login: 'octo-owner' }), '/repositories/101': json(rawRepo()) });
  assert.deepEqual(await verifyConnection({ accessToken: TOKEN, connection: connection(), fetchImpl }), { token: 'valid', repository: 'accessible' });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ['/user', '/repositories/101']);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(new URL(call.url).host, 'api.github.com');
  }
});

test('verify: a valid token alone is not enough; a lost repository is reported', async () => {
  for (const answer of [json({ message: 'Not Found' }, 404), json({ message: 'SSO' }, 403)]) {
    const { fetchImpl } = fakeFetch({ '/user': json({ id: 4242, login: 'octo-owner' }), '/repositories/101': answer });
    assert.deepEqual(await verifyConnection({ accessToken: TOKEN, connection: connection(), fetchImpl }), { token: 'valid', repository: 'not_accessible' });
  }
});

test('verify: no repository chosen yet checks only the token', async () => {
  const { fetchImpl, calls } = fakeFetch({ '/user': json({ id: 4242, login: 'octo-owner' }) });
  assert.deepEqual(await verifyConnection({ accessToken: TOKEN, connection: connection({ repository: null }), fetchImpl }), { token: 'valid', repository: 'none' });
  assert.equal(calls.length, 1);
});

test('verify: a revoked token, or one for another GitHub account, is rejected', async () => {
  let fake = fakeFetch({ '/user': json({ message: 'Bad credentials' }, 401) });
  assert.deepEqual(await verifyConnection({ accessToken: TOKEN, connection: connection(), fetchImpl: fake.fetchImpl }), { token: 'rejected', repository: 'not_checked' });
  fake = fakeFetch({ '/user': json({ id: 1, login: 'other' }) });
  assert.deepEqual(await verifyConnection({ accessToken: TOKEN, connection: connection(), fetchImpl: fake.fetchImpl }), { token: 'rejected', repository: 'not_checked' });
  fake = fakeFetch({ '/user': json({ id: 4242, login: 'octo-owner' }), '/repositories/101': json({ message: 'Bad credentials' }, 401) });
  assert.deepEqual(await verifyConnection({ accessToken: TOKEN, connection: connection(), fetchImpl: fake.fetchImpl }), { token: 'rejected', repository: 'not_checked' });
});

test('verify: rate limits and outages throw (the caller changes nothing)', async () => {
  const limited = fakeFetch({ '/user': json({ message: 'rate' }, 403, { 'x-ratelimit-remaining': '0', 'retry-after': '30' }) });
  await assert.rejects(verifyConnection({ accessToken: TOKEN, connection: connection(), fetchImpl: limited.fetchImpl }), (error) => error.kind === 'rate_limited' && error.retryAfter === 30);
  const down = fakeFetch({ '/user': new Error('getaddrinfo ENOTFOUND') });
  await assert.rejects(verifyConnection({ accessToken: TOKEN, connection: connection(), fetchImpl: down.fetchImpl }), (error) => error.kind === 'unavailable' && !error.message.includes(TOKEN));
  const repoDown = fakeFetch({ '/user': json({ id: 4242, login: 'octo-owner' }), '/repositories/101': json({}, 502) });
  await assert.rejects(verifyConnection({ accessToken: TOKEN, connection: connection(), fetchImpl: repoDown.fetchImpl }), (error) => error.kind === 'unavailable');
});

test('repository check: a different repository behind the ID or a malformed answer is not trusted', async () => {
  let fake = fakeFetch({ '/repositories/101': json(rawRepo(555)) });
  assert.equal(await checkRepositoryAccess(TOKEN, 101, { fetchImpl: fake.fetchImpl }), 'not_accessible');
  fake = fakeFetch({ '/repositories/101': json({ nonsense: true }) });
  await assert.rejects(checkRepositoryAccess(TOKEN, 101, { fetchImpl: fake.fetchImpl }), (error) => error.kind === 'unavailable');
  assert.equal(await checkRepositoryAccess(TOKEN, -1, { fetchImpl: () => assert.fail('no request for a bad ID') }), 'not_accessible');
});

// --- Revocation --------------------------------------------------------------------------------

test('revoke: sends the token to GitHub\'s revoke endpoint with the app credentials only', async () => {
  const config = { clientId: 'Iv1.unit', clientSecret: 'unit-secret' };
  const { fetchImpl, calls } = fakeFetch({ '/applications/Iv1.unit/token': new Response(null, { status: 204 }) });
  assert.equal(await revokeGithubToken(TOKEN, config, { fetchImpl }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'DELETE');
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('Iv1.unit:unit-secret').toString('base64')}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { access_token: TOKEN });
});

test('revoke: already-invalid counts as done; failures return false and never throw', async () => {
  const config = { clientId: 'Iv1.unit', clientSecret: 'unit-secret' };
  assert.equal(await revokeGithubToken(TOKEN, config, fakeFetch({ '/applications/Iv1.unit/token': new Response(null, { status: 404 }) })), true);
  assert.equal(await revokeGithubToken(TOKEN, config, fakeFetch({ '/applications/Iv1.unit/token': json({}, 500) })), false);
  assert.equal(await revokeGithubToken(TOKEN, config, fakeFetch({ '/applications/Iv1.unit/token': new Error('offline') })), false);
  assert.equal(await revokeGithubToken('', config, { fetchImpl: () => assert.fail('no request') }), false);
  assert.equal(await revokeGithubToken(TOKEN, { clientId: '', clientSecret: '' }, { fetchImpl: () => assert.fail('no request') }), false);
});
