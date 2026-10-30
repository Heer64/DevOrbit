import { Router } from 'express';

import Notification from '../models/Notification.js';
import Project from '../models/Project.js';
import { requireAuth } from '../middleware/auth.js';
import { validId } from '../lib/projectAccess.js';
import { emitNotificationRead } from '../lib/realtime.js'; // [Sprint 3 · M7 Part 2]

/*
 * [Sprint 3 · M7 Part 1] The signed-in user's own notifications, mounted at /api/notifications (US-30, FR-33).
 *
 * Every query is filtered by recipient = the caller, so nobody can list or change another
 * user's notifications. Someone else's notification ID answers 404, the same as a missing one,
 * so IDs cannot be probed.
 *
 * Only projects the caller is a member of right now count. If someone is removed from a project
 * (or leaves it), its notifications stop showing up, in the list and in unreadCount, so the old
 * summaries and links of a project they can no longer open are not exposed. The rows are kept,
 * so they come back if the person is added to the project again.
 *
 * GET   /api/notifications?limit=20&before=<ISO date>&unread=true
 *   Newest first. limit 1-50 (default 20). unread=true returns unread ones only.
 *   To load older ones, pass the returned nextBefore as ?before=.
 *   -> { notifications, nextBefore, unreadCount }
 *   Each notification has actor { _id, name, username, avatarUrl } (or null) and project { _id, name, color }.
 *
 * PATCH /api/notifications/:notificationId/read
 *   Marks one notification as read. Safe to repeat: readAt keeps the first time it was read.
 *   [M7 Part 2] The first time, the caller's other open tabs get 'notification:read' { notificationId, unreadCount }.
 *   -> { notification, unreadCount }
 */
const router = Router();
router.use(requireAuth);

const ACTOR_FIELDS = 'name username avatarUrl';
const PROJECT_FIELDS = 'name color';

function readLimit(raw, fallback, max) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

// IDs of the projects the user is a member of right now.
async function memberProjectIds(userId) {
  const projects = await Project.find({ 'members.user': userId }).select('_id').lean();
  return projects.map((project) => project._id);
}

function unreadCountFor(userId, projectIds) {
  return Notification.countDocuments({ recipient: userId, project: { $in: projectIds }, read: false });
}

router.get('/', async (req, res, next) => {
  try {
    const limit = readLimit(req.query.limit, 20, 50);
    const projectIds = await memberProjectIds(req.user.id);
    const filter = { recipient: req.user.id, project: { $in: projectIds } };

    if (req.query.unread !== undefined) {
      const unread = String(req.query.unread).toLowerCase();
      if (unread !== 'true' && unread !== 'false') {
        return res.status(400).json({ message: '"unread" must be true or false.' });
      }
      if (unread === 'true') filter.read = false;
    }

    if (req.query.before !== undefined) {
      const before = new Date(req.query.before);
      if (Number.isNaN(before.getTime())) return res.status(400).json({ message: 'Invalid "before" date.' });
      filter.createdAt = { $lt: before };
    }

    // Ask for one extra row so we know whether an older page exists.
    const [rows, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .populate('actor', ACTOR_FIELDS)
        .populate('project', PROJECT_FIELDS)
        .lean(),
      unreadCountFor(req.user.id, projectIds),
    ]);

    const notifications = rows.slice(0, limit);
    const nextBefore = rows.length > limit ? notifications[notifications.length - 1].createdAt : null;
    return res.json({ notifications, nextBefore, unreadCount });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:notificationId/read', async (req, res, next) => {
  try {
    if (!validId(req.params.notificationId)) {
      return res.status(400).json({ message: 'Invalid notification ID.' });
    }

    // A notification from a project the caller has left answers 404, like a missing one.
    const projectIds = await memberProjectIds(req.user.id);
    const owned = { _id: req.params.notificationId, recipient: req.user.id, project: { $in: projectIds } };

    // Only unread rows are changed, so repeating the call keeps the original readAt.
    const marked = await Notification.updateOne({ ...owned, read: false }, { $set: { read: true, readAt: new Date() } });

    const notification = await Notification.findOne(owned)
      .populate('actor', ACTOR_FIELDS)
      .populate('project', PROJECT_FIELDS)
      .lean();

    if (!notification) return res.status(404).json({ message: 'Notification not found.' });

    const unreadCount = await unreadCountFor(req.user.id, projectIds);
    if (marked.modifiedCount > 0) emitNotificationRead(req.user.id, notification._id, unreadCount); // [M7 Part 2]
    return res.json({ notification, unreadCount });
  } catch (error) {
    return next(error);
  }
});

export default router;
