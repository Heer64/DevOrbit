import { Router } from 'express';

import Activity from '../models/Activity.js';
import Project from '../models/Project.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';

const ACTOR_FIELDS = 'name username avatarUrl';

function readLimit(raw, fallback, max) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

/*
 * Project feed, mounted at /api/projects/:id/activity
 *
 * GET /api/projects/:id/activity?limit=30&before=<ISO date>
 * Members only (the feed names people, so visitors of a public project do not get it).
 * Newest first. To load older events, pass the returned nextBefore as ?before=.
 */
export const projectActivityRoutes = Router({ mergeParams: true });
projectActivityRoutes.use(requireAuth);

projectActivityRoutes.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    const limit = readLimit(req.query.limit, 30, 100);
    const filter = { project: loaded.project._id };

    if (req.query.before !== undefined) {
      const before = new Date(req.query.before);
      if (Number.isNaN(before.getTime())) return res.status(400).json({ message: 'Invalid "before" date.' });
      filter.createdAt = { $lt: before };
    }

    // Ask for one extra row so we know whether an older page exists.
    const rows = await Activity.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('actor', ACTOR_FIELDS)
      .lean();

    const activity = rows.slice(0, limit);
    const nextBefore = rows.length > limit ? activity[activity.length - 1].createdAt : null;
    return res.json({ activity, nextBefore });
  } catch (error) {
    return next(error);
  }
});

/*
 * Personal feed, mounted at /api/activity
 *
 * GET /api/activity/me?limit=10
 * The latest events across every project the caller is a member of.
 * Each event includes project { _id, name, color } so the dashboard can link to it.
 */
export const myActivityRoutes = Router();
myActivityRoutes.use(requireAuth);

myActivityRoutes.get('/me', async (req, res, next) => {
  try {
    const limit = readLimit(req.query.limit, 10, 50);
    const projects = await Project.find({ 'members.user': req.user.id }).select('_id').lean();

    if (projects.length === 0) return res.json({ activity: [] });

    const activity = await Activity.find({ project: { $in: projects.map((p) => p._id) } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .populate('actor', ACTOR_FIELDS)
      .populate('project', 'name color')
      .lean();

    return res.json({ activity });
  } catch (error) {
    return next(error);
  }
});
