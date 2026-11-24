import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import GithubConnection from '../models/GithubConnection.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';
import { canManageGithubConnection } from '../lib/permissions.js';
import { decryptToken } from '../lib/githubCrypto.js';
import { isDisconnected } from '../lib/githubConnection.js';
import { GithubApiError, repositoryView } from '../lib/githubRepos.js';
import { webhookConfig } from '../lib/githubWebhooks.js';
import { checkMissedEvents } from '../lib/githubMissedEvents.js';
import { missedEventsTarget, recheckMessage } from '../lib/githubMissedEventsRules.js';
import { markNeedsReauthorization } from './github.js';

/*
 * [Sprint 7 · M8] Missed GitHub events, for one project, on demand.
 *
 * POST /api/projects/:id/github/webhook/recheck      (mounted as githubMissedEventsRoutes, see app.js)
 *   Owner and Admin ("Check for missed events" under the webhook status in the GitHub panel).
 *   Reads the webhook's delivery log on GitHub (last 24 hours) and asks GitHub to send again every
 *   push / issue / pull request delivery that never reached DevOrbit (lib/githubMissedEvents.js).
 *   -> 200 { checked, redelivered, message }
 *   401 not signed in · 400 bad ID · 404 no project · 403 not a member, or Contributor/Viewer (owner_or_admin_only)
 *   409 github_not_authorized / github_disconnected / github_no_repository / webhook_not_active / github_reauthorize
 *   503 webhook_not_configured (server settings) / github_rate_limited
 *   502 github_not_admin (the account cannot read the hook's deliveries) / github_unavailable
 *   429 more than 5 checks a minute by the same person for the same project
 * The 15-minute automatic check (server.js) does the same for every project.
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ message, code, ...extra });
}

const recheckLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  // Per person and project (signed-in route), so one busy Owner never blocks another project.
  keyGenerator: (req) => `github-recheck:${req.user?.id || 'anonymous'}:${String(req.params.id || '').slice(0, 24)}`,
  message: { message: 'You checked for missed events several times in a row. Please wait a minute.', code: 'too_many_checks' },
});

router.post('/recheck', recheckLimiter, async (req, res, next) => {
  try {
    const access = await loadProjectForMember(req, res);
    if (!access) return undefined;
    if (!canManageGithubConnection(access.role)) {
      return fail(res, 403, 'owner_or_admin_only', 'Only the project Owner and Admins can check for missed GitHub events.');
    }
    res.set('Cache-Control', 'no-store');

    const connection = await GithubConnection.findOne({ project: access.project._id }).select('+encryptedToken').lean();
    if (!connection) return fail(res, 409, 'github_not_authorized', 'GitHub is not connected to this project.');
    if (isDisconnected(connection)) return fail(res, 409, 'github_disconnected', 'GitHub is disconnected from this project.');
    if (!repositoryView(connection)) return fail(res, 409, 'github_no_repository', 'Choose a repository first.');
    if (!webhookConfig().configured) {
      return fail(res, 503, 'webhook_not_configured', 'GitHub webhooks are not set up on this server (GITHUB_WEBHOOK_SECRET / GITHUB_WEBHOOK_URL).');
    }
    if (connection.needsReauthorization) {
      return fail(res, 409, 'github_reauthorize', 'GitHub no longer accepts this project\'s authorization. Re-authorize GitHub first.');
    }
    if (!missedEventsTarget(connection)) {
      return fail(res, 409, 'webhook_not_active', 'The webhook is not active, so there are no deliveries to check. Choose the repository again to set it up.');
    }

    let accessToken = null;
    try {
      accessToken = decryptToken(connection.encryptedToken);
    } catch {
      accessToken = null;
    }
    if (!accessToken) {
      await markNeedsReauthorization(connection, 'token_unreadable');
      return fail(res, 409, 'github_reauthorize', 'The stored GitHub authorization can no longer be read on this server. Re-authorize GitHub.');
    }

    try {
      const result = await checkMissedEvents({ connection, accessToken });
      return res.json({ checked: result.checked, redelivered: result.redelivered, message: recheckMessage(result) });
    } catch (error) {
      if (!(error instanceof GithubApiError)) throw error;
      if (error.kind === 'unauthorized') {
        await markNeedsReauthorization(connection, 'token_rejected');
        return fail(res, 409, 'github_reauthorize', 'GitHub no longer accepts this project\'s authorization. Re-authorize GitHub.');
      }
      if (error.kind === 'rate_limited') {
        if (error.retryAfter !== null) res.set('Retry-After', String(error.retryAfter));
        return fail(res, 503, 'github_rate_limited', 'GitHub\'s rate limit has been reached. Please try again in a few minutes.', { retryAfter: error.retryAfter });
      }
      if (error.kind === 'not_admin' || error.kind === 'forbidden') {
        return fail(res, 502, 'github_not_admin', 'The authorized GitHub account cannot read this repository\'s webhook deliveries (it needs admin rights).');
      }
      return fail(res, 502, 'github_unavailable', 'Could not reach GitHub. Please try again.');
    }
  } catch (error) {
    return next(error);
  }
});

export default router;
