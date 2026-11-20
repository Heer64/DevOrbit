import Milestone from '../models/Milestone.js';
import Task from '../models/Task.js';
import {
  DONE_STATUS,
  DUE_SOON_LIST_LIMIT,
  UPCOMING_DAYS,
  compareMilestones,
  isoDay,
  milestoneProgress,
  summarizeTaskCounts,
  upcomingWindow,
} from './dashboardRules.js';
import { daysOverdue, overdueFilter } from './healthRules.js'; // [Sprint 7 · M7] FR-15: same overdue rule as project health

/*
 * [Sprint 4 · M7] Project dashboard data (US-39, FR-15). Rules: ./dashboardRules.js.
 * [Sprint 7 · M7] FR-15 also asks for overdue tasks: open tasks whose due day has ended, using the exact
 * rule of project health (US-40, lib/healthRules.js overdueFilter / daysOverdue), so both views agree.
 * A task is never both overdue and "due in the next 7 days" (the windows meet at midnight UTC today).
 * Callers must check project membership first (routes/dashboard.js does).
 */

export const TASK_STATUSES = Task.schema.path('status').enumValues;
export const OVERDUE_LIST_LIMIT = 50;

// Task counts per milestone: Map(milestoneId -> { total, done }).
// Shared with routes/milestones.js so the Milestones tab and the dashboard agree.
export async function milestoneTaskStats(milestoneIds) {
  if (!milestoneIds.length) return new Map();
  const rows = await Task.aggregate([
    { $match: { milestone: { $in: milestoneIds } } },
    {
      $group: {
        _id: '$milestone',
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status', DONE_STATUS] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), { total: row.total, done: row.done }]));
}

// Adds taskCount, doneCount, progress (0-100) and completed to a milestone document.
export function withMilestoneStats(milestone, stats) {
  const plain = typeof milestone.toObject === 'function' ? milestone.toObject() : milestone;
  const { total = 0, done = 0 } = stats.get(plain._id.toString()) || {};
  return { ...plain, ...milestoneProgress(total, done) };
}

const shapeTask = (task) => ({
  _id: task._id,
  title: task.title,
  status: task.status,
  priority: task.priority,
  dueDate: task.dueDate,
  assignee: task.assignee ? { _id: task.assignee._id, name: task.assignee.name, username: task.assignee.username, avatarUrl: task.assignee.avatarUrl || '' } : null,
  milestone: task.milestone ? { _id: task.milestone._id, title: task.milestone.title } : null,
});

/*
 * Everything the dashboard shows for one project, calculated from the database:
 * {
 *   milestones: { total, completed, items: [{ _id, title, description, dueDate, taskCount, doneCount, progress, completed }] },
 *   tasks:      { total, open, done, byStatus: { 'To do', 'In progress', 'Blocked', 'Done' } },
 *   dueSoon:    { days, from, to, total, limit, tasks: [{ _id, title, status, priority, dueDate, assignee, milestone }] },
 *   overdue:    { total, limit, tasks: [{ _id, title, status, priority, dueDate, daysOverdue, assignee, milestone }] }  most overdue first
 *   generatedAt
 * }
 * `now` is only for tests; the route always uses the current time.
 */
export async function buildProjectDashboard(projectId, { now = new Date(), days = UPCOMING_DAYS, limit = DUE_SOON_LIST_LIMIT, overdueLimit = OVERDUE_LIST_LIMIT } = {}) {
  const window = upcomingWindow(now, days);
  const dueFilter = {
    project: projectId,
    status: { $ne: DONE_STATUS },
    dueDate: { $gte: window.from, $lt: window.until },
  };

  const lateFilter = overdueFilter(projectId, now);

  const [milestones, statusRows, dueTasks, dueTotal, lateTasks, lateTotal] = await Promise.all([
    Milestone.find({ project: projectId }).select('title description dueDate createdAt').lean(),
    Task.aggregate([
      { $match: { project: projectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Task.find(dueFilter)
      .sort({ dueDate: 1, _id: 1 })
      .limit(limit)
      .select('title status priority dueDate assignee milestone')
      .populate('assignee', 'name username avatarUrl')
      .populate('milestone', 'title')
      .lean(),
    Task.countDocuments(dueFilter),
    Task.find(lateFilter)
      .sort({ dueDate: 1, _id: 1 })
      .limit(overdueLimit)
      .select('title status priority dueDate assignee milestone')
      .populate('assignee', 'name username avatarUrl')
      .populate('milestone', 'title')
      .lean(),
    Task.countDocuments(lateFilter),
  ]);

  milestones.sort(compareMilestones);
  const stats = await milestoneTaskStats(milestones.map((m) => m._id));
  const items = milestones.map((m) => withMilestoneStats(m, stats));

  return {
    milestones: {
      total: items.length,
      completed: items.filter((m) => m.completed).length,
      items,
    },
    tasks: summarizeTaskCounts(statusRows, TASK_STATUSES),
    dueSoon: {
      days: window.days,
      from: isoDay(window.from),
      to: isoDay(window.lastDay),
      total: dueTotal,
      limit,
      tasks: dueTasks.map(shapeTask),
    },
    overdue: {
      total: lateTotal,
      limit: overdueLimit,
      tasks: lateTasks.map((task) => ({ ...shapeTask(task), daysOverdue: daysOverdue(task, now) })),
    },
    generatedAt: new Date(now).toISOString(),
  };
}
