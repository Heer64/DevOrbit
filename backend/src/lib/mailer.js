/*
 * [Sprint 6 · M1] US-04: sends the password reset email. No npm package: the Brevo HTTP API is called with fetch.
 *
 *   MAIL_TRANSPORT   What happens to an email                          When
 *   log              printed in the API terminal (link included)       local development (default outside production)
 *   brevo            sent for real through Brevo's API                 Render, or a real inbox while testing
 *   memory           kept in memory for the automated tests            NODE_ENV=test (default there)
 *   (none)           not sent: forgot-password answers 503 for EVERY   production with nothing configured
 *                    email, so it still reveals nothing about accounts
 *
 * "log" is refused in production: reset links must never end up in a hosting provider's logs.
 * Brevo needs BREVO_API_KEY and MAIL_FROM (a sender address verified in Brevo). Neither the key nor any
 * email content is ever logged by the brevo transport.
 */
import { isValidEmail } from './passwordResetRules.js';

export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 10_000;
const TRANSPORTS = ['log', 'brevo', 'memory'];

const outbox = [];
// Only for tests: what the "memory" transport has "sent".
export const testOutbox = {
  all: () => outbox.map((mail) => ({ ...mail })),
  last: () => (outbox.length ? { ...outbox[outbox.length - 1] } : null),
  clear: () => {
    outbox.length = 0;
  },
};

/**
 * mailConfig(env) -> { transport, ready, problem, from, fromName, apiKey }
 *   ready    true when sendMail() can deliver
 *   problem  why not (for the server log), '' when ready
 */
export function mailConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const asked = String(env.MAIL_TRANSPORT || '')
    .trim()
    .toLowerCase();
  let transport = asked;
  if (!asked) transport = env.NODE_ENV === 'test' ? 'memory' : production ? '' : 'log';

  const from = String(env.MAIL_FROM || '').trim();
  const fromName = String(env.MAIL_FROM_NAME || 'DevOrbit')
    .trim()
    .slice(0, 70);
  const base = { transport, from, fromName, apiKey: '' };

  if (!transport) {
    return { ...base, ready: false, problem: 'MAIL_TRANSPORT is not set (use brevo on the deployed API).' };
  }
  if (!TRANSPORTS.includes(transport)) {
    return { ...base, ready: false, problem: `MAIL_TRANSPORT "${asked}" is not supported (use log, brevo or memory).` };
  }
  if (transport === 'log' && production) {
    return { ...base, ready: false, problem: 'MAIL_TRANSPORT=log is not allowed in production (it would print reset links in the logs).' };
  }
  if (transport === 'brevo') {
    const apiKey = String(env.BREVO_API_KEY || '').trim();
    const missing = [];
    if (!apiKey) missing.push('BREVO_API_KEY');
    if (!isValidEmail(from)) missing.push('MAIL_FROM');
    if (missing.length) return { ...base, ready: false, problem: `Email via Brevo needs ${missing.join(' and ')}.` };
    return { ...base, apiKey, ready: true, problem: '' };
  }
  return { ...base, ready: true, problem: '' };
}

/**
 * sendMail({ to, subject, text, html }) -> resolves when the email was handed over, rejects otherwise.
 * `fetchImpl` lets tests stand in for Brevo.
 */
export async function sendMail(message, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = mailConfig(env);
  if (!config.ready) throw new Error(`Email is not configured: ${config.problem}`);
  const { to, subject, text, html } = message;

  if (config.transport === 'memory') {
    outbox.push({ to, subject, text, html, at: new Date() });
    return { transport: 'memory' };
  }

  if (config.transport === 'log') {
    console.log(
      [
        '',
        '──── [DevOrbit email · MAIL_TRANSPORT=log · not really sent] ────',
        `To: ${to}`,
        `Subject: ${subject}`,
        '',
        text,
        '────',
        '',
      ].join('\n')
    );
    return { transport: 'log' };
  }

  // Brevo: one body type per request, so the HTML version (it also shows the link as plain text).
  const response = await fetchImpl(BREVO_SEND_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': config.apiKey },
    body: JSON.stringify({
      sender: { email: config.from, name: config.fromName },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Brevo answered HTTP ${response.status}.`);
  return { transport: 'brevo' };
}
