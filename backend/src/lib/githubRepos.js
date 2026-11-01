/*
 * [Sprint 4 · M2] US-32 Connect a repository (FR-11).
 *
 * GitHub repository helpers and the rule for when a project's GitHub connection is Active.
 * No database or Express imports on purpose, so everything here is unit tested without
 * MongoDB (backend/test/githubRepos.test.js). GitHub is reached through `fetchImpl`.
 *
 * The access token is only ever put in the Authorization header of a request to
 * api.github.com. It is never part of an error message, a log line or a return value.
 *
 * Active rule (connectionState):
 *   not_connected     no GitHub authorization stored for the project (US-31 not done yet)
 *   unavailable       an authorization is stored, but the server's GitHub settings are missing,
 *                     so the stored token cannot be used (GITHUB_TOKEN_KEY etc., see githubOAuth.js)
 *   needs_repository  authorized, but no repository is selected, or the selected repository was
 *                     chosen under a different GitHub account than the one authorized now
 *   active            authorized, server configured, and a repository selected under the current
 *                     GitHub account (it was checked against that account's repository list when chosen)
 */

export const GITHUB_API_URL = 'https://api.github.com';
export const REPOS_PER_PAGE = 100;
export const MAX_REPO_PAGES = 5; // up to 500 repositories in the picker
const REQUEST_TIMEOUT_MS = 10_000;

export const CONNECTION_STATES = ['not_connected', 'unavailable', 'needs_repository', 'active'];

export class GithubApiError extends Error {
  /*
   * kind:
   *   unauthorized  GitHub answered 401: the token was revoked or expired (re-authorize, US-33)
   *   rate_limited  GitHub's rate limit is used up; retryAfter is in seconds when known (NFR-11b)
   *   forbidden     GitHub answered 403 for another reason (e.g. an organization's SSO policy)
   *   unavailable   network error, timeout, 5xx or an answer we could not read
   */
  constructor(kind, message, { status = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'GithubApiError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function retryAfterSeconds(headers, now = Date.now()) {
  const retry = Number.parseInt(headers.get('retry-after') || '', 10);
  if (Number.isFinite(retry) && retry >= 0) return retry;
  const reset = Number.parseInt(headers.get('x-ratelimit-reset') || '', 10);
  if (Number.isFinite(reset)) return Math.max(0, Math.ceil(reset - now / 1000));
  return null;
}

// Turns a non-OK GitHub answer into a GithubApiError. Never reads or repeats the request.
export function githubError(response, now = Date.now()) {
  const { status, headers } = response;
  if (status === 401) {
    return new GithubApiError('unauthorized', 'GitHub no longer accepts the stored authorization.', { status });
  }
  const limited = status === 429
    || (status === 403 && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')));
  if (limited) {
    return new GithubApiError('rate_limited', 'GitHub rate limit reached.', { status, retryAfter: retryAfterSeconds(headers, now) });
  }
  if (status === 403) return new GithubApiError('forbidden', 'GitHub refused the request.', { status });
  return new GithubApiError('unavailable', `GitHub answered HTTP ${status}.`, { status });
}

const safeText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

// The link is shown in the browser, so only ever a github.com https URL.
function githubHtmlUrl(raw, fullName) {
  const url = typeof raw === 'string' ? raw : '';
  if (/^https:\/\/github\.com\/[^\s]+$/.test(url)) return url.slice(0, 300);
  return `https://github.com/${fullName}`;
}

// Shapes one repository from GitHub's API into what FORGE uses. Returns null for anything malformed.
export function toRepository(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isSafeInteger(raw.id) || raw.id <= 0) return null;
  const fullName = safeText(raw.full_name, 200);
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(fullName)) return null;
  const [ownerFromName, nameFromFullName] = fullName.split('/');
  return {
    id: raw.id,
    name: safeText(raw.name, 100) || nameFromFullName,
    fullName,
    owner: safeText(raw.owner?.login, 100) || ownerFromName,
    private: raw.private === true,
    htmlUrl: githubHtmlUrl(raw.html_url, fullName),
    defaultBranch: safeText(raw.default_branch, 255),
    description: safeText(raw.description, 300),
    archived: raw.archived === true,
    admin: raw.permissions?.admin === true,
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : null,
  };
}

async function githubGet(path, accessToken, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${GITHUB_API_URL}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'DevOrbit',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GithubApiError('unavailable', 'Could not reach GitHub.');
  }
  if (!response.ok) throw githubError(response);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new GithubApiError('unavailable', 'GitHub sent an answer that could not be read.', { status: response.status });
  }
  return { data, headers: response.headers };
}

/*
 * Every repository the authorized GitHub account can use: its own, ones it collaborates on,
 * and ones in its organizations (GET /user/repos), most recently updated first.
 * Returns { repositories, truncated } where truncated means there were more than
 * MAX_REPO_PAGES * REPOS_PER_PAGE and the rest were not loaded.
 */
export async function listUserRepositories(accessToken, { fetchImpl = globalThis.fetch, maxPages = MAX_REPO_PAGES } = {}) {
  if (typeof accessToken !== 'string' || !accessToken) throw new GithubApiError('unauthorized', 'No GitHub authorization to use.');
  const seen = new Set();
  const repositories = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams({
      per_page: String(REPOS_PER_PAGE),
      page: String(page),
      sort: 'updated',
      affiliation: 'owner,collaborator,organization_member',
    });
    const { data, headers } = await githubGet(`/user/repos?${query}`, accessToken, fetchImpl);
    if (!Array.isArray(data)) throw new GithubApiError('unavailable', 'GitHub sent an unexpected repository list.');
    for (const raw of data) {
      const repository = toRepository(raw);
      if (repository && !seen.has(repository.id)) {
        seen.add(repository.id);
        repositories.push(repository);
      }
    }
    const hasNext = /rel="next"/.test(headers.get('link') || '');
    if (!hasNext || data.length < REPOS_PER_PAGE) return { repositories, truncated: false };
  }
  return { repositories, truncated: true };
}

// The repository ID sent by the browser: a positive whole number (or the same as digits). null otherwise.
export function parseRepositoryId(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw === 'string' && /^[1-9]\d{0,15}$/.test(raw.trim())) {
    const value = Number(raw.trim());
    return Number.isSafeInteger(value) ? value : null;
  }
  return null;
}

// What is stored on GithubConnection.repository for a chosen repository.
export function storedRepository(repository, { githubUserId, connectedBy, connectedAt = new Date() }) {
  return {
    githubId: repository.id,
    name: repository.name,
    fullName: repository.fullName,
    owner: repository.owner,
    private: repository.private,
    htmlUrl: repository.htmlUrl,
    defaultBranch: repository.defaultBranch,
    admin: repository.admin,
    githubUserId,
    connectedBy,
    connectedAt,
  };
}

// The stored repository as the API shows it (only for the GitHub account authorized now).
export function repositoryView(connection) {
  const repo = connection?.repository;
  if (!repo || !repo.githubId || repo.githubUserId !== connection.githubUserId) return null;
  const by = repo.connectedBy;
  return {
    id: repo.githubId,
    name: repo.name,
    fullName: repo.fullName,
    owner: repo.owner,
    private: Boolean(repo.private),
    htmlUrl: repo.htmlUrl,
    defaultBranch: repo.defaultBranch || '',
    connectedAt: repo.connectedAt || null,
    connectedBy: by && by._id ? { _id: by._id, name: by.name, username: by.username } : null,
  };
}

/*
 * The US-32 part of GET /api/projects/:id/github:
 *   { repository, connectionState, active, canSelectRepository }
 * `connection` is the lean GithubConnection (or null), `configured` is githubConfig().configured,
 * `role` is the caller's project role.
 */
export function repositoryStatus({ connection, configured, role }) {
  const repository = connection ? repositoryView(connection) : null;
  let connectionState = 'not_connected';
  if (connection && !configured) connectionState = 'unavailable';
  else if (connection && !repository) connectionState = 'needs_repository';
  else if (connection) connectionState = 'active';
  return {
    repository,
    connectionState,
    active: connectionState === 'active',
    canSelectRepository: role === 'Owner' && Boolean(connection) && Boolean(configured),
  };
}
