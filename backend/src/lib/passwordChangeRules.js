/*
 * [Sprint 7 · M5] Change my password from the Settings page (logged in).
 *
 *   - The current (old) password is required and must be right.
 *   - The new password follows the same rules as sign-up and password reset (8 to 128 characters),
 *     and must be different from the current one.
 *   - On success every OTHER session of the account is ended. The browser that made the change stays signed in.
 *
 * Pure rules only: no database, no Express, so they are unit tested directly
 * (backend/test/passwordChangeRules.test.js). The route is routes/settings.js.
 */
import { passwordProblem } from './passwordResetRules.js';

// Longer than any password we accept (128). Anything longer is simply wrong, and bcrypt never sees it.
export const CURRENT_PASSWORD_MAX_LENGTH = 256;

export const PASSWORD_CHANGE_MESSAGES = {
  currentRequired: 'Enter your current password.',
  currentWrong: 'Your current password is not correct.',
  sameAsCurrent: 'Choose a new password that is different from your current one.',
  tooMany: 'Too many attempts. Please wait a few minutes and try again.',
};

/*
 * Checks the request body before any database work. Returns '' when it is fine to go on,
 * otherwise the message to show. The current password itself is checked against the stored hash later.
 */
export function changePasswordProblem(body) {
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) return PASSWORD_CHANGE_MESSAGES.currentRequired;
  const problem = passwordProblem(newPassword);
  if (problem) return problem;
  if (newPassword === currentPassword) return PASSWORD_CHANGE_MESSAGES.sameAsCurrent;
  return '';
}

// A current password that is too long can never be right, so it is rejected without running bcrypt.
export function currentPasswordWorthChecking(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= CURRENT_PASSWORD_MAX_LENGTH;
}

// The success text, which also says how many other sessions were signed out.
export function passwordChangedMessage(signedOut) {
  const count = Number.isInteger(signedOut) && signedOut > 0 ? signedOut : 0;
  if (count === 0) return 'Your password has been changed. You were not signed in anywhere else.';
  return `Your password has been changed. ${count} other session${count === 1 ? ' was' : 's were'} signed out.`;
}
