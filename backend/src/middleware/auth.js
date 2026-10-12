import jwt from 'jsonwebtoken';
import Session from '../models/Session.js';

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
    const session = await Session.findOne({
      _id: claims.sid,
      user: claims.id,
      expiresAt: { $gt: new Date() },
    }).select('_id');

    if (!session) return res.status(401).json({ message: 'Session expired or revoked. Please log in again.' });

    req.user = { id: claims.id, email: claims.email, sessionId: claims.sid };
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired session.' });
    }
    return next(error);
  }
}
