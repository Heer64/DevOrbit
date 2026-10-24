import Notification from '../models/Notification.js';
import Project from '../models/Project.js';
import { validId } from './projectAccess.js';

/*
 * [Sprint 3 · M7 Part 1] Notification storage helpers (US-30).
 *
 * This file only stores notifications. Deciding WHEN to notify (an @mention was posted,
 * a task was assigned, a task is due within 24 hours) and pushing them live belong to
 * M7 Part 2, which calls createNotification() from those features.
 */

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

    return await Notification.create(fields);
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
