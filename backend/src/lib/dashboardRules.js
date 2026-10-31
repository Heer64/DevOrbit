/*
 * [Sprint 4 · M7] Project dashboard rules (US-39, FR-15).
 *
 * The calculations behind the project dashboard, kept free of Express and Mongoose
 * (only ./dueDates.js, which has no imports) so they can be unit tested without a
 * database: see backend/test/dashboardRules.test.js.
 *
 * 1. Milestone progress = Done tasks / tasks attached to the milestone, rounded to a
 *    whole percent. A milestone without tasks is 0% and not completed. The Milestones
 *    tab (routes/milestones.js) uses the same function, so both always agree.
 * 2. An open task is any task whose status is not "Done" (To do, In progress, Blocked).
 * 3. "Due in the next 7 days" is an open task whose due day is today or one of the next
 *    7 days, in UTC, because due dates are stored as midnight UTC calendar days
 *    (see ./dueDates.js). On Sat 31 Oct that is 31 Oct up to and including Sat 7 Nov.
 *    The window starts exactly where isOverdue() stops, so a task is never both
 *    "overdue" (US-40, project health, M8) and "due soon" (US-39), and never neither
 *    while it has a due date within the week. Same window as GET /api/tasks/upcoming.
 */
import { DAY_MS, isOverdue, startOfUtcDay } from './dueDates.js';

export const DONE_STATUS = 'Done';
export const UPCOMING_DAYS = 7;
export const DUE_SOON_LIST_LIMIT = 50;

export function isOpenTask(task) {
  return Boolean(task) && task.status !== DONE_STATUS;
}

// Rule 1. Returns the fields the API adds to every milestone.
export function milestoneProgress(total = 0, done = 0) {
  const taskCount = Math.max(0, Number(total) || 0);
  const doneCount = Math.min(Math.max(0, Number(done) || 0), taskCount);
  return {
    taskCount,
    doneCount,
    progress: taskCount === 0 ? 0 : Math.round((doneCount / taskCount) * 100),
    completed: taskCount > 0 && doneCount === taskCount,
  };
}

/*
 * Rule 3 as a stored-dueDate range: { from, until } with `until` exclusive.
 *   from  = midnight UTC today
 *   until = midnight UTC of the day after "today + days"
 * Use as { dueDate: { $gte: from, $lt: until }, status: { $ne: 'Done' } }.
 * `days` is clamped to 1-30 (the same bounds as GET /api/tasks/upcoming).
 */
export function upcomingWindow(now = new Date(), days = UPCOMING_DAYS) {
  const span = Math.min(Math.max(Math.trunc(Number(days)) || UPCOMING_DAYS, 1), 30);
  const from = startOfUtcDay(now);
  const until = new Date(from.getTime() + (span + 1) * DAY_MS);
  return { days: span, from, until, lastDay: new Date(until.getTime() - DAY_MS) };
}

// Rule 3 for one task (used by tests and handy for the client contract).
export function isDueWithinDays(task, now = new Date(), days = UPCOMING_DAYS) {
  if (!isOpenTask(task) || !task.dueDate) return false;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const { from, until } = upcomingWindow(now, days);
  const day = startOfUtcDay(due).getTime();
  return day >= from.getTime() && day < until.getTime();
}

// Re-exported so the dashboard and project health (M8) share one overdue rule.
export { isOverdue };

/*
 * Rule 2 from per-status counts ([{ _id: status, count }], e.g. a $group result).
 * Every known status is present (0 when missing); statuses outside the list still
 * count as open, so a stray value can never hide work.
 */
export function summarizeTaskCounts(rows = [], statuses = ['To do', 'In progress', 'Blocked', DONE_STATUS]) {
  const byStatus = Object.fromEntries(statuses.map((status) => [status, 0]));
  let total = 0;
  let done = 0;
  for (const row of rows) {
    const count = Math.max(0, Number(row?.count) || 0);
    const status = row?._id ?? 'To do';
    total += count;
    if (status === DONE_STATUS) done += count;
    byStatus[status] = (byStatus[status] || 0) + count;
  }
  return { total, open: total - done, done, byStatus };
}

// Milestones in dashboard order: by due date (undated last), then by creation time.
export function compareMilestones(a, b) {
  const aDue = a?.dueDate ? new Date(a.dueDate).getTime() : null;
  const bDue = b?.dueDate ? new Date(b.dueDate).getTime() : null;
  if (aDue !== bDue) {
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    return aDue - bDue;
  }
  const aMade = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bMade = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
  return aMade - bMade;
}

// "2026-10-31" for a stored due day.
export function isoDay(value) {
  return startOfUtcDay(value).toISOString().slice(0, 10);
}
