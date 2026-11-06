// [Sprint 5 · M5] US-49 portfolio rules (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATS_MAX_AGE_MS,
  PRIVATE_PROJECT_NAME,
  isStale,
  ownerSummary,
  projectView,
  readUsername,
  roleIn,
  statsUpdatedAt,
  totalsOf,
} from '../src/lib/portfolioRules.js';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const USER = 'u'.repeat(24);
const project = (overrides = {}) => ({
  _id: 'p'.repeat(24),
  name: 'Open Garden',
  description: 'Community gardening app',
  domain: 'Community',
  tags: ['community'],
  visibility: 'Public',
  completedAt: new Date('2026-11-01T00:00:00.000Z'),
  members: [{ user: 'o'.repeat(24), role: 'Owner' }, { user: USER, role: 'Contributor' }],
  ...overrides,
});
const stat = (overrides = {}) => ({ tasksCompleted: 3, decisionsRecorded: 2, messagesPosted: 5, computedAt: NOW, ...overrides });

test('NFR-12: numbers are fresh for just under 24 hours, then stale', () => {
  assert.equal(isStale(null, NOW), true);
  assert.equal(isStale({}, NOW), true);
  assert.equal(isStale(stat({ computedAt: NOW }), NOW), false);
  assert.equal(isStale(stat({ computedAt: new Date(NOW - STATS_MAX_AGE_MS + 1) }), NOW), false);
  assert.equal(isStale(stat({ computedAt: new Date(NOW - STATS_MAX_AGE_MS) }), NOW), true);
  assert.equal(isStale(stat({ computedAt: new Date(NOW - 3 * STATS_MAX_AGE_MS) }), NOW), true);
});

test('NFR-12: numbers dated in the future or with a broken date are counted again', () => {
  assert.equal(isStale(stat({ computedAt: new Date(NOW.getTime() + 60_000) }), NOW), true);
  assert.equal(isStale(stat({ computedAt: 'not a date' }), NOW), true);
  assert.equal(STATS_MAX_AGE_MS, 24 * 60 * 60 * 1000);
});

test('usernames: lowercase letters, digits, dot, dash, underscore, up to 30', () => {
  assert.equal(readUsername('Priya_K'), 'priya_k');
  assert.equal(readUsername('  aarav.seed-1 '), 'aarav.seed-1');
  for (const bad of ['', 'has space', 'x'.repeat(31), '../admin', 'name!', null, undefined, 42, ['a']]) {
    assert.equal(readUsername(bad), null, String(bad));
  }
});

test('AC1: the role is the one this user holds in that project', () => {
  assert.equal(roleIn(project(), USER), 'Contributor');
  assert.equal(roleIn(project({ members: [{ user: { _id: USER }, role: 'Admin' }] }), USER), 'Admin');
  assert.equal(roleIn(project(), 'z'.repeat(24)), null);
});

test('owner view: full details, the project ID and the numbers', () => {
  const view = projectView(project(), USER, stat());
  assert.equal(view._id, 'p'.repeat(24));
  assert.equal(view.name, 'Open Garden');
  assert.equal(view.role, 'Contributor');
  assert.equal(view.isPrivate, false);
  assert.deepEqual(view.stats, { tasksCompleted: 3, decisionsRecorded: 2, messagesPosted: 5, computedAt: NOW });
  const priv = projectView(project({ visibility: 'Private', name: 'Secret Lab' }), USER, stat());
  assert.equal(priv.name, 'Secret Lab', 'the owner sees their own private project names');
  assert.equal(priv.isPrivate, true);
});

test('public view: no project IDs; a Private project keeps role, domain, date and numbers but hides the rest', () => {
  const open = projectView(project(), USER, stat(), { publicView: true });
  assert.equal(open._id, undefined);
  assert.equal(open.name, 'Open Garden');

  const hidden = projectView(project({ visibility: 'Private', name: 'Secret Lab', description: 'Internal', tags: ['x'] }), USER, stat(), { publicView: true });
  assert.equal(hidden.name, PRIVATE_PROJECT_NAME);
  assert.equal(hidden.description, '');
  assert.deepEqual(hidden.tags, []);
  assert.equal(hidden._id, undefined);
  assert.equal(hidden.role, 'Contributor');
  assert.equal(hidden.domain, 'Community');
  assert.equal(hidden.stats.tasksCompleted, 3);
  assert.equal(JSON.stringify(hidden).includes('Secret Lab'), false);
});

test('missing numbers show as zero', () => {
  const view = projectView(project(), USER, undefined);
  assert.deepEqual(view.stats, { tasksCompleted: 0, decisionsRecorded: 0, messagesPosted: 0, computedAt: null });
});

test('totals add up every project; the update time is the oldest one shown', () => {
  const older = new Date(NOW.getTime() - 3600_000);
  const items = [
    projectView(project(), USER, stat()),
    projectView(project(), USER, stat({ tasksCompleted: 1, decisionsRecorded: 0, messagesPosted: 2, computedAt: older })),
  ];
  assert.deepEqual(totalsOf(items), { projects: 2, tasksCompleted: 4, decisionsRecorded: 2, messagesPosted: 7 });
  assert.equal(statsUpdatedAt(items).getTime(), older.getTime());
  assert.deepEqual(totalsOf([]), { projects: 0, tasksCompleted: 0, decisionsRecorded: 0, messagesPosted: 0 });
  assert.equal(statsUpdatedAt([]), null);
});

test('the owner summary carries only public profile fields', () => {
  const summary = ownerSummary({ name: 'Max', username: 'max', email: 'max@example.com', passwordHash: 'x', headline: 'Dev', avatarUrl: '/a.png', bio: 'b' });
  assert.deepEqual(summary, { name: 'Max', username: 'max', headline: 'Dev', avatarUrl: '/a.png' });
});
