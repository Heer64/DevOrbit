import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireModerator } from '../middleware/platformRoles.js';
import { PLATFORM_ROLE_LABELS } from '../lib/platformRoleRules.js';

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

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M8] What this file does
 * The home of every moderator-only route. Its first line refuses anyone who is not a Content Moderator (or a
 * Platform Admin), checked against the database on each request, so a role granted or revoked by a Platform
 * Admin applies on the very next request.
 * ---------------------------------------------------------------------------
 */
