/*
 * [Sprint 6 · M1] US-04 Reset a forgotten password (FR-1, NFR-3a, NFR-19).
 *
 *   AC1  A registered email gets a single-use reset link, valid for 1 hour, by email.
 *   AC2  An email that is not registered gets the SAME confirmation message (account existence is not revealed).
 *   AC3  A valid link + a new valid password updates the password and invalidates every existing session.
 *
 * Pure rules only: no database, no Express, no network, so they are unit tested directly
 * (backend/test/passwordResetRules.test.js). The route is routes/passwordReset.js, sending is lib/mailer.js.
 *
 * Security choices
 *   - The link carries a random 256-bit token. Only its SHA-256 hash is stored (like refresh tokens), so a database
 *     leak gives nobody a working link.
 *   - The token travels in the URL *fragment* (/reset-password#token=...). Browsers never send the fragment to a
 *     server, so it does not end up in server logs, proxy logs or the Referer header.
 *   - The link's address comes from APP_URL (or CLIENT_ORIGIN), never from the request's Host header, so a forged
 *     request cannot make the email point to someone else's site.
 */
import crypto from 'node:crypto';

export const RESET_LINK_TTL_MS = 60 * 60 * 1000; // AC1: valid for 1 hour
export const MAX_RESET_EMAILS_PER_HOUR = 3; // per account, so nobody can flood someone's inbox
export const PASSWORD_MIN_LENGTH = 8; // same rules as sign-up (routes/auth.js)
export const PASSWORD_MAX_LENGTH = 128;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes in base64url
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // same check as sign-up

export const RESET_MESSAGES = {
  // AC2: exactly the same text whether or not the account exists.
  requested:
    'If an account exists for that email, we have sent it a link to reset the password. The link works once and expires in 1 hour.',
  emailRequired: 'Enter your email address.',
  emailInvalid: 'Enter a valid email address.',
  linkInvalid: 'This reset link is invalid, has expired or has already been used. Request a new one.',
  done: 'Your password has been changed and you have been signed out on every device. Log in with your new password.',
  mailUnavailable: 'Password reset by email is not available on this server right now. Please try again later.',
  tooMany: 'Too many requests. Please wait a few minutes and try again.',
};

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : '';
}

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_PATTERN.test(email);
}

// '' when the password is acceptable, otherwise the message to show (the same wording as sign-up).
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length === 0) return 'Enter a new password.';
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  return '';
}

export function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function newResetToken() {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

// Cheap shape check before any database lookup.
export function looksLikeResetToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function cleanBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

// Where the frontend lives: APP_URL, else the first CLIENT_ORIGIN, else the Vite dev server.
export function appBaseUrl(env = process.env) {
  const firstOrigin = String(env.CLIENT_ORIGIN || '').split(',')[0];
  return cleanBaseUrl(env.APP_URL) || cleanBaseUrl(firstOrigin) || 'http://localhost:5173';
}

export function resetLinkFor(baseUrl, token) {
  return `${baseUrl}/reset-password#token=${encodeURIComponent(token)}`;
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// The email itself. Plain text for every mail client, plus simple HTML.
export function resetEmail({ name, link }) {
  const greeting = name ? `Hi ${String(name).slice(0, 80)},` : 'Hi,';
  const subject = 'Reset your DevOrbit password';
  const text = [
    greeting,
    '',
    'Someone (hopefully you) asked to reset the password of your DevOrbit account.',
    'Open this link to choose a new password. It works once and expires in 1 hour:',
    '',
    link,
    '',
    'Changing the password signs you out on every device.',
    'If you did not ask for this, ignore this email: your password stays the same.',
    '',
    '— DevOrbit',
  ].join('\n');
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    '<p>Someone (hopefully you) asked to reset the password of your DevOrbit account.</p>',
    `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>`,
    `<p>If the button does not work, copy this address into your browser:<br>${escapeHtml(link)}</p>`,
    '<p>The link works once and expires in 1 hour. Changing the password signs you out on every device.</p>',
    '<p>If you did not ask for this, ignore this email: your password stays the same.</p>',
    '<p>— DevOrbit</p>',
  ].join('\n');
  return { subject, text, html };
}
