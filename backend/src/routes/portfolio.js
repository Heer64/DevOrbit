import { Router } from 'express';

import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { NOT_AVAILABLE_MESSAGE, buildPortfolio, readUsername } from '../lib/portfolio.js';

/*
 * [Sprint 5 · M5] US-49 Generate my portfolio (FR-21, NFR-12). Rules: lib/portfolio.js.
 *
 * Mounted at /api/portfolio (login required):
 *   GET /me   -> { user, projects, totals, statsUpdatedAt, isPublic, sharePath }
 *             Always available to its owner, public or not. Each project has _id, name, description,
 *             domain, tags, visibility, isPrivate, role, completedAt and
 *             stats { tasksCompleted, decisionsRecorded, messagesPosted, computedAt }.
 *
 * Mounted at /api/public/portfolio (no login, AC3 "anyone with the link"):
 *   GET /:username -> { user, projects, totals, statsUpdatedAt }   read-only
 *             404 { message: "This portfolio is not available." } when the user does not exist OR
 *             turned their portfolio off (portfolioPublic = false). Same answer for both, so the
 *             link does not reveal whether an account exists.
 *             Never includes email, project IDs, other members, or the name/description of a
 *             Private project.
 *
 * The portfolio on/off switch is User.portfolioPublic (privacy settings: Sprint 5 · M3, US-07).
 */

export const portfolioRoutes = Router();
portfolioRoutes.use(requireAuth);

portfolioRoutes.get('/me', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('name username headline avatarUrl portfolioPublic').lean();
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const portfolio = await buildPortfolio(user);
    return res.json({
      ...portfolio,
      isPublic: user.portfolioPublic !== false,
      sharePath: `/portfolio/${encodeURIComponent(user.username)}`,
    });
  } catch (error) {
    return next(error);
  }
});

export const publicPortfolioRoutes = Router();

publicPortfolioRoutes.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

publicPortfolioRoutes.get('/:username', async (req, res, next) => {
  try {
    const username = readUsername(req.params.username);
    if (!username) return res.status(404).json({ message: NOT_AVAILABLE_MESSAGE });
    const user = await User.findOne({ username }).select('name username headline avatarUrl portfolioPublic').lean();
    if (!user || user.portfolioPublic === false) return res.status(404).json({ message: NOT_AVAILABLE_MESSAGE });
    return res.json(await buildPortfolio(user, { publicView: true }));
  } catch (error) {
    return next(error);
  }
});
