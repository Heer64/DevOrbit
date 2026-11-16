import { PLATFORM_MESSAGES, canModerate, isPlatformAdmin } from '../lib/platformRoleRules.js';

/*
 * [Sprint 6 · M8] Server-side guards for platform-wide routes (US-56, US-57, US-58; NFR-19).
 *
 * Use them after requireAuth, which reads the account's platform role from the database on every request
 * (req.user.platformRole). So granting or revoking a role applies to the user's next request, with no new login.
 *
 *   router.use(requireAuth, requirePlatformAdmin);   // routes/admin.js: every route in the router is guarded
 *   router.use(requireAuth, requireModerator);       // routes/moderation.js: Content Moderators and Platform Admins
 *
 * 401 without a valid session (requireAuth). 403 { message, code: 'forbidden' } for a signed-in user without the role.
 */

export function requirePlatformAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Authentication required.' });
  if (!isPlatformAdmin(req.user.platformRole)) {
    return res.status(403).json({ message: PLATFORM_MESSAGES.adminOnly, code: 'forbidden' });
  }
  return next();
}

// Content Moderators, and Platform Admins (platform roles are cumulative, like project roles).
export function requireModerator(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Authentication required.' });
  if (!canModerate(req.user.platformRole)) {
    return res.status(403).json({ message: PLATFORM_MESSAGES.moderatorOnly, code: 'forbidden' });
  }
  return next();
}
