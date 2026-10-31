import crypto from 'node:crypto';
import { tokenKey } from './githubCrypto.js';

/*
 * [Sprint 4 · M1] US-31: GitHub OAuth helpers (GitHub "OAuth App" web flow).
 *
 * Every secret comes from the server environment only (backend/.env, never the frontend):
 *   GITHUB_CLIENT_ID       from the registered GitHub OAuth App
 *   GITHUB_CLIENT_SECRET   from the registered GitHub OAuth App
 *   GITHUB_CALLBACK_URL    must equal the app's "Authorization callback URL",
 *                          e.g. http://localhost:5000/api/github/callback
 *   GITHUB_TOKEN_KEY       64 hex characters, encrypts stored access tokens (lib/githubCrypto.js)
 *
 * The access token and the client secret are never put in a log line, an error message
 * or a response body by these helpers.
 */

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';

// OAuth Apps have no read-only repository scope: "repo" is the scope that lets FORGE list and read
// the Owner's repositories, including private ones (US-31 "read my repositories", used by US-32).
export const GITHUB_SCOPES = ['repo'];

export const STATE_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export function githubConfig(env = process.env) {
  const clientId = String(env.GITHUB_CLIENT_ID || '').trim();
  const clientSecret = String(env.GITHUB_CLIENT_SECRET || '').trim();
  const callbackUrl = String(env.GITHUB_CALLBACK_URL || '').trim();
  const key = tokenKey(env);
  let callbackOk = false;
  try {
    const url = new URL(callbackUrl);
    callbackOk = url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    callbackOk = false;
  }
  const configured = Boolean(clientId && clientSecret && callbackOk && key);
  return { configured, clientId, clientSecret, callbackUrl };
}

// Lists what is missing, by name only (never values), for a startup warning.
export function missingGithubSettings(env = process.env) {
  const missing = [];
  if (!String(env.GITHUB_CLIENT_ID || '').trim()) missing.push('GITHUB_CLIENT_ID');
  if (!String(env.GITHUB_CLIENT_SECRET || '').trim()) missing.push('GITHUB_CLIENT_SECRET');
  if (!String(env.GITHUB_CALLBACK_URL || '').trim()) missing.push('GITHUB_CALLBACK_URL');
  if (!tokenKey(env)) missing.push('GITHUB_TOKEN_KEY (64 hex characters)');
  return missing;
}

export function newState() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashState(state) {
  return crypto.createHash('sha256').update(String(state)).digest('hex');
}

// A state we issued is always 43 base64url characters; anything else is rejected before a lookup.
export function looksLikeState(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

// Constant-time comparison so the state check does not leak how many characters matched.
export function sameState(a, b) {
  if (!looksLikeState(a) || !looksLikeState(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function authorizeUrl(state, config = githubConfig()) {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('scope', GITHUB_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

class GithubOAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GithubOAuthError';
  }
}

// Exchanges the one-time ?code for an access token. Returns { accessToken, scopes }.
export async function exchangeCode(code, config = githubConfig(), fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'DevOrbit' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.callbackUrl,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GithubOAuthError('Could not reach GitHub to finish authorization.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error || typeof data.access_token !== 'string' || !data.access_token) {
    // data.error is a short code such as "bad_verification_code"; safe to report, unlike the body.
    const reason = typeof data.error === 'string' ? data.error.slice(0, 60) : `HTTP ${response.status}`;
    throw new GithubOAuthError(`GitHub did not issue an access token (${reason}).`);
  }
  const scopes = String(data.scope || '')
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return { accessToken: data.access_token, scopes };
}

// Reads the GitHub account the token belongs to. Returns { id, login }.
export async function fetchGithubUser(accessToken, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(GITHUB_USER_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'DevOrbit',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GithubOAuthError('Could not reach GitHub to read the authorized account.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Number.isInteger(data.id) || typeof data.login !== 'string') {
    throw new GithubOAuthError(`GitHub did not return the authorized account (HTTP ${response.status}).`);
  }
  return { id: data.id, login: data.login };
}
