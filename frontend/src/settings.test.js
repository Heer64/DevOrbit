// [Sprint 7 · M5] Settings page: change-password form rules and theme options (no rendering).
import { describe, expect, it } from 'vitest';
import { PASSWORD_FORM_MESSAGES as M, THEME_OPTIONS, changePasswordFormProblem, passwordStrength } from './settings';

describe('changePasswordFormProblem', () => {
  const ok = { current: 'old-password', next: 'new-password-1', confirm: 'new-password-1' };

  it('accepts a complete, valid form', () => {
    expect(changePasswordFormProblem(ok)).toBe('');
  });

  it('needs the current password first', () => {
    expect(changePasswordFormProblem({ ...ok, current: '' })).toBe(M.currentRequired);
    expect(changePasswordFormProblem()).toBe(M.currentRequired);
  });

  it('uses the sign-up length rules for the new password (same wording as the server)', () => {
    expect(changePasswordFormProblem({ ...ok, next: '', confirm: '' })).toBe('Enter a new password.');
    expect(changePasswordFormProblem({ ...ok, next: 'short', confirm: 'short' })).toBe('Password must be at least 8 characters.');
    const long = 'x'.repeat(129);
    expect(changePasswordFormProblem({ ...ok, next: long, confirm: long })).toBe('Password must be 128 characters or fewer.');
  });

  it('refuses a new password equal to the current one', () => {
    expect(changePasswordFormProblem({ current: 'same-password', next: 'same-password', confirm: 'same-password' })).toBe(M.sameAsCurrent);
  });

  it('needs the confirmation to match', () => {
    expect(changePasswordFormProblem({ ...ok, confirm: 'new-password-2' })).toBe(M.mismatch);
  });
});

describe('passwordStrength', () => {
  it('is empty for an empty box and "Too short" under 8 characters', () => {
    expect(passwordStrength('')).toEqual({ level: 0, label: '' });
    expect(passwordStrength('Ab1!')).toEqual({ level: 1, label: 'Too short' });
  });

  it('grows with length and variety', () => {
    expect(passwordStrength('abcdefgh').label).toBe('Fair');
    expect(passwordStrength('abcdefgh1234').label).toBe('Good');
    expect(passwordStrength('Abcdefgh1234!').label).toBe('Strong');
  });
});

describe('THEME_OPTIONS', () => {
  it('offers dark, light and system, in that order', () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual(['dark', 'light', 'system']);
  });
});
