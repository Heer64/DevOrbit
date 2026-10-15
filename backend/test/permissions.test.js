import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assignableRoles,
  canEditProject,
  canWriteTasks,
  canDeleteTask,
  checkAddMember,
  checkRemoveMember,
  checkRoleChange
} from '../src/lib/permissions.js';


test('only Owner and Admin can edit project details', () => {
  assert.equal(canEditProject('Owner'), true);
  assert.equal(canEditProject('Admin'), true);
  assert.equal(canEditProject('Contributor'), false);
  assert.equal(canEditProject('Viewer'), false);
  assert.equal(canEditProject(null), false);
});

test('a Viewer cannot change roles', () => {
  const result = checkRoleChange('Viewer', 'Contributor', 'Admin');
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('a Contributor cannot change roles or add members', () => {
  assert.equal(checkRoleChange('Contributor', 'Viewer', 'Contributor').status, 403);
  assert.equal(checkAddMember('Contributor', 'Viewer').status, 403);
});

test('Owner can assign Admin, Contributor and Viewer but never a second Owner', () => {
  assert.deepEqual(assignableRoles('Owner'), ['Admin', 'Contributor', 'Viewer']);
  assert.equal(checkRoleChange('Owner', 'Viewer', 'Admin').ok, true);
  assert.equal(checkRoleChange('Owner', 'Viewer', 'Owner').status, 400);
  assert.equal(checkAddMember('Owner', 'Owner').status, 400);
});

test('Admin can only manage Contributors and Viewers and cannot create Admins', () => {
  assert.equal(checkRoleChange('Admin', 'Viewer', 'Contributor').ok, true);
  assert.equal(checkRoleChange('Admin', 'Viewer', 'Admin').status, 403);
  assert.equal(checkRoleChange('Admin', 'Admin', 'Viewer').status, 403);
  assert.equal(checkRoleChange('Admin', 'Owner', 'Viewer').status, 403);
  assert.equal(checkAddMember('Admin', 'Admin').status, 403);
  assert.equal(checkAddMember('Admin', 'Viewer').ok, true);
});

test('the Owner role cannot be changed or removed by anyone', () => {
  assert.equal(checkRoleChange('Owner', 'Owner', 'Admin').status, 403);
  assert.equal(checkRemoveMember('Owner', 'Owner', true).status, 403);
  assert.equal(checkRemoveMember('Admin', 'Owner', false).status, 403);
});

test('unknown roles are rejected', () => {
  assert.equal(checkRoleChange('Owner', 'Viewer', 'Superuser').status, 400);
  assert.equal(checkAddMember('Owner', 'Superuser').status, 400);
});

test('members can leave, but only managers can remove others', () => {
  assert.equal(checkRemoveMember('Viewer', 'Viewer', true).ok, true);
  assert.equal(checkRemoveMember('Viewer', 'Contributor', false).status, 403);
  assert.equal(checkRemoveMember('Admin', 'Viewer', false).ok, true);
  assert.equal(checkRemoveMember('Admin', 'Admin', false).status, 403);
  assert.equal(checkRemoveMember('Owner', 'Admin', false).ok, true);
});

test('Owner and Admin can create and edit tasks', () => {
  assert.equal(canWriteTasks('Owner'), true);
  assert.equal(canWriteTasks('Admin'), true);
});

test('Contributor can create and edit tasks', () => {
  assert.equal(canWriteTasks('Contributor'), true);
});

test('Viewer cannot create or edit tasks', () => {
  assert.equal(canWriteTasks('Viewer'), false);
  assert.equal(canWriteTasks(null), false);
});

test('Owner and Admin can delete any task', () => {
  assert.equal(canDeleteTask('Owner', false), true);
  assert.equal(canDeleteTask('Owner', true), true);
  assert.equal(canDeleteTask('Admin', false), true);
  assert.equal(canDeleteTask('Admin', true), true);
});

test('Contributor can delete only their own tasks', () => {
  assert.equal(canDeleteTask('Contributor', true), true);
  assert.equal(canDeleteTask('Contributor', false), false);
});

test('Viewer cannot delete tasks', () => {
  assert.equal(canDeleteTask('Viewer', true), false);
  assert.equal(canDeleteTask('Viewer', false), false);
});

test('unknown roles cannot write or delete tasks', () => {
  assert.equal(canWriteTasks('Superuser'), false);
  assert.equal(canDeleteTask('Superuser', true), false);
});
