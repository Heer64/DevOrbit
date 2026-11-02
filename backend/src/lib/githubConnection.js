import { canManageGithubConnection } from './permissions.js';
import { GITHUB_API_URL, GithubApiError, githubError, repositoryStatus, repositoryView, toRepository } from './githubRepos.js';

/*
 * [Sprint 4 · M3] US-33 Manage the GitHub connection (FR-35).
 *   "Owner/Admin can view status, disconnect and re-authorize. After disconnect, new events stop
 *    coming in but old feed entries stay."
 *
 * The rules only. No database or Express imports on purpose, so all of it is unit tested without
 * MongoDB (backend/test/githubConnection.test.js). GitHub is reached through `fetchImpl`.
 * Routes: routes/github.js. Event gate for webhooks (M4, US-34): lib/githubEventGate.js.
 *
 * Disconnect is a SOFT disconnect: the GithubConnection record stays with status 'disconnected'.
 * The encrypted token is removed (and revoked on GitHub when possible); the GitHub account and the
 * chosen repository are kept so the Owner or an Admin can re-authorize, and when they approve as
 * the same GitHub account the same repository becomes Active again (after its access is checked).
 *
 * connectionState, building on M2's repositoryStatus() (lib/githubRepos.js), first match wins:
 *   not_connected          no GitHub authorization was ever stored for the project
 *   disconnected           an Owner or Admin disconnected it; no token is stored; no events are accepted
 *   unavailable            the server's GitHub settings are missing (M2)
 *   needs_reauthorization  GitHub rejected the stored token, or it can no longer be decrypted
 *   needs_repository       no repository chosen under the current GitHub account (M2)
 *   repository_unavailable the last check found the authorized account can no longer read the repository
 *   unverified             re-authorized, but the repository could not be checked yet (GitHub unreachable)
 *   active                 everything above is fine
 *
 * A repository counts as checked when M2 verified it against the account's repository list at
 * selection time, or when a later check by this file found it readable. A successful GET /user on
 * its own never makes a connection Active.
 */

export const CONNECTION_STATUSES = ['connected', 'disconnected'];
export const REAUTHORIZATION_REASONS = ['token_rejected', 'token_unreadable'];
export const OAUTH_PURPOSES = ['connect', 'reauthorize'];
export const REPOSITORY_ACCESS = ['accessible', 'not_accessible', 'unverified'];

const REQUEST_TIMEOUT_MS = 10_000;

export function isDisconnected(connection) {
  return Boolean(connection) && connection.status === 'disconnected';
}

// ---------------------------------------------------------------------------------------------
// Who may start / finish the OAuth flow (reuses M1's flow; only the role rule is new)
// ---------------------------------------------------------------------------------------------

/*
 * Which OAuth flow `role` may start, or null.
 *   No record yet  -> 'connect', Owner only (US-31 is unchanged).
 *   Record exists  -> 'reauthorize', Owner or Admin (US-33), whether it is connected or disconnected.
 */
export function authorizePurpose({ role, connection }) {
  if (connection) return canManageGithubConnection(role) ? 'reauthorize' : null;
  return role === 'Owner' ? 'connect' : null;
}

// The callback checks the role again: it may have changed in the 10 minutes since the flow started.
export function mayCompleteAuthorization({ role, purpose, connectionExists }) {
  if (role === 'Owner') return true;
  return role === 'Admin' && purpose === 'reauthorize' && Boolean(connectionExists);
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

const sameTime = (a, b) => {
  const left = a ? new Date(a).getTime() : NaN;
  const right = b ? new Date(b).getTime() : NaN;
  return Number.isFinite(left) && left === right;
};

/*
 * The result of the last repository check, only if it belongs to the repository and the
 * authorization in use now. null means "no newer check than M2's list check at selection time".
 */
export function currentRepositoryAccess(connection) {
  const repository = repositoryView(connection);
  const check = connection?.repositoryCheck;
  if (!repository || !check || !REPOSITORY_ACCESS.includes(check.access)) return null;
  if (check.githubId !== repository.id || !sameTime(check.authorizedAt, connection.authorizedAt)) return null;
  return check.access;
}

function personView(person) {
  return person && person._id ? { _id: person._id, name: person.name, username: person.username } : null;
}

/*
 * Everything GET /api/projects/:id/github reports besides M1's `connection`:
 *   M1:  canAuthorize
 *   M2:  repository, connectionState, active, canSelectRepository
 *   M3:  canReauthorize, canDisconnect, canVerify, acceptingEvents, disconnectedAt, disconnectedBy,
 *        needsReauthorization, reauthorizationReason, lastCheckedAt, repositoryAccess
 */
export function connectionStatus({ connection, configured, role }) {
  const base = repositoryStatus({ connection, configured, role }); // M2
  const manage = canManageGithubConnection(role);
  const disconnected = isDisconnected(connection);
  const needsReauthorization = Boolean(connection && !disconnected && connection.needsReauthorization);
  const repositoryAccess = disconnected ? null : currentRepositoryAccess(connection);

  let connectionState = base.connectionState;
  if (disconnected) connectionState = 'disconnected';
  else if (connection && configured) {
    if (needsReauthorization) connectionState = 'needs_reauthorization';
    else if (connectionState === 'active' && repositoryAccess === 'not_accessible') connectionState = 'repository_unavailable';
    else if (connectionState === 'active' && repositoryAccess === 'unverified') connectionState = 'unverified';
  }

  return {
    canAuthorize: authorizePurpose({ role, connection }) !== null,
    ...base,
    connectionState,
    active: connectionState === 'active',
    canSelectRepository: base.canSelectRepository && !disconnected && !needsReauthorization,
    canReauthorize: manage && Boolean(connection) && Boolean(configured),
    canDisconnect: manage && Boolean(connection) && !disconnected,
    canVerify: manage && Boolean(connection) && !disconnected && Boolean(configured),
    acceptingEvents: githubEventsAccepted(connection),
    disconnectedAt: disconnected ? connection.disconnectedAt || null : null,
    disconnectedBy: disconnected ? personView(connection.disconnectedBy) : null,
    needsReauthorization,
    reauthorizationReason: needsReauthorization ? connection.reauthorizationReason || 'token_rejected' : null,
    lastCheckedAt: connection && !disconnected ? connection.lastCheckedAt || null : null,
    repositoryAccess,
  };
}

// ---------------------------------------------------------------------------------------------
// Event gate (the rule; lib/githubEventGate.js applies it to the database)
// ---------------------------------------------------------------------------------------------

/*
 * Whether a GitHub event may be added to this connection's project feed.
 * Yes only while the connection is not disconnected and has a repository chosen under the current
 * GitHub account; when `githubRepositoryId` is given it must be that repository.
 * An expired token does not stop events (webhook deliveries do not use it); only disconnect does.
 */
export function githubEventsAccepted(connection, githubRepositoryId = null) {
  if (!connection || isDisconnected(connection)) return false;
  const repository = repositoryView(connection);
  if (!repository) return false;
  if (githubRepositoryId === null || githubRepositoryId === undefined) return true;
  return Number(githubRepositoryId) === repository.id;
}

// ---------------------------------------------------------------------------------------------
// GitHub calls (token only ever in the Authorization header; never logged or returned)
// ---------------------------------------------------------------------------------------------

function apiHeaders(accessToken) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'DevOrbit',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubFetch(url, options, fetchImpl) {
  try {
    return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new GithubApiError('unavailable', 'Could not reach GitHub.');
  }
}

/*
 * Can the token still read this repository? 'accessible' | 'not_accessible'.
 * Throws GithubApiError: 'unauthorized' (token rejected), 'rate_limited', 'unavailable'.
 */
export async function checkRepositoryAccess(accessToken, githubRepositoryId, { fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isSafeInteger(githubRepositoryId) || githubRepositoryId <= 0) return 'not_accessible';
  const response = await githubFetch(`${GITHUB_API_URL}/repositories/${githubRepositoryId}`, { headers: apiHeaders(accessToken) }, fetchImpl);
  if (response.status === 404) return 'not_accessible';
  if (!response.ok) {
    const error = githubError(response);
    if (error.kind === 'forbidden') return 'not_accessible'; // e.g. organization SSO now blocks it
    throw error;
  }
  const data = await response.json().catch(() => null);
  const repository = toRepository(data);
  if (!repository) throw new GithubApiError('unavailable', 'GitHub sent a repository that could not be read.', { status: response.status });
  return repository.id === githubRepositoryId ? 'accessible' : 'not_accessible';
}

/*
 * "Check connection": the token AND the repository.
 * Returns { token: 'valid' | 'rejected', repository: 'accessible' | 'not_accessible' | 'none' | 'not_checked' }.
 * 'rejected' also covers a token that now belongs to a different GitHub account.
 * Rate limits and outages throw GithubApiError so the caller changes nothing (NFR-11b).
 */
export async function verifyConnection({ accessToken, connection, fetchImpl = globalThis.fetch }) {
  const response = await githubFetch(`${GITHUB_API_URL}/user`, { headers: apiHeaders(accessToken) }, fetchImpl);
  if (!response.ok) {
    const error = githubError(response);
    if (error.kind === 'unauthorized') return { token: 'rejected', repository: 'not_checked' };
    throw error;
  }
  const user = await response.json().catch(() => null);
  if (!user || !Number.isInteger(user.id)) throw new GithubApiError('unavailable', 'GitHub did not return the authorized account.', { status: response.status });
  if (user.id !== connection.githubUserId) return { token: 'rejected', repository: 'not_checked' };

  const repository = repositoryView(connection);
  if (!repository) return { token: 'valid', repository: 'none' };
  try {
    return { token: 'valid', repository: await checkRepositoryAccess(accessToken, repository.id, { fetchImpl }) };
  } catch (error) {
    if (error instanceof GithubApiError && error.kind === 'unauthorized') return { token: 'rejected', repository: 'not_checked' };
    throw error;
  }
}

/*
 * Revokes the token on GitHub (DELETE /applications/{client_id}/token, Basic auth with the app's
 * client ID and secret from the server environment). Best effort: true when GitHub confirms it is
 * gone (204, or 404 = already invalid), false otherwise. Never throws, never logs.
 */
export async function revokeGithubToken(accessToken, config, { fetchImpl = globalThis.fetch } = {}) {
  if (!accessToken || !config?.clientId || !config?.clientSecret) return false;
  try {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const response = await fetchImpl(`${GITHUB_API_URL}/applications/${encodeURIComponent(config.clientId)}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DevOrbit',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.status === 204 || response.status === 404;
  } catch {
    return false;
  }
}
