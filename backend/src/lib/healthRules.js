/*
 * [Sprint 4 · M8] Project health rules (US-40, FR-22).
 *
 * Pure rules, kept free of Express and Mongoose (only ./dueDates.js, which has no imports)
 * so they can be unit tested without a database: see backend/test/healthRules.test.js.
 *
 * The rules
 * 1. Overdue = has a due date, the due day has ended (UTC) and the task is not Done.
 *    This is isOverdue() from ./dueDates.js, the same rule the dashboard (US-39, M7) uses,
 *    so a task is never both "overdue" here and "due in the next 7 days" there.
 * 2. Blocked = the task's status is "Blocked" OR its label is "Blocked" (any letter case,
 *    spaces trimmed). The user story says "labelled Blocked" and FR-22 says "status Blocked";
 *    this app has both a Blocked status and a free-text label, so both count. A task that is
 *    already Done is not blocking anything and is left out.
 * 3. Activity level = activity feed events in the last 7 days (rolling 7 x 24 h):
 *      Low    fewer than 5
 *      Medium 5 to 20 (both included)
 *      High   more than 20
 */
import { DAY_MS, isOverdue } from './dueDates.js';

export const DONE_STATUS = 'Done';
export const BLOCKED = 'Blocked';
export const ACTIVITY_DAYS = 7;
export const MEDIUM_FROM = 5; // 5 events -> Medium
export const HIGH_ABOVE = 20; // 21 events -> High
export const HEALTH_LIST_LIMIT = 50;

export { isOverdue };

export function isBlocked(task) {
  if (!task || task.status === DONE_STATUS) return false;
  if (task.status === BLOCKED) return true;
  return String(task.label || '').trim().toLowerCase() === BLOCKED.toLowerCase();
}

// Rule 3.
export function activityLevel(count) {
  const n = Math.max(0, Math.trunc(Number(count)) || 0);
  if (n < MEDIUM_FROM) return 'Low';
  if (n <= HIGH_ABOVE) return 'Medium';
  return 'High';
}

// Start of the rolling 7-day window.
export function activitySince(now = new Date(), days = ACTIVITY_DAYS) {
  return new Date(new Date(now).getTime() - days * DAY_MS);
}

/*
 * Rule 1 as a MongoDB condition: a task is overdue when dueDate + 1 day <= now,
 * i.e. dueDate <= now - 1 day (due dates are stored as midnight UTC).
 */
export function overdueFilter(projectId, now = new Date()) {
  return {
    project: projectId,
    status: { $ne: DONE_STATUS },
    dueDate: { $ne: null, $lte: new Date(new Date(now).getTime() - DAY_MS) },
  };
}

// Rule 2 as a MongoDB condition.
export function blockedFilter(projectId) {
  return {
    project: projectId,
    status: { $ne: DONE_STATUS },
    $or: [{ status: BLOCKED }, { label: /^\s*blocked\s*$/i }],
  };
}

// Whole days a task is past its due day (1 = the due day was yesterday).
export function daysOverdue(task, now = new Date()) {
  if (!isOverdue(task, now)) return 0;
  const due = new Date(task.dueDate);
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.max(1, Math.round((today - dueDay) / DAY_MS));
}
