import { Router } from 'express';

import GithubConnection from '../models/GithubConnection.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';
import { decryptToken } from '../lib/githubCrypto.js';
import { githubConfig } from '../lib/githubOAuth.js';
import { isDisconnected } from '../lib/githubConnection.js';
import { repositoryView } from '../lib/githubRepos.js';
import {
  CODE_MESSAGES,
  codeCacheKey,
  codeErrorReason,
  fetchRepositoryCode,
  readCodeCache,
  writeCodeCache,
} from '../lib/githubCode.js';
import { markNeedsReauthorization } from './github.js';

/*
 * [Sprint 7 · M8] D3 fix: real data for the project's "Code & files" panel.
 *
 * GET /api/projects/:id/github/code      (mounted as githubCodeRoutes, see app.js)
 *   Any member of the project (Viewer included). 401 not signed in, 400 bad ID, 404 no project,
 *   403 not a member (lib/projectAccess.js, like every project route).
 *   -> { state, message, repository, stats, files, filesTotal, moreFiles, empty, checkedAt }
 *      state        'not_connected' | 'disconnected' | 'needs_repository' | 'unavailable' | 'active'
 *      repository   { fullName, htmlUrl, defaultBranch, private } or null
 *      stats        { stars, forks, openIssuesAndPrs, pushedAt } or null
 *      files        [{ name, type: 'dir'|'file', htmlUrl }]  top level of the default branch, folders first, max 20
 *      reason       why it is 'unavailable' (reauthorize, repository_unavailable, rate_limited, forbidden,
 *                   unavailable, not_configured)
 *   GitHub problems never answer 500: they come back as state 'unavailable' with a friendly message.
 *   A token GitHub rejects (401) is recorded as needing re-authorization, like "Check connection" does.
 *   Answers are cached for about a minute per project (lib/githubCode.js), so reloading the page does not
 *   use up GitHub's rate limit. The token is decrypted only for the call to GitHub and never returned or logged.
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

function emptyBody(state, reason = state) {
  return {
    state,
    reason: state === 'unavailable' ? reason : null,
    message: CODE_MESSAGES[reason] || CODE_MESSAGES.unavailable,
    repository: null,
    stats: null,
    files: [],
    filesTotal: 0,
    moreFiles: false,
    empty: false,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const access = await loadProjectForMember(req, res);
    if (!access) return undefined;
    res.set('Cache-Control', 'no-store');

    const connection = await GithubConnection.findOne({ project: access.project._id }).select('+encryptedToken').lean();
    if (!connection) return res.json(emptyBody('not_connected'));
    if (isDisconnected(connection)) return res.json(emptyBody('disconnected'));
    const stored = repositoryView(connection);
    if (!stored) return res.json(emptyBody('needs_repository'));
    if (!githubConfig().configured) return res.json(emptyBody('unavailable', 'not_configured'));
    if (connection.needsReauthorization) return res.json(emptyBody('unavailable', 'reauthorize'));

    const key = codeCacheKey({ projectId: access.project._id, githubRepositoryId: stored.id, authorizedAt: connection.authorizedAt });
    const cached = readCodeCache(key);
    if (cached) return res.json(cached);

    let accessToken = null;
    try {
      accessToken = decryptToken(connection.encryptedToken);
    } catch {
      accessToken = null; // wrong or rotated GITHUB_TOKEN_KEY, or a damaged record; never logged
    }
    if (!accessToken) {
      await markNeedsReauthorization(connection, 'token_unreadable');
      return res.json(emptyBody('unavailable', 'reauthorize'));
    }

    let body;
    try {
      const code = await fetchRepositoryCode({ accessToken, githubRepositoryId: stored.id });
      body = {
        state: 'active',
        reason: null,
        message: '',
        repository: code.repository,
        stats: code.stats,
        files: code.files,
        filesTotal: code.filesTotal,
        moreFiles: code.moreFiles,
        empty: code.empty,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const reason = codeErrorReason(error);
      if (reason === 'reauthorize') await markNeedsReauthorization(connection, 'token_rejected');
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`Code & files: GitHub could not be read for a project (${reason}${error?.status ? `, HTTP ${error.status}` : ''}).`);
      }
      body = emptyBody('unavailable', reason);
      // A stored repository the panel can still name and link to, without any numbers.
      body.repository = { fullName: stored.fullName, htmlUrl: stored.htmlUrl, defaultBranch: stored.defaultBranch || '', private: stored.private };
    }
    // Problems are cached too (same minute), so a broken repository is not asked again on every reload.
    // A token GitHub rejected is not: the next request already answers "reauthorize" from the database.
    if (body.reason !== 'reauthorize') writeCodeCache(key, body);
    return res.json(body);
  } catch (error) {
    return next(error);
  }
});

export default router;
