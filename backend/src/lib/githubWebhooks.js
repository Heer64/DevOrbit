import crypto from 'node:crypto';

import { GITHUB_API_URL, GithubApiError, githubError } from './githubRepos.js';
import { SUPPORTED_EVENTS } from './githubEvents.js';

/*
 * [Sprint 4 · M4] US-34 See GitHub events in the feed (FR-12, NFR-11a, NFR-11b).
 *
 * Signed GitHub webhooks: the settings, the signature check, the retry rule and the GitHub calls
 * that create / remove the repository webhook. No database or Express imports, so everything here
 * is unit tested without MongoDB (backend/test/githubWebhooks.test.js). GitHub is reached through
 * `fetchImpl` and waiting goes through `sleep`, so tests replace both.
 *
 * Settings (backend/.env only, never the frontend):
 *   GITHUB_WEBHOOK_SECRET  shared secret GitHub signs every delivery with (at least 20 characters)
 *   GITHUB_WEBHOOK_URL     public URL of POST /api/github/webhook that GitHub delivers to
 *
 * Neither value, nor the access token, is ever part of an error message, a log line or a return value.
 */

export const WEBHOOK_EVENTS = SUPPORTED_EVENTS; // push, issues, pull_request
export const SIGNATURE_HEADER = 'x-hub-signature-256';
export const MIN_SECRET_LENGTH = 20;
const REQUEST_TIMEOUT_MS = 10_000;

// NFR-11a: failed processing is retried 3 times with exponential backoff (1 s, 2 s, 4 s).
export const RETRY_DEFAULTS = { retries: 3, baseDelayMs: 1000 };
// NFR-11b: wait for GitHub's rate limit to reset only if that is soon; otherwise give up cleanly.
export const MAX_RATE_LIMIT_WAIT_MS = 10_000;

export const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function webhookConfig(env = process.env) {
  const secret = String(env.GITHUB_WEBHOOK_SECRET || '').trim();
  const url = String(env.GITHUB_WEBHOOK_URL || '').trim();
  const secretOk = secret.length >= MIN_SECRET_LENGTH;
  let urlOk = false;
  try {
    const parsed = new URL(url);
    urlOk = parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    urlOk = false;
  }
  const missing = [];
  if (!secretOk) missing.push('GITHUB_WEBHOOK_SECRET');
  if (!urlOk) missing.push('GITHUB_WEBHOOK_URL');
  return { secret: secretOk ? secret : '', url: urlOk ? url : '', configured: missing.length === 0, missing };
}

// "sha256=<hex HMAC of the exact request body>", as GitHub sends it.
export function signPayload(secret, rawBody) {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

// Constant-time check of X-Hub-Signature-256 against the raw body. False for anything malformed.
export function verifySignature(secret, rawBody, header) {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  if (typeof header !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(header.trim())) return false;
  const expected = Buffer.from(signPayload(secret, rawBody), 'utf8');
  const given = Buffer.from(header.trim().toLowerCase(), 'utf8');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// X-GitHub-Delivery is a GUID; accept a short, plain ID only.
export function validDeliveryId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
}

export function validEventName(value) {
  return typeof value === 'string' && /^[a-z_]{1,50}$/.test(value);
}

/*
 * Runs fn() and, if it throws, tries again `retries` more times, waiting baseDelayMs, 2x, 4x, ...
 * Never throws. -> { ok, attempts, value } or { ok: false, attempts, error }
 */
export async function runWithRetry(fn, { retries = RETRY_DEFAULTS.retries, baseDelayMs = RETRY_DEFAULTS.baseDelayMs, sleep = defaultSleep } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const value = await fn(attempt);
      return { ok: true, attempts: attempt, value };
    } catch (error) {
      lastError = error;
      if (attempt <= retries) await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  return { ok: false, attempts: retries + 1, error: lastError };
}

// NFR-11b: on a rate limit that resets soon, wait for it once and try again; otherwise rethrow.
export async function withRateLimitBackoff(fn, { sleep = defaultSleep, maxWaitMs = MAX_RATE_LIMIT_WAIT_MS } = {}) {
  try {
    return await fn();
  } catch (error) {
    const waitMs = error instanceof GithubApiError && error.kind === 'rate_limited' && error.retryAfter !== null
      ? Math.max(1, error.retryAfter) * 1000
      : null;
    if (waitMs === null || waitMs > maxWaitMs) throw error;
    await sleep(waitMs);
    return fn();
  }
}

// A safe, short reason for the delivery log and the panel. Never includes a response body.
export function shortError(error) {
  if (error instanceof GithubApiError) return `GitHub ${error.kind}${error.status ? ` (HTTP ${error.status})` : ''}`;
  const name = error?.name || 'Error';
  const message = typeof error?.message === 'string' ? error.message : '';
  return `${name}: ${message}`.slice(0, 200);
}

function repoPath(fullName) {
  if (typeof fullName !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(fullName)) {
    throw new GithubApiError('unavailable', 'Not a GitHub repository name.');
  }
  const [owner, name] = fullName.split('/');
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

async function githubRequest(method, path, accessToken, { body, fetchImpl = globalThis.fetch } = {}) {
  if (typeof accessToken !== 'string' || !accessToken) throw new GithubApiError('unauthorized', 'No GitHub authorization to use.');
  let response;
  try {
    response = await fetchImpl(`${GITHUB_API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'DevOrbit',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
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

function hookBody(config) {
  return {
    name: 'web',
    active: true,
    events: WEBHOOK_EVENTS,
    config: { url: config.url, content_type: 'json', insecure_ssl: '0', secret: config.secret },
  };
}

/*
 * Creates the repository webhook (or updates ours if GitHub says one with our URL already exists,
 * e.g. another project connected the same repository, or an earlier attempt half-finished).
 * Needs admin rights on the repository. -> { hookId }
 * Throws GithubApiError; kind 'not_admin' when GitHub answers 403/404 (no admin rights).
 */
export async function createRepositoryWebhook({ accessToken, fullName, config = webhookConfig(), fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  if (!config.configured) throw new GithubApiError('not_configured', 'Webhook settings are missing on the server.');
  const base = repoPath(fullName);

  return withRateLimitBackoff(async () => {
    const created = await githubRequest('POST', `${base}/hooks`, accessToken, { body: hookBody(config), fetchImpl });
    if (created.status === 201 || created.status === 200) {
      const data = await readJson(created);
      if (!Number.isSafeInteger(data?.id)) throw new GithubApiError('unavailable', 'GitHub did not return a webhook ID.');
      return { hookId: data.id };
    }
    if (created.status === 404 || (created.status === 403 && created.headers.get('x-ratelimit-remaining') !== '0' && !created.headers.has('retry-after'))) {
      throw new GithubApiError('not_admin', 'The GitHub account cannot manage webhooks on this repository.', { status: created.status });
    }
    if (created.status !== 422) throw githubError(created);

    // 422: a hook with our URL already exists. Find it and refresh its secret and events.
    const listed = await githubRequest('GET', `${base}/hooks?per_page=100`, accessToken, { fetchImpl });
    if (!listed.ok) throw githubError(listed);
    const hooks = await readJson(listed);
    const ours = Array.isArray(hooks) ? hooks.find((hook) => hook?.config?.url === config.url) : null;
    if (!ours || !Number.isSafeInteger(ours.id)) {
      throw new GithubApiError('unavailable', 'GitHub refused to create the webhook.', { status: 422 });
    }
    const updated = await githubRequest('PATCH', `${base}/hooks/${ours.id}`, accessToken, { body: hookBody(config), fetchImpl });
    if (!updated.ok) throw githubError(updated);
    return { hookId: ours.id };
  }, { sleep });
}

// Removes the webhook. A hook that is already gone (404) counts as removed. -> { removed: true }
export async function deleteRepositoryWebhook({ accessToken, fullName, hookId, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  if (!Number.isSafeInteger(hookId) || hookId <= 0) return { removed: true };
  const base = repoPath(fullName);
  return withRateLimitBackoff(async () => {
    const response = await githubRequest('DELETE', `${base}/hooks/${hookId}`, accessToken, { fetchImpl });
    if (response.status === 204 || response.status === 404) return { removed: true };
    throw githubError(response);
  }, { sleep });
}

// What the panel shows about the webhook (never the secret or the URL's query string).
export function webhookView(connection) {
  const hook = connection?.webhook;
  const repositoryId = connection?.repository?.githubId;
  if (!hook || !hook.status) return null;
  // A status recorded for a different repository than the connected one is out of date.
  if (repositoryId && hook.repositoryId && hook.repositoryId !== repositoryId) return null;
  return {
    status: hook.status,
    message: hook.message || '',
    events: WEBHOOK_EVENTS,
    updatedAt: hook.updatedAt || null,
  };
}

// Messages for each webhook status, shown by the panel.
export const WEBHOOK_MESSAGES = {
  active: 'Commits, issues and pull requests from this repository now appear in the Activity feed.',
  not_configured: 'Webhook not set up: the server is missing GITHUB_WEBHOOK_SECRET or GITHUB_WEBHOOK_URL in backend/.env.',
  not_admin: 'Webhook not set up: the authorized GitHub account is not an admin of this repository, so it cannot add a webhook.',
  failed: 'Webhook not set up: GitHub could not be reached. Choose the repository again to retry.',
  rate_limited: 'Webhook not set up: GitHub\'s rate limit was reached. Choose the repository again in a few minutes.',
  reauthorize: 'Webhook not set up: GitHub no longer accepts this project\'s authorization. Re-authorize GitHub, then choose the repository again.',
};
