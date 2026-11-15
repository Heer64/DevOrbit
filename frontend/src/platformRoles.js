/*
 * [Sprint 6 · M8] Platform roles in the browser (US-57, US-58). Same values as backend/src/lib/platformRoleRules.js.
 *
 * The user object from login / refresh / me has `platformRole`: "user" | "moderator" | "admin".
 * These helpers only decide what to SHOW (the Admin panel link, M7's moderator queue link). The server checks the
 * role again on every admin and moderator request and answers 403 otherwise.
 */

export const PLATFORM_ROLE_USER = 'user';
export const PLATFORM_ROLE_MODERATOR = 'moderator';
export const PLATFORM_ROLE_ADMIN = 'admin';

export const PLATFORM_ROLE_LABELS = Object.freeze({
  user: 'Member',
  moderator: 'Content Moderator',
  admin: 'Platform Admin',
});

export const ADMIN_STATUS_OPTIONS = Object.freeze([
  { value: 'all', label: 'All accounts' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
]);

export const ADMIN_ROLE_OPTIONS = Object.freeze([
  { value: 'all', label: 'Every role' },
  { value: 'user', label: 'Members' },
  { value: 'moderator', label: 'Content Moderators' },
  { value: 'admin', label: 'Platform Admins' },
]);

export const ADMIN_SEARCH_MAX = 80;
export const ADMIN_ONLY_MESSAGE = 'Only a Platform Admin can open the Admin panel.';
export const ACCOUNT_SUSPENDED_MESSAGE = 'This account is suspended. Contact a Platform Admin to have it reactivated.';

export function platformRoleOf(user) {
  const role = user?.platformRole;
  return role === PLATFORM_ROLE_MODERATOR || role === PLATFORM_ROLE_ADMIN ? role : PLATFORM_ROLE_USER;
}

export function isPlatformAdmin(user) {
  return Boolean(user) && !user.isDemo && platformRoleOf(user) === PLATFORM_ROLE_ADMIN;
}

// Content Moderators and Platform Admins (roles are cumulative). For M7's "Moderator queue" link.
export function canModerate(user) {
  const role = platformRoleOf(user);
  return Boolean(user) && !user.isDemo && (role === PLATFORM_ROLE_MODERATOR || role === PLATFORM_ROLE_ADMIN);
}

export function platformRoleLabel(role) {
  return PLATFORM_ROLE_LABELS[role] || PLATFORM_ROLE_LABELS.user;
}

// The message to show for a failed admin request. The server's message when it sent one (it is always meant for
// people), otherwise a plain one by status.
export function adminErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const status = error?.status ?? error?.response?.status;
  const serverMessage = error?.response?.data?.message;
  if (serverMessage) return serverMessage;
  if (status === 403) return ADMIN_ONLY_MESSAGE;
  if (status === 401) return 'Your session has ended. Please log in again.';
  if (status === 404) return 'That account no longer exists.';
  if (!status) return 'Could not reach the DevOrbit API. Check your connection and try again.';
  return fallback;
}

// "15 Nov 2026" for the "Suspended since" and "Joined" columns.
export function adminDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Query for adminApi.users(): leaves out defaults, so the URL stays short (?q=riya&status=suspended).
export function adminListParams({ q = '', status = 'all', role = 'all', page = 1 } = {}) {
  const params = {};
  const text = String(q || '')
    .trim()
    .slice(0, ADMIN_SEARCH_MAX);
  if (text) params.q = text;
  if (status && status !== 'all') params.status = status;
  if (role && role !== 'all') params.role = role;
  if (Number(page) > 1) params.page = Number(page);
  return params;
}
