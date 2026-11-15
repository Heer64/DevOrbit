// [Sprint 6 · M8] Platform roles and suspension rules (US-57, US-58, FR-27, NFR-21). No database needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_USERS_PAGE_SIZE,
  ASSIGNABLE_PLATFORM_ROLES,
  PLATFORM_MESSAGES,
  PLATFORM_ROLES,
  adminUserView,
  canModerate,
  checkRoleChange,
  checkSuspension,
  escapeRegex,
  isPlatformAdmin,
  normalizePlatformRole,
  platformRoleLabel,
  readAdminBootstrap,
  readRoleChange,
  readUserListQuery,
  roleChangeMessage,
  suspensionMessage,
  userListFilter,
} from '../src/lib/platformRoleRules.js';

const ADMIN_ID = '64b000000000000000000001';
const account = (extra = {}) => ({
  _id: '64b0000000000000000000aa',
  name: 'Riya Kapoor',
  platformRole: 'user',
  suspendedAt: null,
  ...extra,
});

test('three platform roles; accounts without one (older accounts) count as a normal user', () => {
  assert.deepEqual(PLATFORM_ROLES, ['user', 'moderator', 'admin']);
  assert.deepEqual(ASSIGNABLE_PLATFORM_ROLES, ['user', 'moderator']);
  for (const value of [undefined, null, '', 'Admin', 'owner', 42]) assert.equal(normalizePlatformRole(value), 'user');
  assert.equal(normalizePlatformRole('moderator'), 'moderator');
  assert.equal(platformRoleLabel('admin'), 'Platform Admin');
  assert.equal(platformRoleLabel('moderator'), 'Content Moderator');
  assert.equal(platformRoleLabel(undefined), 'Member');
});

test('only Platform Admins are admins; moderators and admins can moderate (cumulative roles)', () => {
  assert.equal(isPlatformAdmin('admin'), true);
  assert.equal(isPlatformAdmin('moderator'), false);
  assert.equal(isPlatformAdmin(undefined), false);
  assert.equal(canModerate('moderator'), true);
  assert.equal(canModerate('admin'), true);
  assert.equal(canModerate('user'), false);
  assert.equal(canModerate(undefined), false);
});

test('a role change must be "moderator" or "user"; "admin" is never given through the API', () => {
  assert.deepEqual(readRoleChange({ role: 'moderator' }), { ok: true, role: 'moderator' });
  assert.deepEqual(readRoleChange({ role: 'user' }), { ok: true, role: 'user' });
  const admin = readRoleChange({ role: 'admin' });
  assert.equal(admin.ok, false);
  assert.equal(admin.message, PLATFORM_MESSAGES.adminRoleNotAssignable);
  for (const body of [undefined, null, {}, { role: '' }, { role: 'Moderator' }, { role: ['moderator'] }, { role: true }, 'moderator']) {
    const result = readRoleChange(body);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.status, 400);
    assert.equal(result.field, 'role');
  }
});

test("a Platform Admin's role cannot be changed; unknown accounts are 404", () => {
  assert.deepEqual(checkRoleChange(account(), 'moderator'), { ok: true, changed: true });
  assert.deepEqual(checkRoleChange(account({ platformRole: 'moderator' }), 'moderator'), { ok: true, changed: false });
  assert.deepEqual(checkRoleChange(account({ platformRole: undefined }), 'user'), { ok: true, changed: false });
  assert.deepEqual(checkRoleChange(account({ platformRole: 'moderator' }), 'user'), { ok: true, changed: true });
  const locked = checkRoleChange(account({ platformRole: 'admin' }), 'user');
  assert.equal(locked.ok, false);
  assert.equal(locked.status, 409);
  assert.equal(locked.code, 'admin_locked');
  assert.equal(checkRoleChange(null, 'moderator').status, 404);
});

test('suspending: never yourself, never a Platform Admin; reactivating is always allowed', () => {
  assert.deepEqual(checkSuspension(ADMIN_ID, account(), true), { ok: true, changed: true });
  assert.deepEqual(checkSuspension(ADMIN_ID, account({ suspendedAt: new Date() }), true), { ok: true, changed: false });
  assert.deepEqual(checkSuspension(ADMIN_ID, account({ suspendedAt: new Date() }), false), { ok: true, changed: true });
  assert.deepEqual(checkSuspension(ADMIN_ID, account(), false), { ok: true, changed: false });

  const self = checkSuspension(ADMIN_ID, account({ _id: ADMIN_ID, platformRole: 'admin' }), true);
  assert.equal(self.status, 400);
  assert.equal(self.message, PLATFORM_MESSAGES.cannotSuspendSelf);
  const otherAdmin = checkSuspension(ADMIN_ID, account({ platformRole: 'admin' }), true);
  assert.equal(otherAdmin.status, 409);
  assert.equal(otherAdmin.message, PLATFORM_MESSAGES.cannotSuspendAdmin);
  assert.equal(checkSuspension(ADMIN_ID, null, false).status, 404);
  // A moderator can be suspended like anyone else.
  assert.equal(checkSuspension(ADMIN_ID, account({ platformRole: 'moderator' }), true).ok, true);
});

test('success messages say what happened, and when nothing changed', () => {
  assert.equal(roleChangeMessage('Riya', 'moderator', true), 'Riya is now a Content Moderator.');
  assert.equal(roleChangeMessage('Riya', 'moderator', false), 'Riya is already a Content Moderator.');
  assert.equal(roleChangeMessage('Riya', 'user', true), 'Riya is no longer a Content Moderator.');
  assert.equal(suspensionMessage('Jai', true, true), 'Jai is suspended and has been logged out everywhere.');
  assert.equal(suspensionMessage('Jai', false, true), 'Jai is reactivated and can log in again.');
  assert.equal(suspensionMessage('Jai', true, false), 'Jai is already suspended.');
});

test('list filters are checked (NFR-21) and default to everyone, page 1', () => {
  assert.deepEqual(readUserListQuery({}), { ok: true, q: '', status: 'all', role: 'all', page: 1, pageSize: ADMIN_USERS_PAGE_SIZE });
  assert.deepEqual(readUserListQuery({ q: '  riya ', status: 'suspended', role: 'moderator', page: '3' }), {
    ok: true,
    q: 'riya',
    status: 'suspended',
    role: 'moderator',
    page: 3,
    pageSize: 20,
  });
  assert.equal(readUserListQuery({ q: 'x'.repeat(80) }).ok, true);
  assert.equal(readUserListQuery({ q: 'x'.repeat(81) }).field, 'q');
  assert.equal(readUserListQuery({ status: 'banned' }).field, 'status');
  assert.equal(readUserListQuery({ role: 'owner' }).field, 'role');
  for (const page of ['0', '-1', '1.5', 'two', '9999999']) assert.equal(readUserListQuery({ page }).field, 'page', page);
  // Express turns ?q[$ne]=x into an object: it is ignored, not used as a query operator.
  assert.equal(readUserListQuery({ q: { $ne: 'x' } }).q, '');
});

test('the list filter searches literally and treats a missing role as "user"', () => {
  assert.deepEqual(userListFilter({}), {});
  const search = userListFilter({ q: 'a.b(c' });
  assert.equal(search.$or.length, 3);
  assert.ok(search.$or[0].name.test('xA.B(Cx'));
  assert.equal(search.$or[0].name.test('aXb(c'), false, 'the dot is not a wildcard');
  assert.equal(escapeRegex('a+b*'), 'a\\+b\\*');
  assert.deepEqual(userListFilter({ status: 'active' }), { suspendedAt: null });
  assert.deepEqual(userListFilter({ status: 'suspended' }), { suspendedAt: { $ne: null } });
  assert.deepEqual(userListFilter({ role: 'user' }), { platformRole: { $nin: ['moderator', 'admin'] } });
  assert.deepEqual(userListFilter({ role: 'admin' }), { platformRole: 'admin' });
});

test('an admin panel row has only what an admin needs: no password, sessions or login counters', () => {
  const row = adminUserView(
    {
      _id: 'u1',
      name: 'Riya',
      username: 'riya',
      email: 'riya@example.com',
      passwordHash: 'secret-hash',
      loginFailedAttempts: 3,
      platformRole: undefined,
      suspendedAt: new Date('2026-11-15T10:00:00Z'),
      createdAt: new Date('2026-10-01T00:00:00Z'),
    },
    'u1'
  );
  assert.deepEqual(row, {
    id: 'u1',
    name: 'Riya',
    username: 'riya',
    email: 'riya@example.com',
    avatarUrl: '',
    platformRole: 'user',
    roleLabel: 'Member',
    suspended: true,
    suspendedAt: '2026-11-15T10:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    isMe: true,
  });
});

test('first admin from the environment: both settings or neither, valid e-mail, sign-up password rule (FR-27)', () => {
  assert.deepEqual(readAdminBootstrap({}), { configured: false });
  assert.deepEqual(readAdminBootstrap({ PLATFORM_ADMIN_EMAIL: '', PLATFORM_ADMIN_PASSWORD: '' }), { configured: false });
  assert.deepEqual(readAdminBootstrap({ PLATFORM_ADMIN_EMAIL: ' Boss@Example.com ', PLATFORM_ADMIN_PASSWORD: 'long enough' }), {
    configured: true,
    ok: true,
    email: 'boss@example.com',
    password: 'long enough',
    name: 'Platform Admin',
  });
  assert.equal(
    readAdminBootstrap({ PLATFORM_ADMIN_EMAIL: 'a@b.co', PLATFORM_ADMIN_PASSWORD: 'long enough', PLATFORM_ADMIN_NAME: ' Asha ' }).name,
    'Asha'
  );

  const onlyEmail = readAdminBootstrap({ PLATFORM_ADMIN_EMAIL: 'a@b.co' });
  assert.equal(onlyEmail.ok, false);
  const badEmail = readAdminBootstrap({ PLATFORM_ADMIN_EMAIL: 'not-an-email', PLATFORM_ADMIN_PASSWORD: 'long enough' });
  assert.equal(badEmail.ok, false);
  const shortPassword = readAdminBootstrap({ PLATFORM_ADMIN_EMAIL: 'a@b.co', PLATFORM_ADMIN_PASSWORD: 'short' });
  assert.equal(shortPassword.ok, false);
  // The problem text names the setting, never its value.
  for (const result of [onlyEmail, badEmail, shortPassword]) {
    assert.match(result.problem, /PLATFORM_ADMIN_/);
    assert.doesNotMatch(result.problem, /not-an-email|short|a@b\.co/);
  }
});
