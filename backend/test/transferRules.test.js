// [Sprint 7 · M7] Transfer ownership rule (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_ROLE_MESSAGE, checkAddMember, checkRoleChange, checkTransferOwnership } from '../src/lib/permissions.js';

test('only the Owner may transfer, to another member', () => {
  assert.deepEqual(checkTransferOwnership('Owner', 'Contributor', false), { ok: true });
  assert.deepEqual(checkTransferOwnership('Owner', 'Viewer', false), { ok: true });
  assert.deepEqual(checkTransferOwnership('Owner', 'Admin', false), { ok: true });
  for (const role of ['Admin', 'Contributor', 'Viewer', null, undefined, 'owner']) {
    assert.equal(checkTransferOwnership(role, 'Contributor', false).status, 403, String(role));
  }
});

test('not to yourself, not to a non-member, not to an unknown role', () => {
  assert.equal(checkTransferOwnership('Owner', 'Owner', true).status, 400);
  assert.equal(checkTransferOwnership('Owner', null, false).status, 404);
  assert.equal(checkTransferOwnership('Owner', 'Boss', false).status, 400);
});

test('the Owner role is never given through a role change or when adding, and the message says how', () => {
  for (const result of [checkRoleChange('Owner', 'Admin', 'Owner'), checkAddMember('Owner', 'Owner')]) {
    assert.equal(result.status, 400);
    assert.equal(result.message, OWNER_ROLE_MESSAGE);
  }
  assert.match(OWNER_ROLE_MESSAGE, /Transfer ownership/);
});
