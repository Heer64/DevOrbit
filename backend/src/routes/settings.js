/*
 * [Sprint 7 · M5] Account settings (logged in). Mounted at /api/settings.
 *
 *   POST /api/settings/password  { currentPassword, newPassword }
 *     200 { message, signedOutSessions }   password changed; every OTHER session ended, this one stays
 *     400 { message, code? }               missing/invalid fields, new = current, or
 *                                          code 'current_password_wrong' when the old password is not right
 *     429 { message }                      too many wrong attempts (per account, 15 minutes)
 *
 * A wrong current password answers 400, not 401: the frontend treats 401 as "your session ended" and would
 * sign the user out for a typo.
 *
 * Privacy switches and the theme need no new routes: privacy is still PATCH /api/profile/me (US-07) and the
 * theme is a per-device choice kept in the browser (frontend/src/context/ThemeContext.jsx).
 * Rules and messages: lib/passwordChangeRules.js.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import Session from '../models/Session.js';
import PasswordResetToken from '../models/PasswordResetToken.js';
import { requireAuth } from '../middleware/auth.js';
import { disconnectOtherSessions } from '../lib/realtime.js';
import {
  PASSWORD_CHANGE_MESSAGES,
  changePasswordProblem,
  currentPasswordWorthChecking,
  passwordChangedMessage,
} from '../lib/passwordChangeRules.js';

const router = Router();
router.use(requireAuth);

// Guessing the old password from a stolen, still-open session: at most 10 wrong tries per account in 15 minutes.
// Counted per account (not per IP) and only for failed requests. Off in tests, like the other limiters.
const wrongPasswordLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `password-change:${req.user.id}`,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: PASSWORD_CHANGE_MESSAGES.tooMany },
});

router.post('/password', wrongPasswordLimiter, async (req, res, next) => {
  try {
    // Shape checks first (nothing stored is read yet).
    const problem = changePasswordProblem(req.body);
    if (problem) return res.status(400).json({ message: problem });
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const currentIsRight = currentPasswordWorthChecking(currentPassword) && (await bcrypt.compare(currentPassword, user.passwordHash));
    if (!currentIsRight) {
      return res.status(400).json({ message: PASSWORD_CHANGE_MESSAGES.currentWrong, code: 'current_password_wrong' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12); // NFR-3a, same cost as sign-up and reset
    await user.save();

    // Every other session ends at once: requireAuth checks the session on each request, so their access tokens
    // stop working too, and their refresh cookies no longer match anything. This session stays.
    // An emailed reset link that is still open is retired as well (it was asked for with the old password).
    const now = new Date();
    const [ended] = await Promise.all([
      Session.deleteMany({ user: user._id, _id: { $ne: req.user.sessionId } }),
      PasswordResetToken.updateMany({ user: user._id, usedAt: null }, { $set: { usedAt: now } }),
    ]);
    // Their open live connections (other browsers) are closed too; reconnecting is refused without a session.
    await disconnectOtherSessions(user._id, req.user.sessionId).catch(() => {});

    const signedOutSessions = ended.deletedCount || 0;
    return res.json({ message: passwordChangedMessage(signedOutSessions), signedOutSessions });
  } catch (error) {
    return next(error);
  }
});

export default router;
