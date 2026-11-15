import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requirePlatformAdmin } from '../middleware/platformRoles.js';
import { validId } from '../lib/projectAccess.js';
import { PLATFORM_MESSAGES, readRoleChange, readUserListQuery } from '../lib/platformRoleRules.js';
import { changePlatformRole, listUsers, setSuspended } from '../lib/platformAdmin.js';

/*
 * [Sprint 6 · M8] Platform Admin API (US-57 assign/revoke moderators, US-58 suspend/reactivate; FR-27, NFR-19, NFR-21).
 * Mounted at /api/admin (see app.js).
 *
 * The guard is the first thing in this router, so EVERY route here, including any added later, needs a valid
 * session (401) and the Platform Admin role read from the database on this request (403 for everyone else,
 * Content Moderators included). backend/test/adminRouteAudit.test.js checks this for every route in the file.
 *
 * GET   /users?q=&status=&role=&page=
 *         q       text in name, username or e-mail (up to 80 characters)
 *         status  all | active | suspended          role  all | user | moderator | admin          page  1, 2, ...
 *   -> 200 { users, page, pageSize: 20, total, summary: { moderators, admins, suspended } }
 *   400 { message, field }   bad filter
 *
 * PATCH /users/:userId/role      JSON { role: "moderator" | "user" }      (US-57: grant / revoke Content Moderator)
 *   -> 200 { user, changed, message }   applies to the user's next request (no new login needed)
 *   400 { message, field: 'role' }      missing/unknown role, or "admin" (Platform Admins come from the seed or env)
 *   404 unknown account               409 { code: 'admin_locked' } the target is a Platform Admin
 *
 * POST  /users/:userId/suspend                                             (US-58: suspend)
 *   -> 200 { user, changed, sessionsEnded, message }   every session of the account is ended at once
 *   400 { code: 'self' } your own account     404 unknown account     409 { code: 'admin_locked' } a Platform Admin
 *
 * POST  /users/:userId/reactivate                                          (US-58: reactivate)
 *   -> 200 { user, changed, message }   the user can log in again with their usual password
 *   404 unknown account
 *
 * user: { id, name, username, email, avatarUrl, platformRole, roleLabel, suspended, suspendedAt, createdAt, isMe }
 * Calling grant/suspend/reactivate twice is safe: the second answer is 200 with changed: false.
 */

const router = Router();

router.use(requireAuth, requirePlatformAdmin);

function readUserId(req, res) {
  if (!validId(req.params.userId)) {
    res.status(400).json({ message: PLATFORM_MESSAGES.invalidUserId });
    return null;
  }
  return req.params.userId;
}

function sendResult(res, result) {
  if (!result.ok) return res.status(result.status).json({ message: result.message, code: result.code });
  const { ok: _ok, ...body } = result;
  return res.json(body);
}

router.get('/users', async (req, res, next) => {
  try {
    const query = readUserListQuery(req.query);
    if (!query.ok) return res.status(400).json({ message: query.message, field: query.field });
    return res.json(await listUsers(query, req.user.id));
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:userId/role', async (req, res, next) => {
  try {
    const userId = readUserId(req, res);
    if (!userId) return undefined;
    const input = readRoleChange(req.body);
    if (!input.ok) return res.status(400).json({ message: input.message, field: input.field });
    return sendResult(res, await changePlatformRole(req.user.id, userId, input.role));
  } catch (error) {
    return next(error);
  }
});

router.post('/users/:userId/suspend', async (req, res, next) => {
  try {
    const userId = readUserId(req, res);
    if (!userId) return undefined;
    return sendResult(res, await setSuspended(req.user.id, userId, true));
  } catch (error) {
    return next(error);
  }
});

router.post('/users/:userId/reactivate', async (req, res, next) => {
  try {
    const userId = readUserId(req, res);
    if (!userId) return undefined;
    return sendResult(res, await setSuspended(req.user.id, userId, false));
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M8] What this file does
 * REST API for the Platform Admin panel: list and search accounts, give or take away the Content Moderator
 * role, and suspend or reactivate accounts. Only a Platform Admin gets past the guard at the top; a change of
 * role or suspension takes effect on the affected user's next request.
 * ---------------------------------------------------------------------------
 */
