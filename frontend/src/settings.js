/*
 * [Sprint 7 · M5] Settings page: rules for the change-password form (checked in the browser before sending, with
 * the same wording as the server: backend/src/lib/passwordChangeRules.js) and the theme options.
 * No rendering here, so it is unit tested directly (settings.test.js).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_FORM_MESSAGES = {
  currentRequired: 'Enter your current password.',
  newRequired: 'Enter a new password.',
  tooShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  tooLong: `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`,
  sameAsCurrent: 'Choose a new password that is different from your current one.',
  mismatch: 'The new passwords do not match.',
  demo: 'Demo accounts have no password. Sign up for a real account to use this.',
  failed: 'Could not change your password. Please try again.',
};

// '' when the form can be sent, otherwise the message to show.
export function changePasswordFormProblem({ current = '', next = '', confirm = '' } = {}) {
  if (!current) return PASSWORD_FORM_MESSAGES.currentRequired;
  if (!next) return PASSWORD_FORM_MESSAGES.newRequired;
  if (next.length < PASSWORD_MIN_LENGTH) return PASSWORD_FORM_MESSAGES.tooShort;
  if (next.length > PASSWORD_MAX_LENGTH) return PASSWORD_FORM_MESSAGES.tooLong;
  if (next === current) return PASSWORD_FORM_MESSAGES.sameAsCurrent;
  if (next !== confirm) return PASSWORD_FORM_MESSAGES.mismatch;
  return '';
}

// A simple hint under the new-password box (not a rule: the server only enforces the length).
export function passwordStrength(value = '') {
  if (!value) return { level: 0, label: '' };
  let score = 0;
  if (value.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (value.length < PASSWORD_MIN_LENGTH) return { level: 1, label: 'Too short' };
  if (score <= 2) return { level: 2, label: 'Fair' };
  if (score <= 3) return { level: 3, label: 'Good' };
  return { level: 4, label: 'Strong' };
}

export const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark', hint: 'Warm dark glass (default)' },
  { value: 'light', label: 'Light', hint: 'Bright paper tones' },
  { value: 'system', label: 'System', hint: 'Follow this device' },
];
