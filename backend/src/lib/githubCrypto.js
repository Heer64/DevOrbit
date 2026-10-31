import crypto from 'node:crypto';

/*
 * [Sprint 4 · M1] US-31 (NFR-4): GitHub access tokens are encrypted at rest.
 *
 * AES-256-GCM with a 32-byte key taken only from the server environment (GITHUB_TOKEN_KEY,
 * 64 hex characters). Each token gets a fresh 12-byte IV; the auth tag makes any change to the
 * stored value fail to decrypt instead of returning garbage.
 *
 * Stored format (one string): "v1.<iv>.<tag>.<ciphertext>", each part base64url.
 *
 * Nothing in this file logs or returns the plain token except decryptToken(), which is for
 * server-side GitHub API calls only (US-32/US-34). Never send its result to the browser.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

// Returns the 32-byte key, or null when GITHUB_TOKEN_KEY is missing or not 64 hex characters.
export function tokenKey(env = process.env) {
  const raw = String(env.GITHUB_TOKEN_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

export function encryptToken(plainToken, key = tokenKey()) {
  if (!key) throw new Error('GITHUB_TOKEN_KEY is not configured.');
  if (typeof plainToken !== 'string' || !plainToken) throw new Error('Nothing to encrypt.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptToken(stored, key = tokenKey()) {
  if (!key) throw new Error('GITHUB_TOKEN_KEY is not configured.');
  const parts = String(stored || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Stored GitHub token has an unknown format.');
  const [, iv, tag, ciphertext] = parts.map((part, index) => (index === 0 ? part : Buffer.from(part, 'base64url')));
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
