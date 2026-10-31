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

/*
 * [Sprint 4 · M7] Project dashboard data (US-39, FR-15). Rules: ./dashboardRules.js.
 * Callers must check project membership first (routes/dashboard.js does).
 */

export const TASK_STATUSES = Task.schema.path('status').enumValues;

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
 *   generatedAt
 * }
 * `now` is only for tests; the route always uses the current time.
 */
export async function buildProjectDashboard(projectId, { now = new Date(), days = UPCOMING_DAYS, limit = DUE_SOON_LIST_LIMIT } = {}) {
  const window = upcomingWindow(now, days);
  const dueFilter = {
    project: projectId,
    status: { $ne: DONE_STATUS },
    dueDate: { $gte: window.from, $lt: window.until },
  };

  const [milestones, statusRows, dueTasks, dueTotal] = await Promise.all([
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
    generatedAt: new Date(now).toISOString(),
  };
}
