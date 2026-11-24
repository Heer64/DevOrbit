/*
 * [Sprint 6 · M1] US-04 Reset a forgotten password (Actor: Visitor, FR-1). Mounted at /api/auth, no login needed.
 *
 *   POST /api/auth/forgot-password        { email }            -> 200 { message }   (AC1, AC2)
 *   POST /api/auth/reset-password/verify  { token }            -> 200 { valid, expiresAt } | 400
 *   POST /api/auth/reset-password         { token, password }  -> 200 { message }   (AC3) | 400
 *
 * AC2 (account existence is not revealed): forgot-password answers with the same status and text for every
 * well-formed email, and answers BEFORE the account lookup and the email are done, so the response time does not
 * give it away either. That work runs in the background (waitForPasswordResetWork() lets the tests wait for it).
 * Rules and messages: lib/passwordResetRules.js. Sending: lib/mailer.js.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../lib/rateLimitKey.js'; // [Sprint 7 · M8] D5 fix
import User from '../models/User.js';
import Session from '../models/Session.js';
import PasswordResetToken from '../models/PasswordResetToken.js';
import { mailConfig, sendMail } from '../lib/mailer.js';
import { clearRefreshCookie } from './auth.js';
import {
  MAX_RESET_EMAILS_PER_HOUR,
  RESET_LINK_TTL_MS,
  RESET_MESSAGES,
  appBaseUrl,
  hashResetToken,
  isValidEmail,
  looksLikeResetToken,
  newResetToken,
  normalizeEmail,
  passwordProblem,
  resetEmail,
  resetLinkFor,
} from '../lib/passwordResetRules.js';

const router = Router();

// Per client IP, on top of the /api limiter. Off in tests, like the login and sign-up limiters.
const limiter = (limit) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    keyGenerator: rateLimitKey, // [Sprint 7 · M8] D5: one bucket per client address, port or not
    message: { message: RESET_MESSAGES.tooMany },
  });

const pendingWork = new Set();
// Tests: wait until every background reset request has finished (account lookup, link, email).
export function waitForPasswordResetWork() {
  return Promise.allSettled([...pendingWork]);
}

const linkInvalid = (res) => res.status(400).json({ message: RESET_MESSAGES.linkInvalid, code: 'reset_link_invalid' });

// Earlier links of this account stop working (only the newest one is valid).
function retireOpenLinks(userId, now = new Date()) {
  return PasswordResetToken.updateMany({ user: userId, usedAt: null }, { $set: { usedAt: now } });
}

// The background part of forgot-password. Does nothing visible for an unknown email (AC2).
async function processResetRequest(email) {
  const user = await User.findOne({ email }).select('_id name email');
  if (!user) return;

  // At most MAX_RESET_EMAILS_PER_HOUR emails per account per hour, so nobody can flood someone's inbox.
  // (Records live for 1 hour, so this counts the last hour.)
  const recent = await PasswordResetToken.countDocuments({ user: user._id, createdAt: { $gte: new Date(Date.now() - RESET_LINK_TTL_MS) } });
  if (recent >= MAX_RESET_EMAILS_PER_HOUR) return;

  const now = new Date();
  await retireOpenLinks(user._id, now);
  const { token, tokenHash } = newResetToken();
  await PasswordResetToken.create({ user: user._id, tokenHash, expiresAt: new Date(now.getTime() + RESET_LINK_TTL_MS) });

  const link = resetLinkFor(appBaseUrl(), token);
  await sendMail({ to: user.email, ...resetEmail({ name: user.name, link }) });
}

router.post('/forgot-password', limiter(5), (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ message: RESET_MESSAGES.emailRequired });
  if (!isValidEmail(email)) return res.status(400).json({ message: RESET_MESSAGES.emailInvalid });

  // Checked before the account lookup, so an unconfigured server answers the same for every email (AC2).
  const mail = mailConfig();
  if (!mail.ready) {
    console.error(`Password reset requested, but email is not set up: ${mail.problem}`);
    return res.status(503).json({ message: RESET_MESSAGES.mailUnavailable });
  }

  // Never logs the email address or the link.
  const work = processResetRequest(email)
    .catch((error) => console.error('Password reset email could not be sent:', error.message))
    .finally(() => pendingWork.delete(work));
  pendingWork.add(work);

  return res.json({ message: RESET_MESSAGES.requested });
});

// Lets the reset page say "this link has expired" before the user types a new password. Changes nothing.
router.post('/reset-password/verify', limiter(20), async (req, res, next) => {
  try {
    const token = req.body?.token;
    if (!looksLikeResetToken(token)) return linkInvalid(res);
    const record = await PasswordResetToken.findOne({
      tokenHash: hashResetToken(token),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).select('expiresAt');
    if (!record) return linkInvalid(res);
    return res.json({ valid: true, expiresAt: record.expiresAt });
  } catch (error) {
    return next(error);
  }
});

router.post('/reset-password', limiter(10), async (req, res, next) => {
  try {
    const token = req.body?.token;
    const password = req.body?.password;
    if (!looksLikeResetToken(token)) return linkInvalid(res);
    // The password is checked first, so a typo does not use up the link.
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ message: problem });

    // AC1 single use: marking the link used is one atomic step, so two submits at once cannot both succeed.
    const now = new Date();
    const record = await PasswordResetToken.findOneAndUpdate(
      { tokenHash: hashResetToken(token), usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { new: true }
    );
    if (!record) return linkInvalid(res);

    const user = await User.findById(record.user).select('+passwordHash +loginFailedAttempts +loginLockedUntil');
    if (!user) return linkInvalid(res);

    user.passwordHash = await bcrypt.hash(password, 12); // NFR-3a, same cost as sign-up
    // Proving access to the inbox also lifts a login lock from earlier wrong passwords.
    user.loginFailedAttempts = 0;
    user.loginLockedUntil = null;
    await user.save();

    // AC3: every existing session ends. requireAuth checks the session on every request, so access tokens that
    // are still within their 15 minutes stop working at once too (NFR-19). Any other open link is retired.
    await Promise.all([Session.deleteMany({ user: user._id }), retireOpenLinks(user._id, now)]);
    clearRefreshCookie(res);

    return res.json({ message: RESET_MESSAGES.done });
  } catch (error) {
    return next(error);
  }
});

export default router;
