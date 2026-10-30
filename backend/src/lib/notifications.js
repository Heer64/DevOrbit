import Notification from '../models/Notification.js';
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
  return Notification.countDocuments({ recipient: userId, project: { $in: projects.map((p) => p._id) }, read: false });
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
