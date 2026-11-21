// [Sprint 7 · M5] Change password from Settings: the pure rules (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_PASSWORD_MAX_LENGTH,
  PASSWORD_CHANGE_MESSAGES,
  changePasswordProblem,
  currentPasswordWorthChecking,
  passwordChangedMessage,
} from '../src/lib/passwordChangeRules.js';

test('a well-formed request has no problem', () => {
  assert.equal(changePasswordProblem({ currentPassword: 'old-password-1', newPassword: 'new-password-2' }), '');
});

test('the current (old) password is required', () => {
  assert.equal(changePasswordProblem({ newPassword: 'new-password-2' }), PASSWORD_CHANGE_MESSAGES.currentRequired);
  assert.equal(changePasswordProblem({ currentPassword: '', newPassword: 'new-password-2' }), PASSWORD_CHANGE_MESSAGES.currentRequired);
  assert.equal(changePasswordProblem({ currentPassword: 12345678, newPassword: 'new-password-2' }), PASSWORD_CHANGE_MESSAGES.currentRequired);
  assert.equal(changePasswordProblem(undefined), PASSWORD_CHANGE_MESSAGES.currentRequired);
});

test('the new password follows the sign-up rules (8 to 128 characters)', () => {
  assert.equal(changePasswordProblem({ currentPassword: 'old-password-1' }), 'Enter a new password.');
  assert.equal(changePasswordProblem({ currentPassword: 'old-password-1', newPassword: 'short' }), 'Password must be at least 8 characters.');
  assert.equal(changePasswordProblem({ currentPassword: 'old-password-1', newPassword: 'x'.repeat(129) }), 'Password must be 128 characters or fewer.');
  assert.equal(changePasswordProblem({ currentPassword: 'old-password-1', newPassword: 'x'.repeat(128) }), '');
  assert.equal(changePasswordProblem({ currentPassword: 'old-password-1', newPassword: 'x'.repeat(8) }), '');
});

test('the new password must differ from the current one', () => {
  assert.equal(changePasswordProblem({ currentPassword: 'same-password', newPassword: 'same-password' }), PASSWORD_CHANGE_MESSAGES.sameAsCurrent);
  // Case matters for passwords, so a different case is a different password.
  assert.equal(changePasswordProblem({ currentPassword: 'same-password', newPassword: 'SAME-password' }), '');
});

test('an over-long current password is never sent to bcrypt', () => {
  assert.equal(currentPasswordWorthChecking('a'.repeat(CURRENT_PASSWORD_MAX_LENGTH)), true);
  assert.equal(currentPasswordWorthChecking('a'.repeat(CURRENT_PASSWORD_MAX_LENGTH + 1)), false);
  assert.equal(currentPasswordWorthChecking(''), false);
  assert.equal(currentPasswordWorthChecking(null), false);
});

test('the success message says how many other sessions were signed out', () => {
  assert.equal(passwordChangedMessage(0), 'Your password has been changed. You were not signed in anywhere else.');
  assert.equal(passwordChangedMessage(1), 'Your password has been changed. 1 other session was signed out.');
  assert.equal(passwordChangedMessage(3), 'Your password has been changed. 3 other sessions were signed out.');
  assert.equal(passwordChangedMessage(undefined), 'Your password has been changed. You were not signed in anywhere else.');
});
