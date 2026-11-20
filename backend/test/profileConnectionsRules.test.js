// [Sprint 7 · M4] Followers / following lists, projects on a profile, D6 snapshot: rules with no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECTIONS_PAGE_SIZE,
  canSeeOnProfile,
  connectionsPage,
  personView,
  profileProjectView,
  projectPathFor,
  readPage,
  snapshotView,
  visibleProfileProjects,
} from '../src/lib/profileConnectionsRules.js';

const OWNER = 'a'.repeat(24);
const VIEWER = 'b'.repeat(24);
const STRANGER = 'c'.repeat(24);

const project = (overrides = {}) => ({
  _id: 'p'.repeat(24),
  name: 'Open Garden',
  description: 'Community app',
  domain: 'Community',
  status: 'In progress',
  visibility: 'Public',
  tags: ['React'],
  color: 'mint',
  members: [{ user: OWNER, role: 'Owner' }],
  ...overrides,
});

test('readPage: whole numbers from 1, anything else is page 1', () => {
  assert.equal(readPage('3'), 3);
  assert.equal(readPage(undefined), 1);
  assert.equal(readPage('0'), 1);
  assert.equal(readPage('-2'), 1);
  assert.equal(readPage('abc'), 1);
  assert.equal(readPage('999999'), 10000);
});

test('personView: only name, username, headline and photo (no ID, no email)', () => {
  const view = personView({ _id: OWNER, name: 'Ann', username: 'ann', headline: 'Dev', avatarUrl: '/a.png', email: 'ann@example.com' });
  assert.deepEqual(Object.keys(view).sort(), ['avatarUrl', 'headline', 'name', 'username']);
  assert.ok(!JSON.stringify(view).includes(OWNER));
});

test('connectionsPage: hasMore, total, and rows without a user are skipped', () => {
  const people = Array.from({ length: CONNECTIONS_PAGE_SIZE }, (_, i) => ({ name: `P${i}`, username: `p${i}` }));
  const first = connectionsPage([...people, {}], 45, 1);
  assert.equal(first.people.length, CONNECTIONS_PAGE_SIZE);
  assert.equal(first.total, 45);
  assert.equal(first.hasMore, true);
  assert.equal(connectionsPage([], 45, 3).hasMore, false);
  assert.equal(connectionsPage([], -1, 1).total, 0);
});

test('canSeeOnProfile: Public for everyone, Private only for members', () => {
  assert.equal(canSeeOnProfile(project(), STRANGER), true);
  const secret = project({
    visibility: 'Private',
    members: [
      { user: OWNER, role: 'Owner' },
      { user: VIEWER, role: 'Viewer' },
    ],
  });
  assert.equal(canSeeOnProfile(secret, VIEWER), true);
  assert.equal(canSeeOnProfile(secret, OWNER), true);
  assert.equal(canSeeOnProfile(secret, STRANGER), false);
  assert.equal(canSeeOnProfile(secret, null), false);
});

test('projectPathFor: members open the workspace, others the public project page', () => {
  assert.equal(projectPathFor(project(), true), `/project/${'p'.repeat(24)}`);
  assert.equal(projectPathFor(project(), false), `/discover/${'p'.repeat(24)}`);
});

test('profileProjectView: role of the profile user, member count, never the member list', () => {
  const view = profileProjectView(
    project({
      members: [
        { user: OWNER, role: 'Owner' },
        { user: VIEWER, role: 'Admin' },
      ],
    }),
    OWNER,
    VIEWER
  );
  assert.equal(view.role, 'Owner');
  assert.equal(view.memberCount, 2);
  assert.equal(view.viewerIsMember, true);
  assert.equal(view.path, `/project/${'p'.repeat(24)}`);
  assert.ok(!('members' in view));
});

test('visibleProfileProjects: hides Private projects the viewer is not in, and projects the user is not in', () => {
  const list = [
    project({ name: 'Public One' }),
    project({
      _id: 'q'.repeat(24),
      name: 'Private Shared',
      visibility: 'Private',
      members: [
        { user: OWNER, role: 'Owner' },
        { user: VIEWER, role: 'Contributor' },
      ],
    }),
    project({ _id: 'r'.repeat(24), name: 'Private Hidden', visibility: 'Private' }),
    project({ _id: 's'.repeat(24), name: 'Not Theirs', members: [{ user: STRANGER, role: 'Owner' }] }),
  ];
  assert.deepEqual(
    visibleProfileProjects(list, OWNER, VIEWER).map((p) => p.name),
    ['Public One', 'Private Shared']
  );
  assert.deepEqual(
    visibleProfileProjects(list, OWNER, STRANGER).map((p) => p.name),
    ['Public One']
  );
  assert.deepEqual(
    visibleProfileProjects(list, OWNER, OWNER).map((p) => p.name),
    ['Public One', 'Private Shared', 'Private Hidden']
  );
});

test('snapshotView (D6): whole numbers >= 0 and an ISO join date', () => {
  const view = snapshotView({ tasksCompleted: 4.8, messagesPosted: -2, collaborators: 'x', joinedAt: new Date('2026-09-14T10:00:00Z') });
  assert.equal(view.tasksCompleted, 4);
  assert.equal(view.messagesPosted, 0);
  assert.equal(view.collaborators, 0);
  assert.equal(view.joinedAt, '2026-09-14T10:00:00.000Z');
  assert.equal(snapshotView({}).joinedAt, null);
});
