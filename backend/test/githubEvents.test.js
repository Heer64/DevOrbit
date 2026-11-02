// [Sprint 4 · M4] US-34: mapping GitHub webhook events to Activity Feed entries. No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COMMITS_PER_PUSH,
  deliveryRepositoryId,
  mapGithubEvent,
  safeGithubUrl,
} from '../src/lib/githubEvents.js';

const repository = { id: 101, full_name: 'octo-owner/devorbit' };
const sender = { login: 'octocat' };

const commit = (id, message, extra = {}) => ({
  id,
  message,
  url: `https://github.com/octo-owner/devorbit/commit/${id}`,
  author: { name: 'Octo Cat', username: 'octocat' },
  ...extra,
});

const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

test('push: one github.commit entry per commit with title, author, link and branch', () => {
  const entries = mapGithubEvent('push', {
    ref: 'refs/heads/main',
    repository,
    sender,
    commits: [commit(SHA1, 'Fix login bug\n\nLonger body'), commit(SHA2, 'Add tests', { author: { name: 'Riya K' } })],
  });
  assert.equal(entries.length, 2);
  const [first, second] = entries;
  assert.equal(first.type, 'github.commit');
  assert.equal(first.meta.title, 'Fix login bug');
  assert.equal(first.meta.author, 'octocat');
  assert.equal(first.meta.url, `https://github.com/octo-owner/devorbit/commit/${SHA1}`);
  assert.equal(first.meta.branch, 'main');
  assert.equal(first.meta.shortSha, 'aaaaaaa');
  assert.equal(first.meta.repository, 'octo-owner/devorbit');
  assert.equal(first.summary, 'pushed commit "Fix login bug" to main');
  assert.equal(first.key, `commit:${SHA1}`);
  assert.equal(second.meta.author, 'Riya K', 'falls back to the commit author name');
});

test('push: branch deletes, tags and pushes without commits add nothing', () => {
  assert.deepEqual(mapGithubEvent('push', { ref: 'refs/heads/old', deleted: true, repository, sender, commits: [] }), []);
  assert.deepEqual(mapGithubEvent('push', { ref: 'refs/tags/v1.0', repository, sender, commits: [commit(SHA1, 'x')] }), []);
  assert.deepEqual(mapGithubEvent('push', { ref: 'refs/heads/main', repository, sender, commits: [] }), []);
});

test(`push: at most ${MAX_COMMITS_PER_PUSH} commits per push and malformed commits are skipped`, () => {
  const commits = Array.from({ length: 30 }, (_, i) => commit(i.toString(16).padStart(40, '0'), `c${i}`));
  commits.unshift({ id: 'not-a-sha', message: 'bad' });
  const entries = mapGithubEvent('push', { ref: 'refs/heads/main', repository, sender, commits });
  assert.equal(entries.length, MAX_COMMITS_PER_PUSH);
  assert.equal(entries[0].meta.title, 'c0');
});

test('issues: opened / edited / closed / reopened map to github.issue', () => {
  const issue = {
    number: 12,
    title: 'Login fails on Safari',
    html_url: 'https://github.com/octo-owner/devorbit/issues/12',
    user: { login: 'reporter' },
    updated_at: '2026-11-02T08:00:00Z',
  };
  for (const [action, verb] of [['opened', 'opened'], ['edited', 'updated'], ['closed', 'closed'], ['reopened', 'reopened']]) {
    const [entry] = mapGithubEvent('issues', { action, issue, repository, sender });
    assert.equal(entry.type, 'github.issue');
    assert.equal(entry.summary, `${verb} issue #12 "Login fails on Safari"`);
    assert.equal(entry.meta.author, 'octocat');
    assert.equal(entry.meta.url, issue.html_url);
    assert.equal(entry.meta.number, 12);
    assert.equal(entry.key, `issue:12:${action}:2026-11-02T08:00:00Z`);
  }
  assert.deepEqual(mapGithubEvent('issues', { action: 'labeled', issue, repository, sender }), []);
});

test('issues: a payload that is really a pull request is skipped', () => {
  const issue = { number: 5, title: 'PR', html_url: 'https://github.com/o/r/pull/5', pull_request: { url: 'x' } };
  assert.deepEqual(mapGithubEvent('issues', { action: 'opened', issue, repository, sender }), []);
});

test('pull_request: opened, merged, closed and synchronize', () => {
  const pr = {
    number: 7,
    title: 'Add webhooks',
    html_url: 'https://github.com/octo-owner/devorbit/pull/7',
    updated_at: '2026-11-02T09:00:00Z',
    head: { sha: SHA2 },
    merged: false,
  };
  const [opened] = mapGithubEvent('pull_request', { action: 'opened', pull_request: pr, repository, sender });
  assert.equal(opened.type, 'github.pull_request');
  assert.equal(opened.summary, 'opened pull request #7 "Add webhooks"');
  assert.equal(opened.meta.url, pr.html_url);

  const [merged] = mapGithubEvent('pull_request', { action: 'closed', pull_request: { ...pr, merged: true }, repository, sender });
  assert.equal(merged.meta.action, 'merged');
  assert.equal(merged.summary, 'merged pull request #7 "Add webhooks"');

  const [closed] = mapGithubEvent('pull_request', { action: 'closed', pull_request: pr, repository, sender });
  assert.equal(closed.meta.action, 'closed');
  assert.notEqual(closed.key, merged.key);

  const [sync] = mapGithubEvent('pull_request', { action: 'synchronize', pull_request: pr, repository, sender });
  assert.equal(sync.summary, 'pushed new commits to pull request #7 "Add webhooks"');
  assert.ok(sync.key.endsWith(SHA2));

  assert.deepEqual(mapGithubEvent('pull_request', { action: 'labeled', pull_request: pr, repository, sender }), []);
});

test('unsupported events and junk payloads map to nothing', () => {
  assert.deepEqual(mapGithubEvent('star', { action: 'created', repository, sender }), []);
  assert.deepEqual(mapGithubEvent('push', null), []);
  assert.deepEqual(mapGithubEvent('issues', { action: 'opened' }), []);
});

test('only https://github.com links are kept', () => {
  assert.equal(safeGithubUrl('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
  assert.equal(safeGithubUrl('javascript:alert(1)'), '');
  assert.equal(safeGithubUrl('https://evil.example/github.com/o/r'), '');
  assert.equal(safeGithubUrl('http://github.com/o/r'), '');
  const [entry] = mapGithubEvent('issues', {
    action: 'opened', repository, sender,
    issue: { number: 1, title: 't', html_url: 'javascript:alert(1)', updated_at: 'x' },
  });
  assert.equal(entry.meta.url, '');
});

test('long titles are shortened in the summary', () => {
  const title = 'x'.repeat(200);
  const [entry] = mapGithubEvent('issues', { action: 'opened', repository, sender, issue: { number: 1, title, updated_at: 'u' } });
  assert.ok(entry.summary.length < 120);
  assert.equal(entry.meta.title, title);
});

test('deliveryRepositoryId reads repository.id', () => {
  assert.equal(deliveryRepositoryId({ repository }), 101);
  assert.equal(deliveryRepositoryId({ repository: { id: 'x' } }), null);
  assert.equal(deliveryRepositoryId({}), null);
});
