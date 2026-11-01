// [Sprint 4 · M2] US-32: repository helpers and the Active rule (no database; GitHub is faked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GithubApiError,
  MAX_REPO_PAGES,
  REPOS_PER_PAGE,
  githubError,
  listUserRepositories,
  parseRepositoryId,
  repositoryStatus,
  repositoryView,
  storedRepository,
  toRepository,
} from '../src/lib/githubRepos.js';

const TOKEN = 'gho_UNIT_TEST_TOKEN_must_not_leak_42';

const rawRepo = (id, fullName = `octo/repo-${id}`, extra = {}) => ({
  id,
  name: fullName.split('/')[1],
  full_name: fullName,
  owner: { login: fullName.split('/')[0] },
  private: false,
  html_url: `https://github.com/${fullName}`,
  default_branch: 'main',
  description: 'A repo',
  archived: false,
  permissions: { admin: true, push: true, pull: true },
  updated_at: '2026-10-30T10:00:00Z',
  ...extra,
});

const json = (body, { status = 200, headers = {} } = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// A fake GitHub that serves pages of /user/repos and records every request.
function fakeGithub(pages, { linkNext = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const page = Number(new URL(url).searchParams.get('page'));
    const body = pages[page - 1] ?? [];
    const headers = linkNext && page < pages.length ? { Link: `<https://api.github.com/user/repos?page=${page + 1}>; rel="next"` } : {};
    return json(body, { headers });
  };
  return { fetchImpl, calls };
}

test('toRepository shapes GitHub data and keeps only what FORGE needs', () => {
  assert.deepEqual(toRepository(rawRepo(7, 'octo/hello-world', { private: true, permissions: { admin: false } })), {
    id: 7,
    name: 'hello-world',
    fullName: 'octo/hello-world',
    owner: 'octo',
    private: true,
    htmlUrl: 'https://github.com/octo/hello-world',
    defaultBranch: 'main',
    description: 'A repo',
    archived: false,
    admin: false,
    updatedAt: '2026-10-30T10:00:00Z',
  });
});

test('toRepository rejects malformed entries and unsafe links', () => {
  assert.equal(toRepository(null), null);
  assert.equal(toRepository({ id: 'x', full_name: 'a/b' }), null);
  assert.equal(toRepository({ id: -1, full_name: 'a/b' }), null);
  assert.equal(toRepository({ id: 3, full_name: 'no-slash' }), null);
  assert.equal(toRepository({ id: 3, full_name: 'a/b c' }), null);
  const evil = toRepository(rawRepo(9, 'octo/x', { html_url: 'javascript:alert(1)' }));
  assert.equal(evil.htmlUrl, 'https://github.com/octo/x', 'a non-GitHub link is replaced');
});

test('listUserRepositories sends the token only to api.github.com and pages through the list', async () => {
  const page1 = Array.from({ length: REPOS_PER_PAGE }, (_, i) => rawRepo(i + 1));
  const page2 = [rawRepo(101), rawRepo(5) /* duplicate */, { id: 'broken' }];
  const { fetchImpl, calls } = fakeGithub([page1, page2]);
  const result = await listUserRepositories(TOKEN, { fetchImpl });

  assert.equal(result.truncated, false);
  assert.equal(result.repositories.length, 101, 'duplicates and malformed entries are dropped');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(url.pathname, '/user/repos');
    assert.equal(url.searchParams.get('per_page'), '100');
    assert.equal(url.searchParams.get('affiliation'), 'owner,collaborator,organization_member');
    assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(call.options.signal, 'requests time out');
  }
});

test('listUserRepositories stops after the page limit and says the list was cut', async () => {
  const pages = Array.from({ length: MAX_REPO_PAGES + 2 }, (_, p) => Array.from({ length: REPOS_PER_PAGE }, (_, i) => rawRepo(p * 1000 + i + 1)));
  const { fetchImpl, calls } = fakeGithub(pages);
  const result = await listUserRepositories(TOKEN, { fetchImpl });
  assert.equal(calls.length, MAX_REPO_PAGES);
  assert.equal(result.repositories.length, MAX_REPO_PAGES * REPOS_PER_PAGE);
  assert.equal(result.truncated, true);
});

test('listUserRepositories: an empty account is an empty list, not an error', async () => {
  const { fetchImpl } = fakeGithub([[]]);
  assert.deepEqual(await listUserRepositories(TOKEN, { fetchImpl }), { repositories: [], truncated: false });
});

test('GitHub failures become typed errors without the token in them', async () => {
  const cases = [
    [json({ message: 'Bad credentials' }, { status: 401 }), 'unauthorized'],
    [json({}, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 90) } }), 'rate_limited'],
    [json({}, { status: 429, headers: { 'retry-after': '30' } }), 'rate_limited'],
    [json({ message: 'SAML enforcement' }, { status: 403 }), 'forbidden'],
    [json({}, { status: 502 }), 'unavailable'],
    [new Response('not json', { status: 200 }), 'unavailable'],
    [json({ not: 'a list' }), 'unavailable'],
  ];
  for (const [response, kind] of cases) {
    await assert.rejects(
      listUserRepositories(TOKEN, { fetchImpl: async () => response }),
      (error) => {
        assert.ok(error instanceof GithubApiError);
        assert.equal(error.kind, kind);
        assert.ok(!error.message.includes(TOKEN));
        return true;
      }
    );
  }
  await assert.rejects(listUserRepositories(TOKEN, { fetchImpl: async () => { throw new Error(`socket ${TOKEN}`); } }), (error) => {
    assert.equal(error.kind, 'unavailable');
    assert.ok(!error.message.includes(TOKEN), 'the network error text is not passed on');
    return true;
  });
  await assert.rejects(listUserRepositories('', { fetchImpl: async () => json([]) }), { kind: 'unauthorized' });
});

test('rate limit errors carry the wait time in seconds', () => {
  const now = Date.UTC(2026, 10, 1, 7, 0, 0);
  const reset = String(Math.floor(now / 1000) + 120);
  assert.equal(githubError(json({}, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }), now).retryAfter, 120);
  assert.equal(githubError(json({}, { status: 429, headers: { 'retry-after': '15' } }), now).retryAfter, 15);
  assert.equal(githubError(json({}, { status: 429 }), now).retryAfter, null);
});

test('parseRepositoryId accepts only positive whole numbers', () => {
  assert.equal(parseRepositoryId(123), 123);
  assert.equal(parseRepositoryId('456'), 456);
  for (const bad of [0, -1, 1.5, '12a', '', ' ', null, undefined, {}, [], '007', Number.MAX_SAFE_INTEGER + 1, '99999999999999999']) {
    assert.equal(parseRepositoryId(bad), null, `${JSON.stringify(bad)} is rejected`);
  }
});

const connected = (repo, githubUserId = 4242) => ({
  githubUserId,
  githubLogin: 'octo',
  repository: repo ? storedRepository(toRepository(rawRepo(77, 'octo/app')), { githubUserId: repo.chosenBy ?? githubUserId, connectedBy: { _id: 'u1', name: 'Riya Kapoor', username: 'riya' }, connectedAt: new Date('2026-11-01T07:00:00Z') }) : null,
});

test('Active only when authorized, configured and a repository is chosen under the current account', () => {
  assert.deepEqual(repositoryStatus({ connection: null, configured: true, role: 'Owner' }), {
    repository: null, connectionState: 'not_connected', active: false, canSelectRepository: false,
  });

  const noRepo = repositoryStatus({ connection: connected(null), configured: true, role: 'Owner' });
  assert.equal(noRepo.connectionState, 'needs_repository');
  assert.equal(noRepo.active, false);
  assert.equal(noRepo.canSelectRepository, true);

  const active = repositoryStatus({ connection: connected({}), configured: true, role: 'Owner' });
  assert.equal(active.connectionState, 'active');
  assert.equal(active.active, true);
  assert.equal(active.repository.fullName, 'octo/app');
  assert.equal(active.repository.id, 77);

  const unconfigured = repositoryStatus({ connection: connected({}), configured: false, role: 'Owner' });
  assert.equal(unconfigured.connectionState, 'unavailable');
  assert.equal(unconfigured.active, false);
  assert.equal(unconfigured.canSelectRepository, false);

  const otherAccount = repositoryStatus({ connection: connected({ chosenBy: 1111 }), configured: true, role: 'Owner' });
  assert.equal(otherAccount.connectionState, 'needs_repository', 'chosen under a different GitHub account');
  assert.equal(otherAccount.repository, null);
});

test('only the Owner may choose; Admins see the same state', () => {
  const admin = repositoryStatus({ connection: connected({}), configured: true, role: 'Admin' });
  assert.equal(admin.active, true);
  assert.equal(admin.canSelectRepository, false);
  assert.equal(repositoryStatus({ connection: connected(null), configured: true, role: 'Contributor' }).canSelectRepository, false);
});

test('repositoryView shows public fields only', () => {
  const view = repositoryView(connected({}));
  assert.deepEqual(Object.keys(view).sort(), ['connectedAt', 'connectedBy', 'defaultBranch', 'fullName', 'htmlUrl', 'id', 'name', 'owner', 'private'].sort());
  assert.deepEqual(view.connectedBy, { _id: 'u1', name: 'Riya Kapoor', username: 'riya' });
  assert.equal(JSON.stringify(view).includes('githubUserId'), false);
});
