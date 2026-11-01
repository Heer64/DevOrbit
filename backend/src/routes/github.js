import { Router } from 'express';
import mongoose from 'mongoose';

import Project from '../models/Project.js';
import GithubConnection from '../models/GithubConnection.js';
import GithubOAuthState from '../models/GithubOAuthState.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, memberRole } from '../lib/projectAccess.js';
import { canEditProject } from '../lib/permissions.js';
import { encryptToken } from '../lib/githubCrypto.js';
import { repositoryStatus } from '../lib/githubRepos.js'; // [Sprint 4 · M2] US-32
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
    const connection = await GithubConnection.findOne({ project: access.project._id })
      .populate('authorizedBy', 'name username')
      .populate('repository.connectedBy', 'name username') // [Sprint 4 · M2] US-32
      .lean();
    const configured = githubConfig().configured;
    return res.json({
      configured,
      canAuthorize: access.role === 'Owner',
      connection: connectionView(connection),
      // [Sprint 4 · M2] US-32: { repository, connectionState, active, canSelectRepository } (lib/githubRepos.js)
      ...repositoryStatus({ connection, configured, role: access.role }),
    });
  } catch (error) {
    return next(error);
  }
});

projectGithubRoutes.post('/authorize', async (req, res, next) => {
  try {
    const access = await loadProjectForMember(req, res);
    if (!access) return undefined;
    if (access.role !== 'Owner') {
      return res.status(403).json({ message: 'Only the project Owner can connect GitHub.' });
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
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
    res.cookie(STATE_COOKIE, state, { ...stateCookieOptions(), maxAge: STATE_TTL_MS });
    res.set('Cache-Control', 'no-store');
    return res.json({ url: authorizeUrl(state, config) });
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

  if (!record || record.expiresAt <= new Date()) return finish(record?.project, 'expired');
  const projectId = String(record.project);

  // The browser that comes back must be the one that started the flow.
  if (!sameState(queryState, cookieState)) return finish(projectId, 'invalid');

  // Owner pressed "Cancel" on GitHub (or GitHub refused): nothing is stored.
  if (req.query.error) return finish(projectId, req.query.error === 'access_denied' ? 'denied' : 'error');

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code || code.length > 200) return finish(projectId, 'error');

  try {
    // Ownership may have changed in the 10 minutes since the flow started.
    const project = mongoose.isValidObjectId(projectId) ? await Project.findById(projectId).select('members').lean() : null;
    if (!project || memberRole(project, String(record.user)) !== 'Owner') return finish(projectId, 'forbidden');

    const config = githubConfig();
    if (!config.configured) return finish(projectId, 'error');

    const { accessToken, scopes } = await exchangeCode(code, config);
    const githubUser = await fetchGithubUser(accessToken);

    await GithubConnection.findOneAndUpdate(
      { project: project._id },
      {
        project: project._id,
        authorizedBy: record.user,
        githubUserId: githubUser.id,
        githubLogin: githubUser.login,
        scopes,
        encryptedToken: encryptToken(accessToken),
        authorizedAt: new Date(),
      },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
    return finish(projectId, 'connected');
  } catch (error) {
    // Log the reason only. Our errors never include the token, code or client secret.
    console.error('GitHub authorization failed:', error?.name === 'GithubOAuthError' ? error.message : (error?.name || 'Error'));
    return finish(projectId, 'error');
  }
});
