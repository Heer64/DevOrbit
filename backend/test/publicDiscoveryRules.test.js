// [Sprint 5 · M1] US-45: public Discover query rules (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOVER_PAGE_SIZE,
  DOMAIN_FILTER_MESSAGE,
  KEYWORD_TOO_LONG_MESSAGE,
  PAGE_MESSAGE,
  PROJECT_STATUSES,
  QUERY_TEXT_MESSAGE,
  STATUS_FILTER_MESSAGE,
  TAG_FILTER_MESSAGE,
  escapeRegex,
  readDiscoverQuery,
  sortedTags,
  toPublicProject,
} from '../src/lib/publicDiscovery.js';
import { PROJECT_DOMAINS } from '../src/lib/projectSetup.js';

test('no filters: only Public projects, page 1', () => {
  const result = readDiscoverQuery({});
  assert.deepEqual(result, { ok: true, filter: { visibility: 'Public' }, page: 1, applied: { q: '', domain: '', tag: '', status: '' } });
  assert.equal(DISCOVER_PAGE_SIZE, 24);
  assert.deepEqual(readDiscoverQuery(undefined).filter, { visibility: 'Public' });
});

test('the filter always stays visibility Public, whatever is sent', () => {
  for (const query of [{ visibility: 'Private' }, { q: 'x', visibility: 'Private' }, { $where: '1' }]) {
    const result = readDiscoverQuery(query);
    assert.equal(result.filter.visibility, 'Public');
    assert.equal('$where' in result.filter, false);
  }
});

test('keyword: name OR description only, case-insensitive, regex symbols are literal', () => {
  const { filter, applied } = readDiscoverQuery({ q: '  Garden ' });
  assert.equal(applied.q, 'Garden');
  assert.deepEqual(Object.keys(filter.$or.reduce((all, part) => ({ ...all, ...part }), {})), ['name', 'description']);
  const pattern = filter.$or[0].name;
  assert.ok(pattern.test('Open GARDEN app'));
  assert.equal(pattern.flags, 'i');

  const dotted = readDiscoverQuery({ q: 'a.b' }).filter.$or[0].name;
  assert.ok(dotted.test('a.b'));
  assert.equal(dotted.test('axb'), false);
  const paren = readDiscoverQuery({ q: '(' });
  assert.equal(paren.ok, true);
  assert.ok(paren.filter.$or[0].name.test('a (b)'));
  assert.equal(escapeRegex('.*+?^${}()|[]\\'), '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
});

test('keyword limit is 100 characters', () => {
  assert.equal(readDiscoverQuery({ q: 'x'.repeat(100) }).ok, true);
  assert.deepEqual(readDiscoverQuery({ q: 'x'.repeat(101) }), { ok: false, message: KEYWORD_TOO_LONG_MESSAGE });
});

test('domain must be on the agreed list; letter case is ignored', () => {
  const result = readDiscoverQuery({ domain: 'developer TOOLS' });
  assert.equal(result.filter.domain, 'Developer tools');
  assert.equal(result.applied.domain, 'Developer tools');
  for (const domain of PROJECT_DOMAINS) assert.equal(readDiscoverQuery({ domain }).filter.domain, domain);
  assert.deepEqual(readDiscoverQuery({ domain: 'Space' }), { ok: false, message: DOMAIN_FILTER_MESSAGE });
});

test('status must be Planning, In progress or Completed; letter case is ignored', () => {
  assert.deepEqual(PROJECT_STATUSES, ['Planning', 'In progress', 'Completed']);
  assert.equal(readDiscoverQuery({ status: 'in PROGRESS' }).filter.status, 'In progress');
  assert.deepEqual(readDiscoverQuery({ status: 'Archived' }), { ok: false, message: STATUS_FILTER_MESSAGE });
});

test('skill tag: exact match ignoring letter case, regex symbols literal, 40 characters max', () => {
  const tag = readDiscoverQuery({ tag: 'node.js' }).filter.tags;
  assert.ok(tag.test('Node.js'));
  assert.equal(tag.test('nodexjs'), false);
  assert.equal(tag.test('Node.js tools'), false);
  assert.ok(readDiscoverQuery({ tag: 'C++' }).filter.tags.test('c++'));
  assert.deepEqual(readDiscoverQuery({ tag: 't'.repeat(41) }), { ok: false, message: TAG_FILTER_MESSAGE });
});

test('filters combine', () => {
  const { filter } = readDiscoverQuery({ q: 'app', domain: 'Education', tag: 'React', status: 'Planning' });
  assert.deepEqual(Object.keys(filter).sort(), ['$or', 'domain', 'status', 'tags', 'visibility']);
});

test('page numbers', () => {
  assert.equal(readDiscoverQuery({ page: '3' }).page, 3);
  assert.equal(readDiscoverQuery({ page: '' }).page, 1);
  for (const page of ['0', '-1', '1.5', 'abc', '1001', '99999']) {
    assert.deepEqual(readDiscoverQuery({ page }), { ok: false, message: PAGE_MESSAGE }, page);
  }
  assert.equal(readDiscoverQuery({ page: '1000' }).page, 1000);
});

test('a filter sent twice (array) or as an object is refused', () => {
  assert.deepEqual(readDiscoverQuery({ q: ['a', 'b'] }), { ok: false, message: QUERY_TEXT_MESSAGE });
  assert.deepEqual(readDiscoverQuery({ domain: { $ne: 'x' } }), { ok: false, message: QUERY_TEXT_MESSAGE });
});

test('toPublicProject keeps only the safe fields and a member count', () => {
  const view = toPublicProject({
    _id: 'p1', name: 'Open Garden', description: 'd', domain: 'Community', tags: ['Community'], status: 'Planning',
    createdAt: 'c', updatedAt: 'u', visibility: 'Public', owner: 'u1', members: [{ user: 'u1', role: 'Owner' }, { user: 'u2', role: 'Viewer' }],
    github: { token: 'secret' }, progress: 40,
  });
  assert.deepEqual(view, { _id: 'p1', name: 'Open Garden', description: 'd', domain: 'Community', tags: ['Community'], status: 'Planning', createdAt: 'c', updatedAt: 'u', memberCount: 2 });
});

test('sortedTags removes blanks and duplicates (any letter case) and sorts', () => {
  assert.deepEqual(sortedTags(['react', 'Node.js', '', 'React', ' AI ', null]), ['AI', 'Node.js', 'react']);
});
