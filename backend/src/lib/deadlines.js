import Task from '../models/Task.js';
import { deadlineDedupeKey, deadlineOf, dueWithin24hRange } from './dueDates.js';

/*
 * [Sprint 3 · M5] Deadline query (US-23, FR-10).
 *
 * Finds open (not Done) tasks whose deadline is less than 24 hours away, using the rules
 * in ./dueDates.js. M7 (notifications) calls this to send the Deadline notification to
 * each assignee:
 *
 *   for (const task of await findTasksDueSoon()) {
 *     await createNotification({
 *       recipient: task.assignee._id,
 *       type: 'deadline',
 *       project: task.project._id,
 *       actor: null,
 *       summary: `${quote(task.title)} is due in less than 24 hours`,
 *       targetType: 'task',
 *       targetId: task._id,
 *       targetLabel: task.title,
 *       link: taskLink(task.project._id, task._id),
 *       dedupeKey: task.dedupeKey,   // never notifies twice for the same task and day
 *     });
 *   }
 *
 * Options
 *   now           the moment to check from (default: now). Tests pass a fixed time.
 *   projectIds    only these projects (default: all projects)
 *   assignee      only tasks assigned to this user
 *   assignedOnly  skip unassigned tasks (default true: nobody to notify)
 *   limit         at most this many tasks, soonest first (default 500)
 *
 * Each task has assignee { name, username, avatarUrl }, project { name, color },
 * deadline (end of the due day, ISO) and dedupeKey.
 */
export async function findTasksDueSoon({
  now = new Date(),
  projectIds,
  assignee,
  assignedOnly = true,
  limit = 500,
} = {}) {
  const filter = {
    status: { $ne: 'Done' },
    dueDate: dueWithin24hRange(now),
  };

  if (Array.isArray(projectIds)) filter.project = { $in: projectIds };
  if (assignee) filter.assignee = assignee;
  else if (assignedOnly) filter.assignee = { $ne: null };

  const tasks = await Task.find(filter)
    .sort({ dueDate: 1, _id: 1 })
    .limit(limit)
    .populate('assignee', 'name username avatarUrl')
    .populate('project', 'name color')
    .lean();

  return tasks.map((task) => ({
    ...task,
    deadline: deadlineOf(task.dueDate).toISOString(),
    dedupeKey: deadlineDedupeKey(task),
  }));
}
