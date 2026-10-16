import Activity from '../models/Activity.js';

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
  try {
    return await Activity.create({
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
}
