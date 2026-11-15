import jwt from 'jsonwebtoken';
import Session from '../models/Session.js';
import User from '../models/User.js'; // [Sprint 6 · M8] US-57, US-58
import { PLATFORM_MESSAGES, normalizePlatformRole } from '../lib/platformRoleRules.js'; // [Sprint 6 · M8]

export async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) return res.status(401).json({ message: 'Authentication required.' });

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (!claims.id || !claims.sid) {
      return res.status(401).json({ message: 'Invalid session. Please log in again.' });
    }

    // A server-side session check allows logout to revoke outstanding access tokens immediately.
    // [Sprint 6 · M8] The account is read on every request too (in parallel, by _id), so a role change or a
    // suspension applies to the user's next request (US-57 AC1/AC2, US-58 AC1). The token carries neither.
    const [session, account] = await Promise.all([
      Session.findOne({
        _id: claims.sid,
        user: claims.id,
        expiresAt: { $gt: new Date() },
      }).select('_id'),
      User.findById(claims.id).select('platformRole suspendedAt').lean(),
    ]);

    if (!session) return res.status(401).json({ message: 'Session expired or revoked. Please log in again.' });
    // [Sprint 6 · M8] A removed account, or a suspended one, cannot use a session it still has (US-58 AC1).
    if (!account) return res.status(401).json({ message: 'Session expired or revoked. Please log in again.' });
    if (account.suspendedAt) {
      return res.status(401).json({ message: PLATFORM_MESSAGES.accountSuspended, code: 'account_suspended' });
    }

    req.user = {
      id: claims.id,
      email: claims.email,
      sessionId: claims.sid,
      platformRole: normalizePlatformRole(account.platformRole), // [Sprint 6 · M8] from the database, never the token
    };
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired session.' });
    }
    return next(error);
  }
}
