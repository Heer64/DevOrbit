import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { requireAuth } from '../middleware/auth.js';
import { recordSuccessfulLogin } from '../lib/catchUpRules.js'; // [Sprint 6 · M5] US-44
import { PLATFORM_MESSAGES, normalizePlatformRole } from '../lib/platformRoleRules.js'; // [Sprint 6 · M8] US-57, US-58

const router = Router();
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_SESSION_DAYS = 7;
const REFRESH_COOKIE = 'devorbit_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
}

/*
 * [Sprint 6 · M1] US-04: a password reset ends every session, so it also drops this browser's refresh cookie.
 * [Sprint 7 · M5] O9: the ONLY place that clears the refresh cookie. Express 4.21 deprecates passing maxAge (or
 * expires) to res.clearCookie ("res.clearCookie: Passing "options.maxAge" is deprecated") and Express 5 ignores
 * it. Worse, in Express 4 a maxAge overrides the "already expired" date, so the browser kept an empty cookie for
 * 7 days instead of deleting it. Same name, path, httpOnly, secure and sameSite as when it was set, and no maxAge.
 */
export function refreshCookieClearOptions() {
  const { maxAge: _maxAge, expires: _expires, ...options } = cookieOptions();
  return options;
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieClearOptions());
}

function readRefreshCookie(req) {
  const header = req.headers.cookie || '';
  const part = header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${REFRESH_COOKIE}=`));
  return part ? decodeURIComponent(part.slice(REFRESH_COOKIE.length + 1)) : null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function makeAccessToken(user, sessionId) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, sid: sessionId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    email: user.email,
    bio: user.bio || '',
    headline: user.headline || '',
    avatarUrl: user.avatarUrl || '',
    skills: user.skills || [],
    githubUrl: user.githubUrl || '',
    linkedinUrl: user.linkedinUrl || '',
    focus: user.focus || '',
    exploring: user.exploring || '',
    openTo: user.openTo || '',
    profileDiscoverable: user.profileDiscoverable !== false,
    portfolioPublic: user.portfolioPublic !== false,
    // [Sprint 6 · M8] US-57: lets the app show the Admin panel (and M7's moderator queue) link. Only a hint for the
    // screen: every admin and moderator route checks the role again on the server (middleware/platformRoles.js).
    platformRole: normalizePlatformRole(user.platformRole),
  };
}

function createUsernameBase(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 22) || 'developer';
}

async function uniqueUsername(name) {
  const base = createUsernameBase(name);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = crypto.randomBytes(2).toString('hex');
    const username = `${base.slice(0, 25)}${suffix}`.slice(0, 30);
    if (!(await User.exists({ username }))) return username;
  }
  throw Object.assign(new Error('Could not generate a unique username. Please try again.'), { status: 503 });
}

async function startSession(user, res) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_SESSION_DAYS * 24 * 60 * 60 * 1000);
  const session = await Session.create({ user: user._id, tokenHash: hashToken(refreshToken), expiresAt });
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  return { accessToken: makeAccessToken(user, session._id), user: publicUser(user) };
}

router.post('/signup', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!name || !email || !password) return res.status(400).json({ message: 'Name, email, and password are required.' });
    if (name.length > 80) return res.status(400).json({ message: 'Name must be 80 characters or fewer.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    if (password.length > 128) return res.status(400).json({ message: 'Password must be 128 characters or fewer.' });
    if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists.' });

    const user = await User.create({
      name,
      email,
      username: await uniqueUsername(name),
      passwordHash: await bcrypt.hash(password, 12),
      lastLoginAt: new Date(), // [Sprint 6 · M5] US-44: signing up is the first login
    });
    return res.status(201).json(await startSession(user, res));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'An account with that email or username already exists. Please try again.' });
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

    const user = await User.findOne({ email }).select('+passwordHash +loginFailedAttempts +loginLockedUntil +lastLoginAt +previousLoginAt');
    if (!user) return res.status(401).json({ message: 'Invalid email or password.' });

    // Migrate development accounts created before username became part of the profile schema.
    if (!user.username) {
      user.username = await uniqueUsername(user.name);
      await user.save();
    }

    if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
      const seconds = Math.ceil((user.loginLockedUntil.getTime() - Date.now()) / 1000);
      return res.status(423).json({ message: `Too many failed attempts. Try again in about ${Math.ceil(seconds / 60)} minute(s).` });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      user.loginFailedAttempts = (user.loginFailedAttempts || 0) + 1;
      if (user.loginFailedAttempts >= MAX_LOGIN_FAILURES) {
        user.loginFailedAttempts = 0;
        user.loginLockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
      }
      await user.save();
      if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
        return res.status(423).json({ message: 'Too many failed attempts. Login is locked for 15 minutes.' });
      }
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // [Sprint 6 · M8] US-58 AC1: a suspended account cannot log in. Checked only after the right password, so the
    // answer never tells a stranger whether an e-mail belongs to a suspended account. Not a successful login (US-44).
    if (user.suspendedAt) {
      return res.status(403).json({ message: PLATFORM_MESSAGES.accountSuspended, code: 'account_suspended' });
    }

    user.loginFailedAttempts = 0;
    user.loginLockedUntil = null;
    recordSuccessfulLogin(user); // [Sprint 6 · M5] US-44: Catch Me Up starts from the login before this one
    await user.save();
    return res.json(await startSession(user, res));
  } catch (error) {
    return next(error);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = readRefreshCookie(req);
    if (!refreshToken) return res.status(401).json({ message: 'No active session.' });

    const session = await Session.findOne({
      tokenHash: hashToken(refreshToken),
      expiresAt: { $gt: new Date() },
    }).select('+tokenHash');

    if (!session) {
      clearRefreshCookie(res); // [Sprint 7 · M5] O9
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    const user = await User.findById(session.user);
    if (!user) {
      await Session.deleteOne({ _id: session._id });
      clearRefreshCookie(res); // [Sprint 7 · M5] O9
      return res.status(401).json({ message: 'User account no longer exists.' });
    }
    // [Sprint 6 · M8] US-58 AC1: suspending deletes the sessions, so this is only a safety net (e.g. a login that
    // finished at the same moment as the suspension). The session ends here and no new token is issued.
    if (user.suspendedAt) {
      await Session.deleteOne({ _id: session._id });
      clearRefreshCookie(res); // [Sprint 7 · M5] O9
      return res.status(403).json({ message: PLATFORM_MESSAGES.accountSuspended, code: 'account_suspended' });
    }

    // Rotate the opaque refresh token on every successful refresh.
    const newRefreshToken = crypto.randomBytes(48).toString('base64url');
    session.tokenHash = hashToken(newRefreshToken);
    session.expiresAt = new Date(Date.now() + REFRESH_SESSION_DAYS * 24 * 60 * 60 * 1000);
    session.lastUsedAt = new Date();
    await session.save();
    res.cookie(REFRESH_COOKIE, newRefreshToken, cookieOptions());

    return res.json({ accessToken: makeAccessToken(user, session._id), user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = readRefreshCookie(req);
    if (refreshToken) await Session.deleteOne({ tokenHash: hashToken(refreshToken) });
    clearRefreshCookie(res); // [Sprint 7 · M5] O9: same options as every other clear
    return res.json({ message: 'Logged out successfully.' });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

export default router;
