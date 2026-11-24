import { GITHUB_API_URL, GithubApiError, githubError, toRepository } from './githubRepos.js';

/*
 * [Sprint 7 · M8] D3 fix (Sprint 4 re-test, Urvish): "The project's Code & files panel shows hard-coded
 * sample data on real projects, even with no repository connected: 12 forks, 4 open PRs, 128 commits and
 * files src, server, README.md 'Updated 2h ago'."
 *
 * The real numbers and top-level files of the project's connected repository, read from GitHub with the
 * project's stored token (server side only):
 *   GET /repositories/{id}            stars, forks, open issues + pull requests, last push, default branch
 *                                     (by ID, so a renamed repository is still found)
 *   GET /repos/{owner}/{name}/contents the files and folders at the top of the default branch
 *
 * No database and no Express imports: unit tested without MongoDB (backend/test/githubSprint7Rules.test.js).
 * GitHub is reached through `fetchImpl`, so tests use a fake. The token is only ever in the
 * Authorization header: never in a return value, an error message or a log line.
 */

export const CODE_FILES_MAX = 20;
export const CODE_CACHE_MS = 60_000; // page reloads within a minute do not call GitHub again
const REQUEST_TIMEOUT_MS = 10_000;
const FULL_NAME = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export const CODE_STATES = ['not_connected', 'disconnected', 'needs_repository', 'unavailable', 'active'];

// What the panel says for each reason it cannot show the repository. Never a GitHub error text.
export const CODE_MESSAGES = {
  not_connected: 'No repository connected.',
  disconnected: 'GitHub was disconnected from this project.',
  needs_repository: 'GitHub is authorized, but no repository is chosen yet.',
  not_configured: 'GitHub is not set up on this server right now.',
  reauthorize: 'GitHub no longer accepts this project\'s authorization. The Owner or an Admin can re-authorize it in the GitHub panel.',
  repository_unavailable: 'The connected repository can no longer be read (it may have been deleted, renamed to private, or access was removed).',
  rate_limited: 'GitHub\'s rate limit has been reached. Please try again in a few minutes.',
  forbidden: 'GitHub refused to show this repository. An organization may need to approve DevOrbit.',
  unavailable: 'Could not reach GitHub right now. Please try again.',
};

const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

// Only ever a github.com https link in the browser.
export function safeGithubLink(value) {
  return typeof value === 'string' && /^https:\/\/github\.com\/[^\s"'<>]+$/.test(value) && value.length <= 500 ? value : null;
}

// GitHub's repository -> { repository, stats } or null when it cannot be read.
export function toCodeRepository(raw) {
  const repository = toRepository(raw);
  if (!repository) return null;
  const pushedAt = typeof raw.pushed_at === 'string' && !Number.isNaN(Date.parse(raw.pushed_at)) ? raw.pushed_at : null;
  return {
    repository: {
      fullName: repository.fullName,
      htmlUrl: repository.htmlUrl,
      defaultBranch: repository.defaultBranch || '',
      private: repository.private,
    },
    stats: {
      stars: count(raw.stargazers_count),
      forks: count(raw.forks_count),
      // GitHub counts open pull requests inside open_issues_count, so the label says both.
      openIssuesAndPrs: count(raw.open_issues_count),
      pushedAt,
    },
  };
}

/*
 * GitHub's top-level contents -> { files: [{ name, type: 'dir'|'file', htmlUrl }], total, more }
 * Folders first, then by name (case-insensitive), at most CODE_FILES_MAX. Anything malformed is skipped.
 */
export function toTopLevelFiles(raw, max = CODE_FILES_MAX) {
  const list = Array.isArray(raw) ? raw : [];
  const files = [];
  for (const item of list) {
    if (!item || typeof item.name !== 'string' || !item.name || item.name.length > 255 || /[\r\n]/.test(item.name)) continue;
    files.push({
      name: item.name,
      type: item.type === 'dir' ? 'dir' : 'file', // file, symlink and submodule all open on GitHub the same way
      htmlUrl: safeGithubLink(item.html_url),
    });
  }
  files.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });
  return { files: files.slice(0, max), total: files.length, more: files.length > max };
}

// A GithubApiError -> the reason shown in the panel.
export function codeErrorReason(error) {
  if (!(error instanceof GithubApiError)) return 'unavailable';
  if (error.kind === 'unauthorized') return 'reauthorize';
  if (error.kind === 'rate_limited') return 'rate_limited';
  if (error.kind === 'forbidden') return 'forbidden';
  if (error.kind === 'not_found') return 'repository_unavailable';
  return 'unavailable';
}

async function get(path, accessToken, fetchImpl) {
  if (typeof accessToken !== 'string' || !accessToken) throw new GithubApiError('unauthorized', 'No GitHub authorization to use.');
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
  return response;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new GithubApiError('unavailable', 'GitHub sent an answer that could not be read.', { status: response.status });
  }
}

/*
 * The connected repository's numbers and top-level files.
 * -> { repository, stats, files, filesTotal, moreFiles, empty }
 * Throws GithubApiError: unauthorized (token rejected), not_found (repository gone or no longer readable),
 * rate_limited, forbidden, unavailable.
 */
export async function fetchRepositoryCode({ accessToken, githubRepositoryId, fetchImpl = globalThis.fetch }) {
  if (!Number.isSafeInteger(githubRepositoryId) || githubRepositoryId <= 0) {
    throw new GithubApiError('not_found', 'No repository to read.');
  }
  const repoResponse = await get(`/repositories/${githubRepositoryId}`, accessToken, fetchImpl);
  if (repoResponse.status === 404) throw new GithubApiError('not_found', 'The repository can no longer be read.', { status: 404 });
  if (!repoResponse.ok) throw githubError(repoResponse);
  const shaped = toCodeRepository(await readJson(repoResponse));
  if (!shaped || !FULL_NAME.test(shaped.repository.fullName)) {
    throw new GithubApiError('unavailable', 'GitHub sent a repository that could not be read.', { status: repoResponse.status });
  }

  // The current name from GitHub (the stored one may be out of date after a rename).
  const [owner, name] = shaped.repository.fullName.split('/');
  const contents = await get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents`, accessToken, fetchImpl);
  let listing = { files: [], total: 0, more: false };
  let empty = false;
  if (contents.status === 404) {
    empty = true; // GitHub answers 404 "This repository is empty." for a repository without commits
  } else if (!contents.ok) {
    throw githubError(contents);
  } else {
    listing = toTopLevelFiles(await readJson(contents));
  }
  return { ...shaped, files: listing.files, filesTotal: listing.total, moreFiles: listing.more, empty };
}

// ---------------------------------------------------------------------------------------------
// Short in-memory cache (per server process). Keyed by project + repository + authorization, so a new
// repository or a re-authorize is never answered from an old entry.
// ---------------------------------------------------------------------------------------------
const cache = new Map();
const CACHE_LIMIT = 500;

export function codeCacheKey({ projectId, githubRepositoryId, authorizedAt }) {
  const when = authorizedAt ? new Date(authorizedAt).getTime() : 0;
  return `${projectId}:${githubRepositoryId}:${when}`;
}

export function readCodeCache(key, now = Date.now()) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.body;
}

export function writeCodeCache(key, body, { now = Date.now(), ttlMs = CODE_CACHE_MS } = {}) {
  if (cache.size >= CACHE_LIMIT) {
    for (const [oldKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(oldKey);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }
  cache.set(key, { body, expiresAt: now + ttlMs });
}

// Tests start from an empty cache.
export function clearCodeCache() {
  cache.clear();
}
