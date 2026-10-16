import { Router } from 'express';
import Milestone from '../models/Milestone.js';
import Task from '../models/Task.js';
import { requireAuth } from '../middleware/auth.js';
import { canManageMilestones } from '../lib/permissions.js';
import { loadProjectForMember, loadProjectForViewer, validId } from '../lib/projectAccess.js';
import { logActivity, quote } from '../lib/activity.js';

// Mounted at /api/projects/:id/milestones
const router = Router({ mergeParams: true });
router.use(requireAuth);

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 1000;

// Parses "dueDate" from a request body.
// Returns { ok: true, value } where value is a Date, null (cleared) or undefined (not sent).
function parseDueDate(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === '') return { ok: true, value: null };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, value: date };
}

// Task counts per milestone: Map(milestoneId -> { total, done }).
async function taskStats(milestoneIds) {
  if (milestoneIds.length === 0) return new Map();
  const rows = await Task.aggregate([
    { $match: { milestone: { $in: milestoneIds } } },
    {
      $group: {
        _id: '$milestone',
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status', 'Done'] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), { total: row.total, done: row.done }]));
}

// Adds taskCount, doneCount, progress (0-100) and completed to each milestone.
function withStats(milestone, stats) {
  const plain = typeof milestone.toObject === 'function' ? milestone.toObject() : milestone;
  const { total = 0, done = 0 } = stats.get(plain._id.toString()) || {};
  return {
    ...plain,
    taskCount: total,
    doneCount: done,
    progress: total === 0 ? 0 : Math.round((done / total) * 100),
    completed: total > 0 && done === total,
  };
}

// Checks the caller may change milestones. Responds itself and returns null when they may not.
async function loadForManager(req, res) {
  const loaded = await loadProjectForMember(req, res);
  if (!loaded) return null;
  if (!canManageMilestones(loaded.role)) {
    res.status(403).json({ message: 'Only project Owners and Admins can manage milestones.' });
    return null;
  }
  return loaded;
}

async function findMilestone(req, res, project) {
  if (!validId(req.params.milestoneId)) {
    res.status(400).json({ message: 'Invalid milestone ID.' });
    return null;
  }
  const milestone = await Milestone.findOne({ _id: req.params.milestoneId, project: project._id });
  if (!milestone) {
    res.status(404).json({ message: 'Milestone not found.' });
    return null;
  }
  return milestone;
}

/*
 * GET /api/projects/:id/milestones
 * Members, and visitors of a Public project, can read.
 * Sorted by due date (milestones without one go last), then by creation time.
 */
router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForViewer(req, res);
    if (!loaded) return undefined;

    const milestones = await Milestone.find({ project: loaded.project._id })
      .sort({ createdAt: 1 })
      .lean();

    milestones.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });

    const stats = await taskStats(milestones.map((m) => m._id));
    return res.json({
      milestones: milestones.map((m) => withStats(m, stats)),
      membershipRole: loaded.role,
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * POST /api/projects/:id/milestones
 * Body: { title, description?, dueDate? }. Owner and Admin only.
 */
router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadForManager(req, res);
    if (!loaded) return undefined;
    const { project } = loaded;

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    if (!title) return res.status(400).json({ message: 'Milestone title is required.' });
    if (title.length > TITLE_MAX) return res.status(400).json({ message: `Milestone title must be ${TITLE_MAX} characters or fewer.` });
    if (description.length > DESCRIPTION_MAX) return res.status(400).json({ message: `Milestone description must be ${DESCRIPTION_MAX.toLocaleString('en-US')} characters or fewer.` });

    const due = parseDueDate(req.body.dueDate);
    if (!due.ok) return res.status(400).json({ message: 'Invalid due date.' });

    const milestone = await Milestone.create({
      project: project._id,
      title,
      description,
      dueDate: due.value ?? null,
      createdBy: req.user.id,
    });

    await logActivity({
      project: project._id,
      actor: req.user.id,
      type: 'milestone.created',
      summary: `created milestone ${quote(milestone.title)}`,
      targetType: 'milestone',
      targetId: milestone._id,
      targetLabel: milestone.title,
    });

    return res.status(201).json({ milestone: withStats(milestone, new Map()) });
  } catch (error) {
    return next(error);
  }
});

/*
 * PATCH /api/projects/:id/milestones/:milestoneId
 * Body: any of { title, description, dueDate }. Owner and Admin only.
 */
router.patch('/:milestoneId', async (req, res, next) => {
  try {
    const loaded = await loadForManager(req, res);
    if (!loaded) return undefined;
    const { project } = loaded;

    const milestone = await findMilestone(req, res, project);
    if (!milestone) return undefined;

    const changed = [];
    if (req.body.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) return res.status(400).json({ message: 'Milestone title is required.' });
      if (title.length > TITLE_MAX) return res.status(400).json({ message: `Milestone title must be ${TITLE_MAX} characters or fewer.` });
      if (title !== milestone.title) changed.push('title');
      milestone.title = title;
    }
    if (req.body.description !== undefined) {
      const description = String(req.body.description || '').trim();
      if (description.length > DESCRIPTION_MAX) return res.status(400).json({ message: `Milestone description must be ${DESCRIPTION_MAX.toLocaleString('en-US')} characters or fewer.` });
      if (description !== milestone.description) changed.push('description');
      milestone.description = description;
    }
    const due = parseDueDate(req.body.dueDate);
    if (!due.ok) return res.status(400).json({ message: 'Invalid due date.' });
    if (due.value !== undefined) {
      const before = milestone.dueDate ? milestone.dueDate.getTime() : null;
      const after = due.value ? due.value.getTime() : null;
      if (before !== after) changed.push('due date');
      milestone.dueDate = due.value;
    }

    await milestone.save();

    if (changed.length) {
      await logActivity({
        project: project._id,
        actor: req.user.id,
        type: 'milestone.updated',
        summary: `updated the ${changed.join(', ')} of milestone ${quote(milestone.title)}`,
        targetType: 'milestone',
        targetId: milestone._id,
        targetLabel: milestone.title,
        meta: { fields: changed },
      });
    }

    const stats = await taskStats([milestone._id]);
    return res.json({ milestone: withStats(milestone, stats) });
  } catch (error) {
    return next(error);
  }
});

/*
 * DELETE /api/projects/:id/milestones/:milestoneId
 * Owner and Admin only. Tasks are kept; they are simply detached from the milestone.
 */
router.delete('/:milestoneId', async (req, res, next) => {
  try {
    const loaded = await loadForManager(req, res);
    if (!loaded) return undefined;
    const { project } = loaded;

    const milestone = await findMilestone(req, res, project);
    if (!milestone) return undefined;

    const detached = await Task.updateMany(
      { project: project._id, milestone: milestone._id },
      { $set: { milestone: null } }
    );
    await Milestone.deleteOne({ _id: milestone._id });

    await logActivity({
      project: project._id,
      actor: req.user.id,
      type: 'milestone.deleted',
      summary: `deleted milestone ${quote(milestone.title)}`,
      targetType: 'milestone',
      targetId: milestone._id,
      targetLabel: milestone.title,
    });

    return res.json({
      message: 'Milestone deleted.',
      detachedTasks: detached.modifiedCount ?? 0,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

