import { Router } from 'express';

import Project from '../models/Project.js';
import Task from '../models/Task.js';
import { requireAuth } from '../middleware/auth.js';

/*
 * Personal task views for the dashboard, mounted at /api/tasks (Sprint 2 leftovers).
 * Every query is limited to projects the caller is a member of, so tasks from a project
 * they left, or a private project they never joined, are never returned.
 *
 * GET /api/tasks/upcoming?days=7&limit=20   (US-23)
 *   Open (not Done) tasks with a due date from today up to N days ahead, soonest first.
 *   days: 1-30 (default 7). "Today" starts at midnight UTC, because due dates are stored
 *   as midnight UTC by the task form. Overdue tasks are not included.
 *   -> { tasks, days }
 *
 * GET /api/tasks/mine?limit=8
 *   Open tasks assigned to the caller, soonest due first (tasks without a due date last).
 *   -> { tasks, total }
 *
 * GET /api/tasks/stats
 *   -> { completedLast7Days, openAssignedToMe }
 *   completedLast7Days counts tasks marked Done in the last 7 days across the caller's projects.
 *
 * Each task has assignee populated and project { _id, name, color }.
 */
const router = Router();
router.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;
const ASSIGNEE_FIELDS = 'name username avatarUrl';

function readInt(raw, fallback, min, max) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function startOfTodayUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function myProjectIds(userId) {
  const projects = await Project.find({ 'members.user': userId }).select('_id').lean();
  return projects.map((project) => project._id);
}

router.get('/upcoming', async (req, res, next) => {
  try {
    const days = readInt(req.query.days, 7, 1, 30);
    const limit = readInt(req.query.limit, 20, 1, 50);
    const projectIds = await myProjectIds(req.user.id);

    if (projectIds.length === 0) return res.json({ tasks: [], days });

    const from = startOfTodayUtc();
    // "Within the next N days": today plus N more days, up to the end of that day.
    const until = new Date(from.getTime() + (days + 1) * DAY_MS);

    const tasks = await Task.find({
      project: { $in: projectIds },
      status: { $ne: 'Done' },
      dueDate: { $gte: from, $lt: until },
    })
      .sort({ dueDate: 1, _id: 1 })
      .limit(limit)
      .populate('assignee', ASSIGNEE_FIELDS)
      .populate('project', 'name color')
      .lean();

    return res.json({ tasks, days });
  } catch (error) {
    return next(error);
  }
});

router.get('/mine', async (req, res, next) => {
  try {
    const limit = readInt(req.query.limit, 8, 1, 50);
    const projectIds = await myProjectIds(req.user.id);

    if (projectIds.length === 0) return res.json({ tasks: [], total: 0 });

    const filter = { project: { $in: projectIds }, assignee: req.user.id, status: { $ne: 'Done' } };
    const [dated, total] = await Promise.all([
      Task.find(filter)
        .sort({ dueDate: 1, updatedAt: -1 })
        .limit(200)
        .populate('assignee', ASSIGNEE_FIELDS)
        .populate('project', 'name color')
        .lean(),
      Task.countDocuments(filter),
    ]);

    // MongoDB sorts missing due dates first; show dated tasks first, undated after.
    const tasks = [
      ...dated.filter((task) => task.dueDate),
      ...dated.filter((task) => !task.dueDate),
    ].slice(0, limit);

    return res.json({ tasks, total });
  } catch (error) {
    return next(error);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const projectIds = await myProjectIds(req.user.id);

    if (projectIds.length === 0) return res.json({ completedLast7Days: 0, openAssignedToMe: 0 });

    const since = new Date(Date.now() - 7 * DAY_MS);
    const [completedLast7Days, openAssignedToMe] = await Promise.all([
      Task.countDocuments({ project: { $in: projectIds }, status: 'Done', completedAt: { $gte: since } }),
      Task.countDocuments({ project: { $in: projectIds }, assignee: req.user.id, status: { $ne: 'Done' } }),
    ]);

    return res.json({ completedLast7Days, openAssignedToMe });
  } catch (error) {
    return next(error);
  }
});

export default router;
