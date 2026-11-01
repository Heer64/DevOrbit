import { Router } from 'express';

import GithubConnection from '../models/GithubConnection.js';
import Project from '../models/Project.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';
import { logActivity, quote } from '../lib/activity.js';
import { decryptToken } from '../lib/githubCrypto.js';
import { githubConfig } from '../lib/githubOAuth.js';
import { connectionView } from './github.js';
import {
  GithubApiError,
  listUserRepositories,
  parseRepositoryId,
  repositoryStatus,
  storedRepository,
} from '../lib/githubRepos.js';

/*
 * [Sprint 4 · M2] US-32 Connect a repository (FR-11).
 * "Given I have authorized GitHub, when I pick a repository from my list, then the repository is
 *  connected and the project shows the connection as Active."
 *
 * Builds on M1's GitHub authorization (US-31: routes/github.js, models/GithubConnection.js).
 * Both calls are Owner only and need a stored authorization and the server GitHub settings.
 *
 * GET /api/projects/:id/github/repositories              (mounted as githubRepositoriesRoutes)
 *   The repositories the authorized GitHub account can use, most recently updated first (max 500).
 *   -> { githubLogin, repositories: [{ id, name, fullName, owner, private, htmlUrl, defaultBranch,
 *        description, archived, admin, updatedAt }], truncated, selectedId }
 *
 * PUT /api/projects/:id/github/repository                (mounted as githubRepositoryRoutes)
 *   Body { repositoryId }  (GitHub's numeric repository ID, from the list above)
 *   The ID is checked against the authorized account's list on the server, then stored on the
 *   project's GithubConnection (one repository per project; picking again replaces it). The
 *   project's githubRepo field is set to "owner/name" so the project header shows it.
 *   -> the same body as GET /api/projects/:id/github, now with connectionState 'active'.
 *
 * Errors (always { message, code }):
 *   401 not signed in · 400 bad project ID · 404 no project · 403 not the Owner (code: owner_only)
 *   503 github_not_configured   server GitHub settings missing
 *   409 github_not_authorized   nobody has authorized GitHub for this project yet (US-31)
 *   409 github_reauthorize      GitHub rejects the stored token, or it can no longer be decrypted (US-33)
 *   409 github_changed          the authorization changed while the Owner was choosing; reload
 *   400 invalid_repository      repositoryId is not a GitHub repository ID
 *   400 repository_not_available the authorized account cannot use that repository
 *   503 github_rate_limited     GitHub rate limit; Retry-After header and retryAfter (seconds) when known
 *   502 github_forbidden / github_unavailable   GitHub refused or could not be reached
 *
 * The access token is decrypted only for the call to GitHub; it is never returned or logged.
 */

function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ message, code, ...extra });
}

// Owner + server configured + stored authorization. Responds itself and returns null otherwise.
async function loadOwnerConnection(req, res) {
  const access = await loadProjectForMember(req, res);
  if (!access) return null;
  if (access.role !== 'Owner') {
    fail(res, 403, 'owner_only', 'Only the project Owner can choose the GitHub repository.');
    return null;
  }
  if (!githubConfig().configured) {
    fail(res, 503, 'github_not_configured', 'GitHub is not configured on this server yet. Ask the team to set the GitHub OAuth settings in backend/.env.');
    return null;
  }
  const connection = await GithubConnection.findOne({ project: access.project._id }).select('+encryptedToken').lean();
  if (!connection) {
    fail(res, 409, 'github_not_authorized', 'Connect GitHub first, then choose a repository.');
    return null;
  }
  let accessToken;
  try {
    accessToken = decryptToken(connection.encryptedToken);
  } catch {
    // Wrong or rotated GITHUB_TOKEN_KEY, or a damaged record. Never log the stored value.
    fail(res, 409, 'github_reauthorize', 'The stored GitHub authorization can no longer be used. Re-authorize GitHub, then choose a repository.');
    return null;
  }
  return { ...access, connection, accessToken };
}

function sendGithubError(res, error) {
  if (!(error instanceof GithubApiError)) throw error;
  // Only the kind and HTTP status: never the token or a response body.
  if (process.env.NODE_ENV !== 'test') console.warn(`GitHub repository request failed: ${error.kind}${error.status ? ` (HTTP ${error.status})` : ''}`);
  switch (error.kind) {
    case 'unauthorized':
      return fail(res, 409, 'github_reauthorize', 'GitHub no longer accepts this project\'s authorization (it may have been revoked or expired). Re-authorize GitHub, then choose a repository.');
    case 'rate_limited':
      if (error.retryAfter !== null) res.set('Retry-After', String(error.retryAfter));
      return fail(res, 503, 'github_rate_limited', 'GitHub\'s rate limit has been reached. Please try again in a few minutes.', { retryAfter: error.retryAfter });
    case 'forbidden':
      return fail(res, 502, 'github_forbidden', 'GitHub refused to list repositories for this account. An organization may need to approve DevOrbit.');
    default:
      return fail(res, 502, 'github_unavailable', 'Could not reach GitHub. Please try again.');
  }
}

// ---------------------------------------------------------------------------------------------
// GET /api/projects/:id/github/repositories
// ---------------------------------------------------------------------------------------------
export const githubRepositoriesRoutes = Router({ mergeParams: true });
githubRepositoriesRoutes.use(requireAuth);

githubRepositoriesRoutes.get('/', async (req, res, next) => {
  try {
    const loaded = await loadOwnerConnection(req, res);
    if (!loaded) return undefined;
    const { connection, accessToken } = loaded;

    let list;
    try {
      list = await listUserRepositories(accessToken);
    } catch (error) {
      return sendGithubError(res, error);
    }

    const selected = repositoryStatus({ connection, configured: true, role: 'Owner' }).repository;
    res.set('Cache-Control', 'no-store');
    return res.json({
      githubLogin: connection.githubLogin,
      repositories: list.repositories,
      truncated: list.truncated,
      selectedId: selected ? selected.id : null,
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------------------------
// PUT /api/projects/:id/github/repository
// ---------------------------------------------------------------------------------------------
export const githubRepositoryRoutes = Router({ mergeParams: true });
githubRepositoryRoutes.use(requireAuth);

githubRepositoryRoutes.put('/', async (req, res, next) => {
  try {
    const loaded = await loadOwnerConnection(req, res);
    if (!loaded) return undefined;
    const { project, role, connection, accessToken } = loaded;

    const repositoryId = parseRepositoryId(req.body?.repositoryId);
    if (repositoryId === null) {
      return fail(res, 400, 'invalid_repository', 'Choose a repository from your GitHub list.');
    }

    // The server decides what "my list" is: the ID must be one the authorized account can use now.
    let list;
    try {
      list = await listUserRepositories(accessToken);
    } catch (error) {
      return sendGithubError(res, error);
    }
    const repository = list.repositories.find((item) => item.id === repositoryId);
    if (!repository) {
      return fail(res, 400, 'repository_not_available', `That repository is not available to the GitHub account @${connection.githubLogin}. Choose one from the list.`);
    }

    const previous = repositoryStatus({ connection, configured: true, role }).repository;

    // Only if the authorization is still the one we listed with (a re-authorize in between would
    // otherwise attach a repository chosen under another GitHub account).
    const saved = await GithubConnection.findOneAndUpdate(
      { _id: connection._id, githubUserId: connection.githubUserId, authorizedAt: connection.authorizedAt },
      { $set: { repository: storedRepository(repository, { githubUserId: connection.githubUserId, connectedBy: req.user.id }) } },
      { new: true, runValidators: true }
    )
      .populate('authorizedBy', 'name username')
      .populate('repository.connectedBy', 'name username')
      .lean();
    if (!saved) {
      return fail(res, 409, 'github_changed', 'The GitHub authorization changed while you were choosing. Reload and try again.');
    }

    // Keep the project's repository reference (shown in the project header) in step.
    await Project.updateOne({ _id: project._id }, { $set: { githubRepo: repository.fullName } });

    if (previous?.id !== repository.id) {
      await logActivity({
        project: project._id,
        actor: req.user.id,
        type: 'project.updated',
        summary: previous
          ? `changed the GitHub repository from ${quote(previous.fullName)} to ${quote(repository.fullName)}`
          : `connected the GitHub repository ${quote(repository.fullName)}`,
        targetLabel: project.name,
        meta: { fields: ['githubRepo'], githubRepository: repository.fullName, githubRepositoryId: repository.id },
      });
    }

    // Same shape as GET /api/projects/:id/github (M1) so the panel can simply replace its state.
    return res.json({
      configured: true,
      canAuthorize: role === 'Owner',
      connection: connectionView(saved),
      ...repositoryStatus({ connection: saved, configured: true, role }),
    });
  } catch (error) {
    return next(error);
  }
});
