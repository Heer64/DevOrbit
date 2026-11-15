// [Sprint 6 · M8] Platform roles in the browser (US-57, US-58): what the app shows to whom, error texts, list query.
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY_MESSAGE,
  adminDate,
  adminErrorMessage,
  adminListParams,
  canModerate,
  isPlatformAdmin,
  platformRoleLabel,
  platformRoleOf,
} from './platformRoles';

const user = (platformRole, extra = {}) => ({ id: 'u1', name: 'Riya', platformRole, ...extra });

describe('platform roles', () => {
  it('a missing or unknown role is a normal member', () => {
    expect(platformRoleOf(null)).toBe('user');
    expect(platformRoleOf(user(undefined))).toBe('user');
    expect(platformRoleOf(user('Owner'))).toBe('user');
    expect(platformRoleOf(user('moderator'))).toBe('moderator');
    expect(platformRoleLabel('admin')).toBe('Platform Admin');
    expect(platformRoleLabel('moderator')).toBe('Content Moderator');
    expect(platformRoleLabel('nope')).toBe('Member');
  });

  it('only Platform Admins get the Admin panel; moderators and admins get moderator tools', () => {
    expect(isPlatformAdmin(user('admin'))).toBe(true);
    expect(isPlatformAdmin(user('moderator'))).toBe(false);
    expect(isPlatformAdmin(user('user'))).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(canModerate(user('moderator'))).toBe(true);
    expect(canModerate(user('admin'))).toBe(true);
    expect(canModerate(user('user'))).toBe(false);
  });

  it('the demo identity never gets admin or moderator tools', () => {
    expect(isPlatformAdmin(user('admin', { isDemo: true }))).toBe(false);
    expect(canModerate(user('moderator', { isDemo: true }))).toBe(false);
  });
});

describe('admin helpers', () => {
  it('shows the server message, or a plain one by status', () => {
    const apiError = (status, message) => Object.assign(new Error('x'), { status, response: { status, data: message ? { message } : {} } });
    expect(adminErrorMessage(apiError(409, "A Platform Admin's account can't be suspended."))).toBe(
      "A Platform Admin's account can't be suspended."
    );
    expect(adminErrorMessage(apiError(403))).toBe(ADMIN_ONLY_MESSAGE);
    expect(adminErrorMessage(apiError(404))).toBe('That account no longer exists.');
    expect(adminErrorMessage(apiError(500), 'Fallback.')).toBe('Fallback.');
    expect(adminErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Could not reach/);
  });

  it('builds a short list query: defaults are left out', () => {
    expect(adminListParams()).toEqual({});
    expect(adminListParams({ q: '  riya ', status: 'all', role: 'all', page: 1 })).toEqual({ q: 'riya' });
    expect(adminListParams({ q: '', status: 'suspended', role: 'moderator', page: 3 })).toEqual({
      status: 'suspended',
      role: 'moderator',
      page: 3,
    });
    expect(adminListParams({ q: 'x'.repeat(100) }).q).toHaveLength(80);
  });

  it('formats dates as day month year', () => {
    expect(adminDate('2026-11-15T10:00:00.000Z')).toBe('15 Nov 2026');
    expect(adminDate(null)).toBe('');
    expect(adminDate('not a date')).toBe('');
  });
});
