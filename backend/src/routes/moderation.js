import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireModerator } from '../middleware/platformRoles.js';
import { PLATFORM_ROLE_LABELS } from '../lib/platformRoleRules.js';
import { moderatePost, moderationQueue, recentModerationActions } from '../lib/moderation.js'; // [Sprint 6 · M7] US-56
import { MODERATION_ACTIONS } from '../lib/moderationRules.js'; // [Sprint 6 · M7] US-56

/*
 * [Sprint 6 · M8] Content Moderator API, mounted at /api/moderation (see app.js). US-56, US-57; NFR-19.
 *
 * The guard is the first thing in this router, so EVERY route here needs a valid session (401) and the Content
 * Moderator role (Platform Admins have it too), read from the database on this request (403 for everyone else).
 * That is US-57: a user granted the role gets in on their next request; once it is revoked they are refused.
 * backend/test/adminRouteAudit.test.js checks this for every route in the file.
 *
 * GET /access   -> 200 { canModerate: true, platformRole, roleLabel }
 *               The app can ask "may I open the moderator queue?" (403 means no).
 *
 * For M7 (US-56 moderator queue): add the queue and the Remove / Warn / Dismiss routes to THIS router, e.g.
 *   router.get('/reports', ...)   router.post('/reports/:postId/remove', ...)
 * They get the 401/403 checks above automatically, and the audit test covers them without changes.
 * The open reports are ready in lib/postReports.js (openReportQueue, Sprint 6 M6).
 */

const router = Router();

router.use(requireAuth, requireModerator);

router.get('/access', (req, res) => {
  res.json({
    canModerate: true,
    platformRole: req.user.platformRole,
    roleLabel: PLATFORM_ROLE_LABELS[req.user.platformRole],
  });
});

/*
 * [Sprint 6 · M7] US-56 Moderate reported posts (FR-27, NFR-19, NFR-22). Same guard as above: 401 without a
 * session, 403 for anyone who is not a Content Moderator or Platform Admin (checked on every request).
 *
 * GET  /reports?limit=           -> { reports }  each reported post with open reports, the one waiting longest first:
 *                                   { post { _id, author, text, hasImage, imageUrl, edited, createdAt }, ownPost,
 *                                     reportCount, reasons [{ reason, label, count }], notes [{ reason, label, details,
 *                                     reportedAt }], firstReportedAt, lastReportedAt }   (never who reported it)
 * POST /reports/:postId/remove   -> deletes the post (image and votes too) and resolves its open reports
 * POST /reports/:postId/warn     -> in-app "Moderation warning" to the author (post kept) and resolves its open reports
 * POST /reports/:postId/dismiss  -> post unchanged, resolves its open reports
 *                                   200 { action, postId, resolution, resolvedReports, notified, message, moderationAction }
 *                                   400 bad ID   404 no open reports   409 another moderator handled it first
 * GET  /actions?limit=           -> { actions }  the moderation log, newest first (who decided what, report count,
 *                                   reasons, a short quote of the post). No secrets, no reporter identities.
 */
router.get('/reports', async (req, res, next) => {
  try {
    const reports = await moderationQueue({ limit: req.query.limit, viewerId: req.user.id });
    return res.json({ reports });
  } catch (error) {
    return next(error);
  }
});

for (const action of MODERATION_ACTIONS) {
  router.post(`/reports/:postId/${action}`, async (req, res, next) => {
    try {
      const outcome = await moderatePost({ postId: req.params.postId, action, moderatorId: req.user.id });
      return res.status(outcome.status).json(outcome.body);
    } catch (error) {
      return next(error);
    }
  });
}

router.get('/actions', async (req, res, next) => {
  try {
    const actions = await recentModerationActions({ limit: req.query.limit });
    return res.json({ actions });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M8] What this file does
 * The home of every moderator-only route. Its first line refuses anyone who is not a Content Moderator (or a
 * Platform Admin), checked against the database on each request, so a role granted or revoked by a Platform
 * Admin applies on the very next request.
 * ---------------------------------------------------------------------------
 */
