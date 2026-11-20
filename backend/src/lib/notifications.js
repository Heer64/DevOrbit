import Notification, { PERSONAL_NOTIFICATION_TYPES, PROJECTLESS_NOTIFICATION_TYPES } from '../models/Notification.js'; // [Sprint 6 · M7] + personal types
import Project from '../models/Project.js';
import { validId } from './projectAccess.js';
import { emitNotificationCreated, realtimeActive } from './realtime.js'; // [Sprint 3 · M7 Part 2]

/*
 * [Sprint 3 · M7 Part 1] Notification storage helpers (US-30).
 *
 * This file stores notifications. The features decide WHEN to notify:
 *   - @mentions: lib/mentions.js notifyMentions() (channel messages, thread replies, task comments)
 *   - assignments and deadlines: lib/taskNotifications.js (M7 Part 2)
 *
 * [Sprint 3 · M7 Part 2] Every NEW notification is also pushed live to the recipient
 * ('notification:created' in lib/realtime.js), so it appears within seconds (NFR-6).
 */

const ACTOR_FIELDS = 'name username avatarUrl';
const PROJECT_FIELDS = 'name color';

/*
 * [Sprint 3 · M7 Part 2] Unread notifications the user can see right now: only from projects
 * they are currently a member of (same rule as GET /api/notifications).
 */
export async function unreadCountFor(userId) {
  const projects = await Project.find({ 'members.user': userId }).select('_id').lean();
  // [Sprint 6 · M7] Personal notifications (moderation warning, join request outcome) count too.
  return Notification.countDocuments({ ...visibleNotificationFilter(userId, projects.map((p) => p._id)), read: false });
}

/*
 * [Sprint 6 · M7] US-56, FR-20: which of a user's notifications they may see right now.
 *   - mention / assignment / deadline: only from projects they are a member of NOW (the Sprint 3 rule, unchanged)
 *   - moderation_warning / join_approved / join_rejected: always (they are about the recipient personally)
 * Used by the list, the unread count and mark-read (routes/notifications.js) and by unreadCountFor() above.
 */
export function visibleNotificationFilter(userId, memberProjectIds = []) {
  return {
    recipient: userId,
    $or: [
      { type: { $nin: PERSONAL_NOTIFICATION_TYPES }, project: { $in: memberProjectIds } },
      { type: { $in: PERSONAL_NOTIFICATION_TYPES } },
    ],
  };
}

// Pushes a newly stored notification to the recipient's open tabs. Never throws.
async function publish(saved) {
  if (!realtimeActive()) return;
  try {
    const notification = await Notification.findById(saved._id)
      .populate('actor', ACTOR_FIELDS)
      .populate('project', PROJECT_FIELDS)
      .lean();
    if (!notification) return;
    emitNotificationCreated(notification, await unreadCountFor(notification.recipient));
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.error('Could not push notification:', error.message);
  }
}

/*
 * [Sprint 6 · M7] US-56, FR-20: store a notification that is about the recipient personally:
 *   moderation_warning   a Content Moderator warned them about their post (no project)
 *   join_approved        their join request was approved (project = that project)
 *   join_rejected        their join request was declined (project = that project; they are NOT a member)
 *   post_reply           [Sprint 7 · M3] someone commented on their post or replied to their comment (no project)
 * Unlike createNotification() there is no "must be a member" check, because these people may not be members.
 * Only these types (PERSONAL_NOTIFICATION_TYPES) are accepted. Same rules otherwise: never to the actor themselves, idempotent with a
 * dedupeKey, never throws (returns null), pushed live like every other notification.
 */
export async function createPersonalNotification({
  recipient,
  type,
  project = null,
  actor = null,
  summary,
  targetType,
  targetId,
  targetLabel = '',
  link,
  dedupeKey,
}) {
  if (!PERSONAL_NOTIFICATION_TYPES.includes(type)) return null;
  const recipientId = idString(recipient);
  const projectId = idString(project);
  const actorId = idString(actor);

  if (!validId(recipientId)) return null;
  if (!PROJECTLESS_NOTIFICATION_TYPES.includes(type) && !validId(projectId)) return null;
  if (actorId && actorId === recipientId) return null;

  const fields = {
    recipient: recipientId,
    type,
    project: validId(projectId) ? projectId : null,
    actor: actorId || null,
    summary: String(summary ?? '').slice(0, 300),
    targetType,
    targetId: idString(targetId) || null,
    targetLabel: String(targetLabel ?? '').slice(0, 200),
    link,
  };
  if (typeof dedupeKey === 'string' && dedupeKey.trim()) fields.dedupeKey = dedupeKey.trim().slice(0, 200);

  try {
    const saved = await Notification.create(fields);
    await publish(saved);
    return saved;
  } catch (error) {
    if (error?.code === 11000 && fields.dedupeKey) {
      return Notification.findOne({ recipient: recipientId, dedupeKey: fields.dedupeKey }).catch(() => null);
    }
    if (process.env.NODE_ENV !== 'test') {
      console.error('Could not store notification:', error.message);
    }
    return null;
  }
}

// In-app deep links, the same formats ProjectPage already opens (see README "Links into the project").
export function taskLink(projectId, taskId) {
  return `/project/${projectId}?tab=tasks&task=${taskId}`;
}

export function messageLink(projectId, channelId, messageId) {
  return `/project/${projectId}?tab=chat&channel=${channelId}&message=${messageId}`;
}

function idString(value) {
  return value === null || value === undefined ? '' : String(value?._id || value);
}

/*
 * Stores one notification for one recipient.
 *
 *   await createNotification({
 *     recipient: assigneeId,
 *     type: 'assignment',
 *     project: project._id,
 *     actor: req.user.id,
 *     summary: `assigned you to ${quote(task.title)}`,
 *     targetType: 'task',
 *     targetId: task._id,
 *     targetLabel: task.title,
 *     link: taskLink(project._id, task._id),
 *   });
 *
 * Rules:
 * - Only current members of the project are notified, so nobody receives details of a
 *   project they cannot open. Non-members are skipped (returns null).
 * - Nobody is notified about their own action (actor === recipient returns null).
 * - Pass dedupeKey to make it idempotent: calling again with the same recipient and key
 *   returns the notification that already exists instead of creating a second one.
 * - It never throws: notifications are a side effect, so a failed write is logged and the
 *   main request (posting the message, assigning the task, ...) still succeeds.
 * - [M7 Part 2] A newly stored notification is pushed live; an existing one returned for a
 *   repeated dedupeKey is not pushed again.
 *
 * Returns the stored notification document, or null when skipped or not saved.
 */
export async function createNotification({
  recipient,
  type,
  project,
  actor = null,
  summary,
  targetType,
  targetId,
  targetLabel = '',
  link,
  dedupeKey,
}) {
  const recipientId = idString(recipient);
  const projectId = idString(project);
  const actorId = idString(actor);

  if (!validId(recipientId) || !validId(projectId)) return null;
  if (actorId && actorId === recipientId) return null;

  const fields = {
    recipient: recipientId,
    type,
    project: projectId,
    actor: actorId || null,
    summary: String(summary ?? '').slice(0, 300),
    targetType,
    targetId: idString(targetId) || null,
    targetLabel: String(targetLabel ?? '').slice(0, 200),
    link,
  };
  if (typeof dedupeKey === 'string' && dedupeKey.trim()) fields.dedupeKey = dedupeKey.trim().slice(0, 200);

  try {
    const isMember = await Project.exists({ _id: projectId, 'members.user': recipientId });
    if (!isMember) return null;

    const saved = await Notification.create(fields);
    await publish(saved);
    return saved;
  } catch (error) {
    // Same recipient + dedupeKey already stored (also covers two requests racing): return that one.
    if (error?.code === 11000 && fields.dedupeKey) {
      return Notification.findOne({ recipient: recipientId, dedupeKey: fields.dedupeKey }).catch(() => null);
    }
    if (process.env.NODE_ENV !== 'test') {
      console.error('Could not store notification:', error.message);
    }
    return null;
  }
}
