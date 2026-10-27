/*
 * [Sprint 3 · M5] "Due today" / "due tomorrow" on task rows and Kanban cards (US-23).
 *
 * The API stores a due date as a calendar day at midnight UTC ("2026-10-28T00:00:00.000Z",
 * see backend/src/lib/dueDates.js). The day itself is read in UTC (formatDue in TasksPanel
 * and KanbanBoard), so nobody west of UTC sees 27 Oct. "Today", "tomorrow" and "overdue"
 * compare that day with the viewer's own calendar day, the same rule isOverdue() in
 * TasksPanel / KanbanBoard and dueLabel() in DashboardTasks already use.
 *
 * Every function takes an optional `now` so tests can pin the clock (and the timezone,
 * with process.env.TZ).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days from the viewer's today to the due day: 0 today, 1 tomorrow, -1 yesterday.
export function daysUntilDue(value, now = new Date()) {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueDay - today) / DAY_MS);
}

// 'none' | 'done' | 'overdue' | 'today' | 'tomorrow' | 'later'
export function dueState(task, now = new Date()) {
  const days = daysUntilDue(task?.dueDate, now);
  if (days === null) return 'none';
  if (task.status === 'Done') return 'done';
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return 'later';
}

// Text added after the day for open tasks due today or tomorrow, otherwise ''.
export function dueSoonSuffix(task, now = new Date()) {
  const state = dueState(task, now);
  if (state === 'today') return ' · due today';
  if (state === 'tomorrow') return ' · due tomorrow';
  return '';
}
