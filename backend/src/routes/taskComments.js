import { Router } from 'express';

import Task from '../models/Task.js';
import TaskComment, { COMMENT_MAX } from '../models/TaskComment.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, validId } from '../lib/projectAccess.js';
import { canWriteTasks } from '../lib/permissions.js';
import { findMentionedMembers, notifyMentions } from '../lib/mentions.js';
import { taskLink } from '../lib/notifications.js';
import { emitCommentCreated } from '../lib/realtime.js';
import { logActivity, quote } from '../lib/activity.js';

/*
 * [Sprint 3 · US-20] Comment on a task.
 * Mounted at /api/projects/:id/tasks/:taskId/comments (see app.js).
 *
 * Comments are team discussion, so they are for project members only, like channels:
 * visitors of a Public project can see its tasks but not the comments.
 *
 * GET  /    members                       ?limit=100&after=<ISO date>
 *           -> { comments (oldest first), nextAfter }   pass nextAfter back as ?after= for the rest
 * POST /    Owner, Admin, Contributor     { body } -> 201 { comment }
 *           Viewers get 403 but can still read comments (US roles table: "Read ... task comments").
 *
 * Each comment: { _id, task, project, body, createdAt, author { _id, name, username, avatarUrl },
 *                 mentions [{ _id, name, username }] }
 *
 * @mentions: every current project member written as @username gets a Mention notification
 * (lib/notifications.js createNotification) that opens the task. Writing your own name does not notify you.
 * Live: 'comment:created' to members (lib/realtime.js).
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

const AUTHOR_FIELDS = 'name username avatarUrl';
const MENTION_FIELDS = 'name username';

function readLimit(raw, fallback, max) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function populated(query) {
  return query.populate('author', AUTHOR_FIELDS).populate('mentions', MENTION_FIELDS);
}

// Loads the task and checks it belongs to the project in the URL.
async function loadTask(req, res, project) {
  if (!validId(req.params.taskId)) {
    res.status(400).json({ message: 'Invalid task ID.' });
    return null;
  }
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id }).select('title project').lean();
  if (!task) {
    res.status(404).json({ message: 'Task not found.' });
    return null;
  }
  return task;
}

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const task = await loadTask(req, res, loaded.project);
    if (!task) return undefined;

    const limit = readLimit(req.query.limit, 100, 200);
    const filter = { task: task._id };

    if (req.query.after !== undefined) {
      const after = new Date(req.query.after);
      if (Number.isNaN(after.getTime())) return res.status(400).json({ message: 'Invalid "after" date.' });
      filter.createdAt = { $gt: after };
    }

    const rows = await populated(TaskComment.find(filter).sort({ createdAt: 1, _id: 1 }).limit(limit + 1)).lean();
    const comments = rows.slice(0, limit);
    const nextAfter = rows.length > limit ? comments[comments.length - 1].createdAt : null;

    return res.json({ comments, nextAfter });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    if (!canWriteTasks(loaded.role)) {
      return res.status(403).json({ message: 'Viewers can read task comments but cannot add them.' });
    }

    const task = await loadTask(req, res, loaded.project);
    if (!task) return undefined;

    const body = String(req.body.body ?? '').trim();
    if (!body) return res.status(400).json({ message: 'Comment cannot be empty.' });
    if (body.length > COMMENT_MAX) {
      return res.status(400).json({ message: `Comment must be ${COMMENT_MAX.toLocaleString('en-US')} characters or fewer.` });
    }

    const mentioned = await findMentionedMembers(loaded.project, body);

    const created = await TaskComment.create({
      project: loaded.project._id,
      task: task._id,
      author: req.user.id,
      body,
      mentions: mentioned.map((user) => user._id),
    });

    const comment = await populated(TaskComment.findById(created._id)).lean();
    emitCommentCreated(comment);

    // US-20: "that member receives a mention notification" (opens the task).
    await notifyMentions(mentioned, {
      project: loaded.project._id,
      actor: req.user.id,
      summary: `mentioned you in a comment on ${quote(task.title)}`,
      targetType: 'comment',
      targetId: created._id,
      targetLabel: task.title,
      link: taskLink(loaded.project._id, task._id),
    });

    // [US-29] 'comment.created' was reserved in the Activity Feed for this story.
    await logActivity({
      project: loaded.project._id,
      actor: req.user.id,
      type: 'comment.created',
      summary: `commented on ${quote(task.title)}: ${quote(body, 80)}`,
      targetType: 'comment',
      targetId: created._id,
      targetLabel: task.title,
      meta: { taskId: String(task._id) },
    });

    return res.status(201).json({ comment });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · US-20] What this file does
 * REST API for task comments: list a task's comments (members) and add one
 * (Owner/Admin/Contributor). @mentions of project members create Mention
 * notifications; new comments are pushed live and logged in the Activity Feed.
 * ---------------------------------------------------------------------------
 */
