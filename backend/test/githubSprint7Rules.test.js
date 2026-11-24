// [Sprint 7 · M8] D3, D4 and missed GitHub events: the rules and the GitHub calls, with no database.
// GitHub is never called: every function takes a fake fetchImpl.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_FILES_MAX,
  clearCodeCache,
  codeCacheKey,
  codeErrorReason,
  fetchRepositoryCode,
  readCodeCache,
  safeGithubLink,
  toCodeRepository,
  toTopLevelFiles,
  writeCodeCache,
} from '../src/lib/githubCode.js';
import {
  LEFT_WEBHOOK_MESSAGE,
  leftWebhookView,
  listHookDeliveries,
  redeliverHookDelivery,
  webhookLeftAfterDisconnect,
  webhookSettingsUrl,
} from '../src/lib/githubWebhooks.js';
import {
  MAX_REDELIVERIES_PER_RUN,
  MAX_REDELIVERY_ATTEMPTS,
  MISSED_EVENTS_WINDOW_MS,
  missedDeliveries,
  missedEventsLogLine,
  missedEventsTarget,
  recheckMessage,
  toHookDelivery,
} from '../src/lib/githubMissedEventsRules.js';
import { GithubApiError } from '../src/lib/githubRepos.js';

const TOKEN = 'gho_SPRINT7_M8_token_never_leaves_server';
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const rawRepo = (extra = {}) => ({
  id: 101, name: 'devorbit', full_name: 'octo-owner/devorbit', owner: { login: 'octo-owner' }, private: true,
  html_url: 'https://github.com/octo-owner/devorbit', default_branch: 'main', stargazers_count: 7, forks_count: 2,
  open_issues_count: 5, pushed_at: '2026-11-20T10:00:00Z', permissions: { admin: true }, ...extra,
});
const item = (name, type = 'file') => ({ name, type, html_url: `https://github.com/octo-owner/devorbit/${type === 'dir' ? 'tree' : 'blob'}/main/${name}` });

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const { pathname, search } = new URL(url);
    for (const [match, answer] of routes) {
      if (match(pathname, options.method || 'GET', search)) return typeof answer === 'function' ? answer(url, options) : answer.clone();
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  return { fetchImpl, calls };
}

// --- D3: Code & files -----------------------------------------------------------------------

describe('D3: real Code & files data', () => {
  test('repository numbers come from GitHub, never the sample "12 forks / 4 open PRs / 128 commits"', () => {
    const shaped = toCodeRepository(rawRepo());
    assert.deepEqual(shaped.repository, { fullName: 'octo-owner/devorbit', htmlUrl: 'https://github.com/octo-owner/devorbit', defaultBranch: 'main', private: true });
    assert.deepEqual(shaped.stats, { stars: 7, forks: 2, openIssuesAndPrs: 5, pushedAt: '2026-11-20T10:00:00Z' });
    assert.equal(toCodeRepository({ id: 'x' }), null);
    // Odd numbers become 0, never NaN or negative.
    assert.deepEqual(toCodeRepository(rawRepo({ stargazers_count: -1, forks_count: 'many', pushed_at: 'nope' })).stats, { stars: 0, forks: 0, openIssuesAndPrs: 5, pushedAt: null });
  });

  test('top-level files: folders first, then by name, max 20, unsafe links dropped', () => {
    const raw = [item('README.md'), item('src', 'dir'), item('.github', 'dir'), item('package.json'), item('docs', 'dir'), item('sub', 'submodule'),
      { name: 'evil', type: 'file', html_url: 'javascript:alert(1)' }, { name: '', type: 'file' }, null, { name: 'a\nb', type: 'file' }];
    const { files, total, more } = toTopLevelFiles(raw);
    assert.deepEqual(files.map((f) => `${f.type}:${f.name}`), ['dir:.github', 'dir:docs', 'dir:src', 'file:evil', 'file:package.json', 'file:README.md', 'file:sub']);
    assert.equal(total, 7);
    assert.equal(more, false);
    assert.equal(files.find((f) => f.name === 'evil').htmlUrl, null, 'only github.com https links reach the browser');
    const many = toTopLevelFiles(Array.from({ length: 30 }, (_, i) => item(`f${String(i).padStart(2, '0')}`)));
    assert.equal(many.files.length, CODE_FILES_MAX);
    assert.equal(many.total, 30);
    assert.equal(many.more, true);
    assert.deepEqual(toTopLevelFiles({ message: 'not a list' }), { files: [], total: 0, more: false });
  });

  test('safeGithubLink only allows https://github.com links', () => {
    assert.equal(safeGithubLink('https://github.com/a/b'), 'https://github.com/a/b');
    for (const bad of ['http://github.com/a', 'https://evil.com/a', 'https://github.com.evil.com/a', 'javascript:x', null, 'https://github.com/a b']) {
      assert.equal(safeGithubLink(bad), null, String(bad));
    }
  });

  test('fetchRepositoryCode reads the repository by ID, then its contents by its current name', async () => {
    const { fetchImpl, calls } = fakeFetch([
      [(p) => p === '/repositories/101', json(rawRepo({ full_name: 'octo-owner/renamed', name: 'renamed', html_url: 'https://github.com/octo-owner/renamed' }))],
      [(p) => p === '/repos/octo-owner/renamed/contents', json([item('README.md'), item('src', 'dir')])],
    ]);
    const code = await fetchRepositoryCode({ accessToken: TOKEN, githubRepositoryId: 101, fetchImpl });
    assert.equal(code.repository.fullName, 'octo-owner/renamed', 'a renamed repository is still found');
    assert.deepEqual(code.files.map((f) => f.name), ['src', 'README.md']);
    assert.equal(code.empty, false);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(JSON.stringify(code).includes(TOKEN), false);
  });

  test('an empty repository (contents 404) is not an error', async () => {
    const { fetchImpl } = fakeFetch([
      [(p) => p === '/repositories/101', json(rawRepo())],
      [(p) => p.endsWith('/contents'), json({ message: 'This repository is empty.' }, 404)],
    ]);
    const code = await fetchRepositoryCode({ accessToken: TOKEN, githubRepositoryId: 101, fetchImpl });
    assert.equal(code.empty, true);
    assert.deepEqual(code.files, []);
  });

  test('GitHub problems become reasons: 401 reauthorize, 404 gone, 403 rate limit, network down', async () => {
    const cases = [
      [json({ message: 'Bad credentials' }, 401), 'reauthorize'],
      [json({ message: 'Not Found' }, 404), 'repository_unavailable'],
      [json({ message: 'rate' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' }), 'rate_limited'],
      [json({ message: 'SSO' }, 403), 'forbidden'],
      [json({ message: 'boom' }, 502), 'unavailable'],
    ];
    for (const [answer, reason] of cases) {
      const { fetchImpl } = fakeFetch([[(p) => p === '/repositories/101', answer]]);
      await assert.rejects(
        fetchRepositoryCode({ accessToken: TOKEN, githubRepositoryId: 101, fetchImpl }),
        (error) => error instanceof GithubApiError && codeErrorReason(error) === reason && !String(error.message).includes(TOKEN)
      );
    }
    const down = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(fetchRepositoryCode({ accessToken: TOKEN, githubRepositoryId: 101, fetchImpl: down }), (e) => codeErrorReason(e) === 'unavailable');
    assert.equal(codeErrorReason(new Error('x')), 'unavailable');
  });

  test('the cache keeps an answer for a minute, per project + repository + authorization', () => {
    clearCodeCache();
    const key = codeCacheKey({ projectId: 'p1', githubRepositoryId: 101, authorizedAt: '2026-11-20T10:00:00Z' });
    assert.notEqual(key, codeCacheKey({ projectId: 'p1', githubRepositoryId: 101, authorizedAt: '2026-11-21T10:00:00Z' }), 're-authorizing starts fresh');
    assert.notEqual(key, codeCacheKey({ projectId: 'p1', githubRepositoryId: 102, authorizedAt: '2026-11-20T10:00:00Z' }), 'another repository starts fresh');
    writeCodeCache(key, { state: 'active' }, { now: 1000 });
    assert.deepEqual(readCodeCache(key, 1000 + 59_000), { state: 'active' });
    assert.equal(readCodeCache(key, 1000 + 61_000), null);
    clearCodeCache();
  });
});

// --- D4: webhook left on GitHub -------------------------------------------------------------

describe('D4: Disconnect could not remove the webhook', () => {
  test('only a real failure is a warning', () => {
    assert.deepEqual(webhookLeftAfterDisconnect({ hadHook: false, hasToken: true, removal: null }), { left: false });
    assert.deepEqual(webhookLeftAfterDisconnect({ hadHook: true, hasToken: true, removal: { removed: true } }), { left: false });
    for (const reason of ['no_webhook', 'shared', 'other_repository']) {
      assert.deepEqual(webhookLeftAfterDisconnect({ hadHook: true, hasToken: true, removal: { removed: false, reason } }), { left: false }, reason);
    }
    assert.deepEqual(webhookLeftAfterDisconnect({ hadHook: true, hasToken: true, removal: { removed: false, reason: 'error' } }), { left: true, reason: 'github_refused' });
    assert.deepEqual(webhookLeftAfterDisconnect({ hadHook: true, hasToken: false, removal: null }), { left: true, reason: 'no_token' });
  });

  test('settings link and view (never the hook ID)', () => {
    assert.equal(webhookSettingsUrl('octo-owner/devorbit'), 'https://github.com/octo-owner/devorbit/settings/hooks');
    assert.equal(webhookSettingsUrl('../../evil'), null);
    assert.equal(leftWebhookView(null), null);
    assert.equal(leftWebhookView({ webhookLeft: null }), null);
    const at = new Date('2026-11-20T10:00:00Z');
    const view = leftWebhookView({ webhookLeft: { hookId: 77, repositoryFullName: 'octo-owner/devorbit', reason: 'github_refused', at } });
    assert.deepEqual(view, {
      repositoryFullName: 'octo-owner/devorbit',
      settingsUrl: 'https://github.com/octo-owner/devorbit/settings/hooks',
      reason: 'github_refused',
      at,
      message: LEFT_WEBHOOK_MESSAGE,
    });
    assert.equal('hookId' in view, false);
    assert.match(LEFT_WEBHOOK_MESSAGE, /Delete it in the repository's Settings → Webhooks/);
  });
});

// --- Missed events --------------------------------------------------------------------------

const NOW = Date.parse('2026-11-23T12:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();
let nextId = 1;
const delivery = (guid, { status = 502, event = 'push', ago = 30, redelivery = false } = {}) => ({
  id: nextId++, guid, delivered_at: minutesAgo(ago), redelivery, status_code: status, event, action: event === 'push' ? null : 'opened',
});

describe('missed events: which deliveries to ask GitHub for again', () => {
  test('a push that never got a 2xx and that we never stored is missed', () => {
    const result = missedDeliveries({ deliveries: [delivery('g-asleep', { status: 0 })], receivedIds: [], now: NOW });
    assert.equal(result.checked, 1);
    assert.deepEqual(result.missed.map((m) => m.guid), ['g-asleep']);
  });

  test('not missed: answered 2xx, already stored, ping, other events, or older than 24 hours', () => {
    const deliveries = [
      delivery('g-ok', { status: 202 }),
      delivery('g-stored', { status: 502 }),
      delivery('g-ping', { status: 502, event: 'ping' }),
      delivery('g-star', { status: 502, event: 'star' }),
      delivery('g-old', { status: 502, ago: MISSED_EVENTS_WINDOW_MS / 60_000 + 5 }),
      // Failed first, then a redelivery that worked.
      delivery('g-retried', { status: 502, ago: 60 }),
      delivery('g-retried', { status: 202, ago: 10, redelivery: true }),
    ];
    const result = missedDeliveries({ deliveries, receivedIds: new Set(['g-stored']), now: NOW });
    assert.deepEqual(result.missed, []);
  });

  test('issues and pull_request count too; the newest attempt is the one re-sent; oldest first', () => {
    const first = delivery('g-issue', { status: 502, event: 'issues', ago: 120 });
    const again = delivery('g-issue', { status: 504, event: 'issues', ago: 40, redelivery: true });
    const pr = delivery('g-pr', { status: 503, event: 'pull_request', ago: 90 });
    const result = missedDeliveries({ deliveries: [pr, again, first], now: NOW });
    assert.deepEqual(result.missed.map((m) => [m.guid, m.id]), [['g-issue', again.id], ['g-pr', pr.id]]);
  });

  test(`at most ${MAX_REDELIVERIES_PER_RUN} per run, and give up after ${MAX_REDELIVERY_ATTEMPTS} re-sends`, () => {
    const many = Array.from({ length: 30 }, (_, i) => delivery(`g-${i}`, { ago: 100 - i }));
    const capped = missedDeliveries({ deliveries: many, now: NOW });
    assert.equal(capped.missed.length, MAX_REDELIVERIES_PER_RUN);
    assert.equal(capped.missed[0].guid, 'g-0', 'oldest first');

    const stubborn = [delivery('g-bad', { status: 401, ago: 200 }),
      ...Array.from({ length: MAX_REDELIVERY_ATTEMPTS }, (_, i) => delivery('g-bad', { status: 401, ago: 100 - i, redelivery: true }))];
    const result = missedDeliveries({ deliveries: stubborn, now: NOW });
    assert.deepEqual(result.missed, []);
    assert.equal(result.gaveUp, 1);
  });

  test('malformed log entries are skipped', () => {
    assert.equal(toHookDelivery(null), null);
    assert.equal(toHookDelivery({ id: 1, guid: 'bad guid!', delivered_at: minutesAgo(1) }), null);
    assert.equal(toHookDelivery({ id: 1, guid: 'g', delivered_at: 'never' }), null);
    assert.deepEqual(toHookDelivery({ id: 5, guid: 'g', delivered_at: minutesAgo(1), status_code: 202, event: 'push', redelivery: true }),
      { id: 5, guid: 'g', deliveredAt: NOW - 60_000, statusCode: 202, event: 'push', action: '', redelivery: true });
  });

  test('which webhook is checked', () => {
    const connection = {
      status: 'connected', githubUserId: 1, needsReauthorization: false,
      repository: { githubId: 101, fullName: 'octo-owner/devorbit', githubUserId: 1 },
      webhook: { status: 'active', hookId: 77, repositoryId: 101 },
    };
    assert.deepEqual(missedEventsTarget(connection), { fullName: 'octo-owner/devorbit', hookId: 77, repositoryId: 101 });
    assert.equal(missedEventsTarget({ ...connection, status: 'disconnected' }), null);
    assert.equal(missedEventsTarget({ ...connection, needsReauthorization: true }), null);
    assert.equal(missedEventsTarget({ ...connection, webhook: { status: 'failed', hookId: null } }), null);
    assert.equal(missedEventsTarget({ ...connection, webhook: { status: 'active', hookId: 77, repositoryId: 999 } }), null, 'a hook of an earlier repository');
    assert.equal(missedEventsTarget({ ...connection, repository: { ...connection.repository, githubUserId: 2 } }), null, 'repository of another GitHub account');
    assert.equal(missedEventsTarget(null), null);
  });

  test('messages and log line', () => {
    assert.equal(recheckMessage({ redelivered: 0 }), 'No missed GitHub events in the last 24 hours.');
    assert.match(recheckMessage({ redelivered: 1 }), /send 1 missed event again/);
    assert.match(recheckMessage({ redelivered: 3 }), /send 3 missed events again/);
    assert.equal(missedEventsLogLine({ fullName: 'o/r', checked: 4, redelivered: 2 }), '[github] missed events for o/r: checked 4, asked GitHub to resend 2');
  });
});

describe('missed events: GitHub calls', () => {
  test('listHookDeliveries reads pages with GitHub\'s cursor and stops at the window', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => delivery(`p1-${i}`, { ago: i + 1 }));
    const page2 = [delivery('p2-0', { ago: 2000 })];
    const { fetchImpl, calls } = fakeFetch([
      [(p, m, s) => p === '/repos/octo-owner/devorbit/hooks/77/deliveries' && !s.includes('cursor'),
        json(page1, 200, { link: '<https://api.github.com/repositories/101/hooks/77/deliveries?per_page=100&cursor=v1_abc>; rel="next"' })],
      [(p, m, s) => p === '/repos/octo-owner/devorbit/hooks/77/deliveries' && s.includes('cursor=v1_abc'), json(page2)],
    ]);
    const all = await listHookDeliveries({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', hookId: 77, since: NOW - 24 * 3600_000, fetchImpl });
    assert.equal(all.length, 101);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  });

  test('listHookDeliveries: no admin rights / hook gone -> not_admin; 401 -> unauthorized', async () => {
    for (const [answer, kind] of [[json({}, 404), 'not_admin'], [json({}, 403), 'not_admin'], [json({}, 401), 'unauthorized']]) {
      const { fetchImpl } = fakeFetch([[() => true, answer]]);
      await assert.rejects(listHookDeliveries({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', hookId: 77, fetchImpl }), (e) => e.kind === kind);
    }
  });

  test('redeliverHookDelivery posts to .../deliveries/{id}/attempts and accepts 202', async () => {
    const { fetchImpl, calls } = fakeFetch([[(p, m) => p === '/repos/octo-owner/devorbit/hooks/77/deliveries/555/attempts' && m === 'POST', new Response(null, { status: 202 })]]);
    assert.equal(await redeliverHookDelivery({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', hookId: 77, deliveryId: 555, fetchImpl }), true);
    assert.equal(calls.length, 1);
    await assert.rejects(redeliverHookDelivery({ accessToken: TOKEN, fullName: 'octo-owner/devorbit', hookId: 77, deliveryId: 0, fetchImpl }));
    await assert.rejects(redeliverHookDelivery({ accessToken: TOKEN, fullName: 'bad name', hookId: 77, deliveryId: 5, fetchImpl }));
  });
});
