import Activity from '../models/Activity.js';
import { emitActivityCreated } from './realtime.js'; // [US-29]

// Keeps quoted names short so one long title cannot fill the feed.
export function quote(text, max = 80) {
  const value = String(text || '').trim();
  const short = value.length > max ? `${value.slice(0, max - 1)}…` : value;
  return `"${short}"`;
}

/*
 * Records one activity event.
 *
 *   await logActivity({
 *     project: project._id,
 *     actor: req.user.id,
 *     type: 'task.created',
 *     summary: `created task ${quote(task.title)}`,
 *     targetType: 'task',
 *     targetId: task._id,
 *     targetLabel: task.title,
 *     meta: {},
 *   });
 *
 * It never throws: the feed is a side effect, so a failed write is logged
 * and the main request (creating the task, adding the member, ...) still succeeds.
 *
 * [US-29] After saving, the event is pushed live to project members as 'activity:created'.
 */
export async function logActivity({
  project,
  actor,
  type,
  summary,
  targetType = 'project',
  targetId = null,
  targetLabel = '',
  meta = {},
}) {
  let saved;
  try {
    saved = await Activity.create({
      project,
      actor,
      type,
      summary: String(summary).slice(0, 300),
      targetType,
      targetId,
      targetLabel: String(targetLabel || '').slice(0, 200),
      meta,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Could not record activity:', error.message);
    }
    return null;
  }

  // [US-29] Push it live with the actor's name, same shape as the feed API.
  try {
    const event = await Activity.findById(saved._id).populate('actor', 'name username avatarUrl').lean();
    emitActivityCreated(event || saved.toObject());
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Could not broadcast activity:', error.message);
    }
  }

  return saved;
}
