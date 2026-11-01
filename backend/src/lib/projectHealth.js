import Activity from '../models/Activity.js';
import Task from '../models/Task.js';
import {
  ACTIVITY_DAYS,
  HEALTH_LIST_LIMIT,
  HIGH_ABOVE,
  MEDIUM_FROM,
  activityLevel,
  activitySince,
  blockedFilter,
  daysOverdue,
  overdueFilter,
} from './healthRules.js';

/*
 * [Sprint 4 · M8] Project health data (US-40, FR-22). Rules: ./healthRules.js.
 * Callers must check the caller's role first (routes/health.js does).
 * Read-only: it never changes tasks or activity.
 */

const shapeTask = (task, now) => ({
  _id: task._id,
  title: task.title,
  status: task.status,
  label: task.label || '',
  priority: task.priority,
  dueDate: task.dueDate,
  daysOverdue: daysOverdue(task, now),
  assignee: task.assignee
    ? { _id: task.assignee._id, name: task.assignee.name, username: task.assignee.username, avatarUrl: task.assignee.avatarUrl || '' }
    : null,
});

const TASK_FIELDS = 'title status label priority dueDate assignee';

/*
 * {
 *   overdue:  { total, limit, tasks: [{ _id, title, status, label, priority, dueDate, daysOverdue, assignee }] },
 *   blocked:  { total, limit, tasks: [ same shape ] },
 *   activity: { days: 7, since, count, level: 'Low' | 'Medium' | 'High', thresholds: { mediumFrom: 5, highAbove: 20 } },
 *   generatedAt
 * }
 * `now` is only for tests; the route always uses the current time.
 */
export async function buildProjectHealth(projectId, { now = new Date(), limit = HEALTH_LIST_LIMIT } = {}) {
  const overdue = overdueFilter(projectId, now);
  const blocked = blockedFilter(projectId);
  const since = activitySince(now, ACTIVITY_DAYS);
  const activityQuery = { project: projectId, createdAt: { $gte: since, $lte: new Date(now) } };

  const [overdueTasks, overdueTotal, blockedTasks, blockedTotal, eventCount] = await Promise.all([
    Task.find(overdue)
      .sort({ dueDate: 1, _id: 1 }) // most overdue first
      .limit(limit)
      .select(TASK_FIELDS)
      .populate('assignee', 'name username avatarUrl')
      .lean(),
    Task.countDocuments(overdue),
    Task.find(blocked)
      .sort({ updatedAt: -1, _id: 1 })
      .limit(limit)
      .select(TASK_FIELDS)
      .populate('assignee', 'name username avatarUrl')
      .lean(),
    Task.countDocuments(blocked),
    Activity.countDocuments(activityQuery),
  ]);

  return {
    overdue: { total: overdueTotal, limit, tasks: overdueTasks.map((task) => shapeTask(task, now)) },
    blocked: { total: blockedTotal, limit, tasks: blockedTasks.map((task) => shapeTask(task, now)) },
    activity: {
      days: ACTIVITY_DAYS,
      since: since.toISOString(),
      count: eventCount,
      level: activityLevel(eventCount),
      thresholds: { mediumFrom: MEDIUM_FROM, highAbove: HIGH_ABOVE },
    },
    generatedAt: new Date(now).toISOString(),
  };
}
