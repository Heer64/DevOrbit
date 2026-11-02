import { Router } from 'express';
import mongoose from 'mongoose';

import Project from '../models/Project.js';
import GithubConnection from '../models/GithubConnection.js';
import GithubOAuthState from '../models/GithubOAuthState.js';
import GithubOAuthCancelledState from '../models/GithubOAuthCancelledState.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, memberRole } from '../lib/projectAccess.js';
import { canEditProject, canManageGithubConnection } from '../lib/permissions.js';
import { decryptToken, encryptToken } from '../lib/githubCrypto.js';
import { GithubApiError } from '../lib/githubRepos.js'; // [Sprint 4 · M2] US-32
import { logActivity, quote } from '../lib/activity.js';
// [Sprint 4 · M3] US-33: status (extends M2's repositoryStatus), Owner/Admin re-authorize, checks, revoke.
import {
  authorizePurpose,
  checkRepositoryAccess,
  connectionStatus,
  isDisconnected,
  mayCompleteAuthorization,
  revokeGithubToken,
  verifyConnection,
} from '../lib/githubConnection.js';
import {
  STATE_TTL_MS,
  authorizeUrl,
  exchangeCode,
  fetchGithubUser,
  githubConfig,
  hashState,
  looksLikeState,
  newState,
  sameState,
} from '../lib/githubOAuth.js';

/*
 * [Sprint 4 · M1] US-31 Authorize GitHub (FR-11, NFR-4).
 *
 * Project routes, mounted at /api/projects/:id/github (see app.js):
 *   GET  /            Owner, Admin   -> { configured, canAuthorize, connection }
 *                     connection is null or { githubLogin, scopes, authorizedAt, authorizedBy { _id, name, username } }.
 *                     [Sprint 4 · M2] US-32 adds { repository, connectionState, active, canSelectRepository };
 *                     see lib/githubRepos.js and routes/githubRepository.js.
 *                     The access token is never part of any response.
 *   POST /authorize   Owner only     -> { url }  (503 when GitHub is not configured on the server)
 *                     Creates a single-use state (10 minutes), sets it in an httpOnly cookie that is only
 *                     sent back to the callback path, and returns the GitHub authorize URL. The browser then
 *                     navigates there (window.location), because a navigation cannot carry the Bearer token.
 *
 * Callback route, mounted at /api/github (see app.js):
 *   GET  /callback    GitHub redirects here after the Owner approves or denies.
 *     1. The ?state must match a stored, unexpired, unused state AND the cookie from step POST /authorize.
 *        The state is deleted on first use, so a replayed callback fails.
 *     2. ?error=access_denied (or any other failure) -> nothing is stored; redirect with github=denied|error.
 *     3. The user who started it must still be the project's Owner.
 *     4. The code is exchanged for a token server-side, the token is encrypted (AES-256-GCM) and saved
 *        in GithubConnection. Then redirect to the project page with github=connected.
 *   The redirect target is built only from CLIENT_ORIGIN and the project ID stored with the state,
 *   never from query parameters, so the callback cannot be used as an open redirect.
 *
 * [Sprint 4 · M3] US-33 Manage the GitHub connection (FR-35). Owner and Admin:
 *   GET  /            also reports canReauthorize, canDisconnect, canVerify, acceptingEvents,
 *                     disconnectedAt/By, needsReauthorization (+ reason), lastCheckedAt, repositoryAccess
 *                     and the states disconnected / needs_reauthorization / repository_unavailable /
 *                     unverified (lib/githubConnection.js).
 *   POST /authorize   unchanged for the first connection (Owner only). Once a record exists (connected
 *                     or disconnected) the Owner or an Admin may start it again: that is "Re-authorize".
 *                     The state remembers the purpose; the callback re-checks the role for it, clears
 *                     the disconnected / needs-re-authorization flags, checks the kept repository with
 *                     the new token, and redirects with github=reauthorized.
 *   POST /disconnect  body { confirm: true }. Soft disconnect: status 'disconnected', the token is
 *                     removed (and revoked on GitHub when the server can), pending OAuth attempts are
 *                     cancelled, the GitHub account and repository are kept for re-authorize. New GitHub
 *                     events are refused from then on (lib/githubEventGate.js); feed history is untouched.
 *   POST /verify      "Check connection": the token (GET /user) AND read access to the connected
 *                     repository. A good token alone never makes the connection Active.
 * New errors are { message, code }: confirmation_required, github_not_authorized, github_disconnected,
 * github_not_configured, github_changed, github_rate_limited, github_forbidden, github_unavailable.
 */

export const STATE_COOKIE = 'devorbit_github_state';
export const CALLBACK_PATH = '/api/github/callback';

// Same cookie style as the refresh cookie (routes/auth.js), but only ever sent to the callback path.
function stateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // sent on GitHub's top-level redirect back to us, not on cross-site sub-requests
    path: CALLBACK_PATH,
  };
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const part = header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  if (!part) return null;
  try {
    return decodeURIComponent(part.slice(name.length + 1));
  } catch {
    return null;
  }
}

function clientOrigin() {
  return (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
}

export function connectionView(connection) { // [Sprint 4 · M2] exported for routes/githubRepository.js
  if (!connection) return null;
  const by = connection.authorizedBy;
  return {
    githubLogin: connection.githubLogin,
    scopes: connection.scopes || [],
    authorizedAt: connection.authorizedAt,
    authorizedBy: by && by._id ? { _id: by._id, name: by.name, username: by.username } : null,
  };
}

// [Sprint 4 · M3] US-33: the full body of GET /api/projects/:id/github, shared with M2's
// PUT /repository so every answer carries the same fields. `connection` must be populated
// (authorizedBy, repository.connectedBy, disconnectedBy) and lean.
export function githubStatusBody({ connection, configured, role }) {
  return {
    configured,
    connection: connectionView(connection),
    // M1 canAuthorize · M2 { repository, connectionState, active, canSelectRepository } · M3 the rest
    ...connectionStatus({ connection, configured, role }),
  };
}

export function loadConnectionForStatus(projectId) {
  return GithubConnection.findOne({ project: projectId })
    .populate('authorizedBy', 'name username')
    .populate('repository.connectedBy', 'name username') // [Sprint 4 · M2] US-32
    .populate('disconnectedBy', 'name username') // [Sprint 4 · M3] US-33
    .lean();
}

/*
 * [Sprint 4 · M3] US-33: GitHub rejected the stored token (401) or it can no longer be decrypted.
 * Recorded so the panel shows "needs re-authorization" instead of Active. Only for the
 * authorization that failed: a re-authorize or disconnect in the meantime is left alone.
 * Used by POST /verify and by M2's repository routes. Never throws.
 */
export async function markNeedsReauthorization(connection, reason) {
  try {
    await GithubConnection.updateOne(
      { _id: connection._id, authorizedAt: connection.authorizedAt, status: { $ne: 'disconnected' } },
      { $set: { needsReauthorization: true, reauthorizationReason: reason } }
    );
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.error('Could not record that GitHub needs re-authorization:', error?.name || 'Error');
  }
}

function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ message, code, ...extra });
}

// ---------------------------------------------------------------------------------------------
// /api/projects/:id/github
// ---------------------------------------------------------------------------------------------
export const projectGithubRoutes = Router({ mergeParams: true });
projectGithubRoutes.use(requireAuth);

projectGithubRoutes.get('/', async (req, res, next) => {
  try {
    const access = await loadProjectForMember(req, res);
    if (!access) return undefined;
    if (!canEditProject(access.role)) {
      return res.status(403).json({ message: 'Only the project Owner and Admins can view integration settings.' });
    }
    const connection = await loadConnectionForStatus(access.project._id);
    // [Sprint 4 · M3] US-33 builds on M1 + M2 here: see githubStatusBody().
    return res.json(githubStatusBody({ connection, configured: githubConfig().configured, role: access.role }));
  } catch (error) {
    return next(error);
  }
});

projectGithubRoutes.post('/authorize', async (req, res, next) => {
  try {
    const access = await loadProjectForMember(req, res);
    if (!access) return undefined;
    // [Sprint 4 · M3] US-33: first connect is Owner only (M1); re-authorize is Owner or Admin.
    const existing = await GithubConnection.findOne({ project: access.project._id }).select('_id').lean();
    const purpose = authorizePurpose({ role: access.role, connection: existing });
    if (!purpose) {
      return res.status(403).json({
        message: existing
          ? 'Only the project Owner and Admins can re-authorize GitHub.'
          : 'Only the project Owner can connect GitHub.',
      });
    }
    const config = githubConfig();
    if (!config.configured) {
      return res.status(503).json({ message: 'GitHub is not configured on this server yet. Ask the team to set the GitHub OAuth settings in backend/.env.' });
    }

    const state = newState();
    await GithubOAuthState.create({
      stateHash: hashState(state),
      project: access.project._id,
      user: req.user.id,
      purpose, // [Sprint 4 · M3] US-33
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
    res.cookie(STATE_COOKIE, state, { ...stateCookieOptions(), maxAge: STATE_TTL_MS });
    res.set('Cache-Control', 'no-store');
    return res.json({ url: authorizeUrl(state, config) });
  } catch (error) {
    return next(error);
  }
});

// [Sprint 4 · M3] US-33: Owner or Admin of the project, or the response is sent and null returned.
async function loadManager(req, res) {
  const access = await loadProjectForMember(req, res);
  if (!access) return null;
  if (!canManageGithubConnection(access.role)) {
    fail(res, 403, 'owner_or_admin_only', 'Only the project Owner and Admins can manage the GitHub connection.');
    return null;
  }
  return access;
}

// ---------------------------------------------------------------------------------------------
// [Sprint 4 · M3] US-33  POST /api/projects/:id/github/disconnect   body { confirm: true }
// ---------------------------------------------------------------------------------------------
projectGithubRoutes.post('/disconnect', async (req, res, next) => {
  try {
    const access = await loadManager(req, res);
    if (!access) return undefined;
    if (req.body?.confirm !== true) {
      return fail(res, 400, 'confirmation_required', 'Confirm that you want to disconnect GitHub from this project.');
    }

    // One atomic step: only a connected record changes, and we get its token back to revoke it.
    const previous = await GithubConnection.findOneAndUpdate(
      { project: access.project._id, status: { $ne: 'disconnected' } },
      {
        $set: {
          status: 'disconnected',
          disconnectedAt: new Date(),
          disconnectedBy: req.user.id,
          needsReauthorization: false,
          reauthorizationReason: '',
          repositoryCheck: null,
          lastCheckedAt: null,
        },
        $unset: { encryptedToken: 1 },
      },
      { new: false }
    )
      .select('+encryptedToken')
      .lean();

    if (!previous) {
      const exists = await GithubConnection.exists({ project: access.project._id });
      return exists
        ? fail(res, 409, 'github_disconnected', 'GitHub is already disconnected from this project.')
        : fail(res, 409, 'github_not_authorized', 'GitHub is not connected to this project.');
    }

    // Cancel pending OAuth attempts, but retain a short-lived hash-to-project tombstone
    // so a late callback can return the browser to the project without being accepted.
    const pendingOAuthStates = await GithubOAuthState.find({ project: access.project._id })
      .select('stateHash project expiresAt')
      .lean();
    if (pendingOAuthStates.length) {
      await GithubOAuthCancelledState.insertMany(
        pendingOAuthStates.map(({ stateHash, project, expiresAt }) => ({ stateHash, project, expiresAt })),
        { ordered: false }
      );
    }
    await GithubOAuthState.deleteMany({ project: access.project._id });

    // Revoke the token on GitHub too (best effort; it is already gone from the database).
    let revokedOnGithub = false;
    const config = githubConfig();
    if (previous.encryptedToken && config.configured) {
      try {
        revokedOnGithub = await revokeGithubToken(decryptToken(previous.encryptedToken), config);
      } catch {
        revokedOnGithub = false; // unreadable token: nothing usable to revoke
      }
    }
    // OPEN DEPENDENCY ON M4 (US-34): if a repository webhook was registered, remove it on GitHub
    // here. The hook ID and its storage belong to the webhook pipeline. Until then the event gate
    // (lib/githubEventGate.js) drops every delivery for this project.

    // The project header stops showing the repository, unless someone typed a different reference.
    const repoName = previous.repository?.fullName || '';
    if (repoName) {
      await Project.updateOne({ _id: access.project._id, githubRepo: repoName }, { $set: { githubRepo: '' } });
    }

    // Recorded in the feed. Earlier entries, GitHub events included, are never removed.
    await logActivity({
      project: access.project._id,
      actor: req.user.id,
      type: 'project.updated',
      summary: repoName ? `disconnected GitHub (repository ${quote(repoName)})` : 'disconnected GitHub',
      targetLabel: access.project.name,
      meta: { github: 'disconnected', githubRepository: repoName || null, githubLogin: previous.githubLogin },
    });

    const connection = await loadConnectionForStatus(access.project._id);
    res.set('Cache-Control', 'no-store');
    return res.json({
      ...githubStatusBody({ connection, configured: config.configured, role: access.role }),
      revokedOnGithub,
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------------------------
// [Sprint 4 · M3] US-33  POST /api/projects/:id/github/verify   ("Check connection")
// The token AND read access to the connected repository; a good token alone is not "Active".
// ---------------------------------------------------------------------------------------------
projectGithubRoutes.post('/verify', async (req, res, next) => {
  try {
    const access = await loadManager(req, res);
    if (!access) return undefined;
    const config = githubConfig();
    if (!config.configured) {
      return fail(res, 503, 'github_not_configured', 'GitHub is not configured on this server yet. Ask the team to set the GitHub OAuth settings in backend/.env.');
    }
    const connection = await GithubConnection.findOne({ project: access.project._id }).select('+encryptedToken').lean();
    if (!connection) return fail(res, 409, 'github_not_authorized', 'GitHub is not connected to this project.');
    if (isDisconnected(connection)) return fail(res, 409, 'github_disconnected', 'GitHub is disconnected from this project. Re-authorize to connect it again.');

    const guard = { _id: connection._id, authorizedAt: connection.authorizedAt, status: { $ne: 'disconnected' } };
    const now = new Date();
    let check;
    let update;

    let accessToken = null;
    try {
      accessToken = decryptToken(connection.encryptedToken);
    } catch {
      accessToken = null; // wrong or rotated GITHUB_TOKEN_KEY, or a damaged record; never logged
    }

    if (!accessToken) {
      check = { token: 'unreadable', repository: 'not_checked' };
      update = { needsReauthorization: true, reauthorizationReason: 'token_unreadable', lastCheckedAt: now };
    } else {
      try {
        check = await verifyConnection({ accessToken, connection });
      } catch (error) {
        if (!(error instanceof GithubApiError)) throw error;
        if (process.env.NODE_ENV !== 'test') console.warn(`GitHub connection check failed: ${error.kind}${error.status ? ` (HTTP ${error.status})` : ''}`);
        // Nothing is changed: a busy or unreachable GitHub says nothing about the connection (NFR-11b).
        if (error.kind === 'rate_limited') {
          if (error.retryAfter !== null) res.set('Retry-After', String(error.retryAfter));
          return fail(res, 503, 'github_rate_limited', 'GitHub\'s rate limit has been reached. Please try again in a few minutes.', { retryAfter: error.retryAfter });
        }
        if (error.kind === 'forbidden') return fail(res, 502, 'github_forbidden', 'GitHub refused the check. An organization may need to approve DevOrbit.');
        return fail(res, 502, 'github_unavailable', 'Could not reach GitHub. Please try again.');
      }
      if (check.token === 'rejected') {
        update = { needsReauthorization: true, reauthorizationReason: 'token_rejected', lastCheckedAt: now };
      } else {
        update = { needsReauthorization: false, reauthorizationReason: '', lastCheckedAt: now };
        if (check.repository === 'accessible' || check.repository === 'not_accessible') {
          update.repositoryCheck = { githubId: connection.repository.githubId, authorizedAt: connection.authorizedAt, access: check.repository, checkedAt: now };
        }
      }
    }

    const saved = await GithubConnection.updateOne(guard, { $set: update }, { runValidators: true });
    if (!saved.matchedCount) {
      return fail(res, 409, 'github_changed', 'The GitHub connection changed while it was being checked. Reload and try again.');
    }

    const fresh = await loadConnectionForStatus(access.project._id);
    res.set('Cache-Control', 'no-store');
    return res.json({ ...githubStatusBody({ connection: fresh, configured: true, role: access.role }), check });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------------------------
// /api/github/callback
// ---------------------------------------------------------------------------------------------
export const githubCallbackRoutes = Router();

githubCallbackRoutes.get('/callback', async (req, res) => {
  // The URL carries a one-time code: keep it out of caches and Referer headers.
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.clearCookie(STATE_COOKIE, stateCookieOptions());

  const origin = clientOrigin();
  const finish = (projectId, result) => {
    const target = projectId
      ? `${origin}/project/${projectId}?github=${result}`
      : `${origin}/dashboard?github=${result}`;
    return res.redirect(303, target);
  };

  const queryState = typeof req.query.state === 'string' ? req.query.state : '';
  const cookieState = readCookie(req, STATE_COOKIE);

  let record = null;
  try {
    if (looksLikeState(queryState)) {
      // Deleting on read makes every state single-use.
      record = await GithubOAuthState.findOneAndDelete({ stateHash: hashState(queryState) }).lean();
    }
  } catch {
    return finish(null, 'error');
  }

  if (!record) {
    // Disconnect removes active states. A cancellation tombstone preserves only the
    // redirect context; it is never sufficient to authorize or reconnect GitHub.
    if (looksLikeState(queryState)) {
      const cancelled = await GithubOAuthCancelledState.findOneAndDelete({
        stateHash: hashState(queryState),
        expiresAt: { $gt: new Date() },
      }).lean();
      if (cancelled) return finish(cancelled.project, 'expired');
    }
    return finish(null, 'expired');
  }
  if (record.expiresAt <= new Date()) return finish(record.project, 'expired');
  const projectId = String(record.project);

  // The browser that comes back must be the one that started the flow.
  if (!sameState(queryState, cookieState)) return finish(projectId, 'invalid');

  // Owner pressed "Cancel" on GitHub (or GitHub refused): nothing is stored.
  if (req.query.error) return finish(projectId, req.query.error === 'access_denied' ? 'denied' : 'error');

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code || code.length > 200) return finish(projectId, 'error');

  try {
    // Ownership may have changed in the 10 minutes since the flow started.
    // [Sprint 4 · M3] US-33: Owner always; Admin only to re-authorize an existing record.
    const project = mongoose.isValidObjectId(projectId) ? await Project.findById(projectId).select('members name githubRepo').lean() : null;
    const previous = project ? await GithubConnection.findOne({ project: project._id }).lean() : null;
    const purpose = record.purpose || 'connect';
    const role = project ? memberRole(project, String(record.user)) : null;
    if (!project || !mayCompleteAuthorization({ role, purpose, connectionExists: Boolean(previous) })) {
      return finish(projectId, 'forbidden');
    }

    const config = githubConfig();
    if (!config.configured) return finish(projectId, 'error');

    const { accessToken, scopes } = await exchangeCode(code, config);
    const githubUser = await fetchGithubUser(accessToken);
    const authorizedAt = new Date();

    // [Sprint 4 · M3] US-33: a kept repository chosen under this same GitHub account is checked with
    // the new token before it can count as Active again (lib/githubConnection.js). Never stops the save.
    let repositoryCheck = null;
    const keptRepository = previous?.repository?.githubId && previous.repository.githubUserId === githubUser.id
      ? previous.repository
      : null;
    if (keptRepository) {
      let accessResult = 'unverified';
      try {
        accessResult = await checkRepositoryAccess(accessToken, keptRepository.githubId);
      } catch {
        accessResult = 'unverified'; // GitHub busy or unreachable: "Check connection" can confirm later
      }
      repositoryCheck = { githubId: keptRepository.githubId, authorizedAt, access: accessResult, checkedAt: new Date() };
    }

    await GithubConnection.findOneAndUpdate(
      { project: project._id },
      {
        project: project._id,
        authorizedBy: record.user,
        githubUserId: githubUser.id,
        githubLogin: githubUser.login,
        scopes,
        encryptedToken: encryptToken(accessToken),
        authorizedAt,
        // [Sprint 4 · M3] US-33: connected again, with nothing left over from a disconnect or expiry.
        status: 'connected',
        disconnectedAt: null,
        disconnectedBy: null,
        needsReauthorization: false,
        reauthorizationReason: '',
        lastCheckedAt: repositoryCheck ? repositoryCheck.checkedAt : null,
        repositoryCheck,
      },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    if (!previous) return finish(projectId, 'connected');

    // [Sprint 4 · M3] US-33: re-authorized. Restore the header's repository reference once the
    // repository is readable again, and record it in the feed.
    if (repositoryCheck?.access === 'accessible' && !project.githubRepo) {
      await Project.updateOne({ _id: project._id, githubRepo: '' }, { $set: { githubRepo: keptRepository.fullName } });
    }
    await logActivity({
      project: project._id,
      actor: record.user,
      type: 'project.updated',
      summary: isDisconnected(previous)
        ? `reconnected GitHub as @${githubUser.login}`
        : `re-authorized GitHub as @${githubUser.login}`,
      targetLabel: project.name || '',
      meta: { github: isDisconnected(previous) ? 'reconnected' : 'reauthorized', githubLogin: githubUser.login },
    });
    return finish(projectId, 'reauthorized');
  } catch (error) {
    // Log the reason only. Our errors never include the token, code or client secret.
    console.error('GitHub authorization failed:', error?.name === 'GithubOAuthError' ? error.message : (error?.name || 'Error'));
    return finish(projectId, 'error');
  }
});
