/*
 * [Sprint 6 · M8] Platform roles and account suspension: the rules (US-57, US-58; FR-27, NFR-19, NFR-21).
 *
 * No database imports, so these rules are tested on their own (backend/test/platformRoleRules.test.js)
 * and the routes, the tests, the README and the frontend (frontend/src/platformRoles.js) use the same values.
 *
 * Platform roles are separate from project roles (Owner / Admin / Contributor / Viewer). Every account has one:
 *   user        a Registered User (the default; accounts created before Sprint 6 have no value and count as this)
 *   moderator   a Content Moderator: may use the moderator queue (US-56, built by M7)
 *   admin       a Platform Admin: may grant/revoke the moderator role and suspend/reactivate accounts.
 *               Like project roles, platform roles are cumulative: a Platform Admin also has moderator rights.
 *
 * Rules
 *   - Only a Platform Admin changes roles or suspends accounts; everyone else gets 403 (US-57 AC3).
 *   - The admin panel only switches between "user" and "moderator". Platform Admins are made by the seed script
 *     (npm run seed) or the PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD settings (FR-27), never by the API,
 *     so a Platform Admin's role cannot be changed there and a Platform Admin cannot be suspended.
 *   - The role and the suspension are read from the database on every request (middleware/auth.js), so a change
 *     applies to the user's next request (US-57 AC1, AC2). Nothing about them is stored in the token.
 *   - Suspending ends every session of the account at once and blocks login and refresh until it is reactivated
 *     (US-58 AC1). Reactivating lets the user log in again with their usual password (US-58 AC2).
 *
 * Words (NFR-27): "Platform Admin", "Content Moderator", "suspend", "reactivate".
 */

export const PLATFORM_ROLE_USER = 'user';
export const PLATFORM_ROLE_MODERATOR = 'moderator';
export const PLATFORM_ROLE_ADMIN = 'admin';
export const PLATFORM_ROLES = Object.freeze([PLATFORM_ROLE_USER, PLATFORM_ROLE_MODERATOR, PLATFORM_ROLE_ADMIN]);
// The only roles the admin panel can set (US-57). "admin" comes from the seed script or the environment.
export const ASSIGNABLE_PLATFORM_ROLES = Object.freeze([PLATFORM_ROLE_USER, PLATFORM_ROLE_MODERATOR]);

export const PLATFORM_ROLE_LABELS = Object.freeze({
  [PLATFORM_ROLE_USER]: 'Member',
  [PLATFORM_ROLE_MODERATOR]: 'Content Moderator',
  [PLATFORM_ROLE_ADMIN]: 'Platform Admin',
});

export const ADMIN_USERS_PAGE_SIZE = 20;
export const ADMIN_SEARCH_MAX = 80;
export const ADMIN_STATUS_FILTERS = Object.freeze(['all', 'active', 'suspended']);
export const ADMIN_ROLE_FILTERS = Object.freeze(['all', ...PLATFORM_ROLES]);

export const PLATFORM_MESSAGES = Object.freeze({
  adminOnly: 'Only a Platform Admin can do this.',
  moderatorOnly: 'Only a Content Moderator can do this.',
  invalidUserId: 'Invalid user ID.',
  userNotFound: 'That account does not exist.',
  roleRequired: 'Choose a role: "moderator" or "user".',
  adminRoleNotAssignable: 'Platform Admins are set up with the seed script or the PLATFORM_ADMIN_EMAIL setting, not here.',
  adminRoleLocked: "A Platform Admin's role can't be changed here.",
  cannotSuspendSelf: "You can't suspend your own account.",
  cannotSuspendAdmin: "A Platform Admin's account can't be suspended.",
  // Shown on the login page (403) and when a refresh or a request meets a suspended account.
  accountSuspended: 'This account is suspended. Contact a Platform Admin to have it reactivated.',
});

export function normalizePlatformRole(value) {
  return PLATFORM_ROLES.includes(value) ? value : PLATFORM_ROLE_USER;
}

export function platformRoleLabel(value) {
  return PLATFORM_ROLE_LABELS[normalizePlatformRole(value)];
}

export function isPlatformAdmin(role) {
  return normalizePlatformRole(role) === PLATFORM_ROLE_ADMIN;
}

// Content Moderator rights: moderators, and Platform Admins (cumulative roles).
export function canModerate(role) {
  const normalized = normalizePlatformRole(role);
  return normalized === PLATFORM_ROLE_MODERATOR || normalized === PLATFORM_ROLE_ADMIN;
}

export function isSuspended(account) {
  return Boolean(account?.suspendedAt);
}

/*
 * PATCH /api/admin/users/:userId/role body: { role: "moderator" | "user" }  (NFR-21: checked before anything is stored)
 *   -> { ok: true, role } | { ok: false, status: 400, message, field: 'role' }
 */
export function readRoleChange(body) {
  const role = body && typeof body === 'object' ? body.role : undefined;
  if (role === PLATFORM_ROLE_ADMIN) {
    return { ok: false, status: 400, message: PLATFORM_MESSAGES.adminRoleNotAssignable, field: 'role' };
  }
  if (typeof role !== 'string' || !ASSIGNABLE_PLATFORM_ROLES.includes(role)) {
    return { ok: false, status: 400, message: PLATFORM_MESSAGES.roleRequired, field: 'role' };
  }
  return { ok: true, role };
}

/*
 * May this Platform Admin set `nextRole` on `target`? (target = the stored account, or null)
 *   -> { ok: true, changed } | { ok: false, status, message, code }
 */
export function checkRoleChange(target, nextRole) {
  if (!target) return { ok: false, status: 404, message: PLATFORM_MESSAGES.userNotFound, code: 'not_found' };
  if (isPlatformAdmin(target.platformRole)) {
    return { ok: false, status: 409, message: PLATFORM_MESSAGES.adminRoleLocked, code: 'admin_locked' };
  }
  return { ok: true, changed: normalizePlatformRole(target.platformRole) !== nextRole };
}

/*
 * May this Platform Admin suspend (suspend = true) or reactivate (false) `target`?
 *   -> { ok: true, changed } | { ok: false, status, message, code }
 * Reactivating is always allowed (it can only give access back).
 */
export function checkSuspension(actorId, target, suspend) {
  if (!target) return { ok: false, status: 404, message: PLATFORM_MESSAGES.userNotFound, code: 'not_found' };
  if (suspend) {
    if (String(target._id) === String(actorId)) {
      return { ok: false, status: 400, message: PLATFORM_MESSAGES.cannotSuspendSelf, code: 'self' };
    }
    if (isPlatformAdmin(target.platformRole)) {
      return { ok: false, status: 409, message: PLATFORM_MESSAGES.cannotSuspendAdmin, code: 'admin_locked' };
    }
  }
  return { ok: true, changed: isSuspended(target) !== Boolean(suspend) };
}

export function roleChangeMessage(name, role, changed) {
  const who = name || 'This user';
  if (role === PLATFORM_ROLE_MODERATOR) {
    return changed ? `${who} is now a Content Moderator.` : `${who} is already a Content Moderator.`;
  }
  return changed ? `${who} is no longer a Content Moderator.` : `${who} is not a Content Moderator.`;
}

export function suspensionMessage(name, suspend, changed) {
  const who = name || 'This account';
  if (suspend) {
    return changed ? `${who} is suspended and has been logged out everywhere.` : `${who} is already suspended.`;
  }
  return changed ? `${who} is reactivated and can log in again.` : `${who} is already active.`;
}

// Text matching any of name, username or e-mail. Regex characters are escaped, so input is matched literally.
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/*
 * GET /api/admin/users query: { q?, status?, role?, page? }
 *   q       text in name, username or e-mail (trimmed, up to 80 characters, case-insensitive)
 *   status  all (default) | active | suspended
 *   role    all (default) | user | moderator | admin
 *   page    1-based page number (default 1), 20 accounts per page
 *   -> { ok: true, q, status, role, page, pageSize } | { ok: false, status: 400, message, field }
 */
export function readUserListQuery(query = {}) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q.length > ADMIN_SEARCH_MAX) {
    return { ok: false, status: 400, message: `Search text must be ${ADMIN_SEARCH_MAX} characters or fewer.`, field: 'q' };
  }
  const status = query.status === undefined || query.status === '' ? 'all' : query.status;
  if (!ADMIN_STATUS_FILTERS.includes(status)) {
    return { ok: false, status: 400, message: 'Status must be all, active or suspended.', field: 'status' };
  }
  const role = query.role === undefined || query.role === '' ? 'all' : query.role;
  if (!ADMIN_ROLE_FILTERS.includes(role)) {
    return { ok: false, status: 400, message: 'Role must be all, user, moderator or admin.', field: 'role' };
  }
  const rawPage = query.page === undefined || query.page === '' ? '1' : String(query.page);
  if (!/^\d{1,6}$/.test(rawPage) || Number(rawPage) < 1) {
    return { ok: false, status: 400, message: 'Page must be a whole number of 1 or more.', field: 'page' };
  }
  return { ok: true, q, status, role, page: Number(rawPage), pageSize: ADMIN_USERS_PAGE_SIZE };
}

// MongoDB filter for readUserListQuery's result. Accounts without a stored role count as "user".
export function userListFilter({ q = '', status = 'all', role = 'all' } = {}) {
  const filter = {};
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: pattern }, { username: pattern }, { email: pattern }];
  }
  if (status === 'active') filter.suspendedAt = null;
  if (status === 'suspended') filter.suspendedAt = { $ne: null };
  if (role === PLATFORM_ROLE_USER) filter.platformRole = { $nin: [PLATFORM_ROLE_MODERATOR, PLATFORM_ROLE_ADMIN] };
  else if (role !== 'all') filter.platformRole = role;
  return filter;
}

/*
 * One row of the admin panel. Only what a Platform Admin needs to recognise the account and act on it:
 * never the password hash, sessions, login counters or anything from the user's projects.
 */
export function adminUserView(user, actorId = null) {
  const role = normalizePlatformRole(user.platformRole);
  return {
    id: String(user._id),
    name: user.name || '',
    username: user.username || '',
    email: user.email || '',
    avatarUrl: user.avatarUrl || '',
    platformRole: role,
    roleLabel: PLATFORM_ROLE_LABELS[role],
    suspended: isSuspended(user),
    suspendedAt: user.suspendedAt ? new Date(user.suspendedAt).toISOString() : null,
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
    isMe: actorId !== null && String(user._id) === String(actorId),
  };
}

/*
 * First Platform Admin from the environment (FR-27: "a seed script or environment configuration").
 *   PLATFORM_ADMIN_EMAIL     the account's e-mail
 *   PLATFORM_ADMIN_PASSWORD  8 to 128 characters (same rule as sign up). Needed even when the account exists:
 *                            an existing account is only promoted when this is its real password, so a stranger who
 *                            registered that e-mail first can never become Platform Admin.
 *   PLATFORM_ADMIN_NAME      optional display name for a new account (default "Platform Admin")
 * -> { configured: false } | { configured: true, ok: false, problem } | { configured: true, ok: true, email, password, name }
 * The problem text names the settings only, never their values.
 */
export function readAdminBootstrap(env = {}) {
  const email = String(env.PLATFORM_ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  const password = String(env.PLATFORM_ADMIN_PASSWORD || '');
  const name =
    String(env.PLATFORM_ADMIN_NAME || '')
      .trim()
      .slice(0, 80) || 'Platform Admin';
  if (!email && !password) return { configured: false };
  if (!email || !password) {
    return { configured: true, ok: false, problem: 'Set both PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD, or neither.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { configured: true, ok: false, problem: 'PLATFORM_ADMIN_EMAIL is not a valid e-mail address.' };
  }
  if (password.length < 8 || password.length > 128) {
    return { configured: true, ok: false, problem: 'PLATFORM_ADMIN_PASSWORD must be 8 to 128 characters.' };
  }
  return { configured: true, ok: true, email, password, name };
}
