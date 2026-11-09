// [Sprint 5 · M2] US-46: public project page rules (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_PAGE_FIELDS,
  PUBLIC_PAGE_NOT_FOUND,
  isPublicProject,
  memberNames,
  toPublicProjectPage,
} from '../src/lib/publicProjectPage.js';

const fullProject = {
  _id: 'p1',
  name: 'Open Garden',
  description: 'Community gardening app',
  domain: 'Community',
  status: 'In progress',
  visibility: 'Public',
  tags: ['React'],
  color: 'mint',
  progress: 40,
  githubRepo: 'team/open-garden',
  completedAt: null,
  reopenStatus: '',
  createdAt: new Date('2026-11-01'),
  updatedAt: new Date('2026-11-05'),
  members: [
    { user: { _id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com', username: 'olivia' }, role: 'Owner' },
    { user: { _id: 'u2', name: 'Casey Contributor', email: 'casey@example.com' }, role: 'Contributor' },
  ],
};

test('AC1: the page has exactly name, description, domain, status and member names (plus the ID)', () => {
  const page = toPublicProjectPage(fullProject);
  assert.deepEqual(Object.keys(page).sort(), [...PUBLIC_PAGE_FIELDS, 'memberNames'].sort());
  assert.deepEqual(page, {
    _id: 'p1',
    name: 'Open Garden',
    description: 'Community gardening app',
    domain: 'Community',
    status: 'In progress',
    memberNames: ['Olivia Owner', 'Casey Contributor'],
  });
});

test('nothing personal or internal is copied: no emails, usernames, user IDs, roles, repo, tags or visibility', () => {
  const text = JSON.stringify(toPublicProjectPage(fullProject));
  for (const hidden of [
    'olivia@example.com',
    'casey@example.com',
    '"olivia"',
    '"u1"',
    '"u2"',
    '"role"',
    '"Owner"',
    '"Contributor"',
    'team/open-garden',
    'React',
    'Public',
    'mint',
    '"progress"',
    'githubRepo',
    'visibility',
    'tags',
  ]) {
    assert.ok(!text.includes(hidden), `"${hidden}" must not be on the public page: ${text}`);
  }
});

test('member names skip deleted accounts and empty names, and trim spaces', () => {
  assert.deepEqual(
    memberNames([
      { user: { name: '  Ada  ' } },
      { user: null },
      {},
      { user: { name: '' } },
      { user: { name: 42 } },
      { user: { name: 'Bo' } },
    ]),
    ['Ada', 'Bo']
  );
  assert.deepEqual(memberNames(undefined), []);
  assert.deepEqual(memberNames('not a list'), []);
});

test('a missing description becomes an empty string; an empty project gives no member names', () => {
  const page = toPublicProjectPage({ _id: 'p2', name: 'X', domain: 'Other', status: 'Planning' });
  assert.equal(page.description, '');
  assert.deepEqual(page.memberNames, []);
});

test('only Public projects have a public page', () => {
  assert.equal(isPublicProject({ visibility: 'Public' }), true);
  assert.equal(isPublicProject({ visibility: 'Private' }), false);
  assert.equal(isPublicProject({}), false);
  assert.equal(isPublicProject(null), false);
});

test('one message for private and missing projects, so a private project is not revealed', () => {
  assert.equal(PUBLIC_PAGE_NOT_FOUND, 'This project is not public or does not exist.');
});
