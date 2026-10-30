import { createNotification, taskLink } from './notifications.js';
import { findTasksDueSoon } from './deadlines.js';
import { deadlineDedupeKey, isDueWithin24h } from './dueDates.js';
import { quote } from './activity.js';

/*
 * [Sprint 3 · M7 Part 2] Assignment and Deadline notifications (US-22, US-23, US-30, FR-10).
 *
 * Mention notifications are sent by lib/mentions.js (M4). This file covers the two task ones:
 *
 *   Assignment  routes/tasks.js calls notifyAssignment() when a task is created with an assignee
 *               or its assignee changes. The new assignee is told; assigning yourself tells nobody.
 *   Deadline    an open (not Done) assigned task is less than 24 hours from its deadline (rules in
 *               lib/dueDates.js). Sent straight away when a task is saved inside that window
 *               (notifyDeadlineIfDue), and by a check that runs every few minutes for tasks that
 *               enter the window as time passes (startDeadlineNotifier, started by server.js).
 *
 * All of them go through createNotification() (M7 Part 1), so only current project members are
 * notified, nothing ever throws into the request, and every new notification is pushed live.
 *
 * Duplicates
 *   Assignment  dedupeKey 'assignment:<taskId>:v<version>'. Task.version goes up on every saved change,
 *               so a retried request cannot notify twice, while a later re-assignment notifies again.
 *   Deadline    M5's deadlineDedupeKey(task) = 'deadline:<taskId>:<due day>': one per assignee, task and
 *               due day, however often the check runs. Moving the due date gives a new key.
 */

function idOf(value) {
  return value === null || value === undefined ? null : String(value?._id || value);
}

/*
 * The task's assignee changed (or a task was created with one): tell the new assignee.
 *   previousAssignee  the assignee before the change (id or null); null for a new task.
 */
export async function notifyAssignment({ task, project, actor, previousAssignee = null }) {
  const assignee = idOf(task?.assignee);
  if (!assignee || assignee === idOf(previousAssignee)) return null;

  const projectId = idOf(project) || idOf(task.project);
  return createNotification({
    recipient: assignee,
    type: 'assignment',
    project: projectId,
    actor,
    summary: `assigned you to ${quote(task.title)}`,
    targetType: 'task',
    targetId: task._id,
    targetLabel: task.title,
    link: taskLink(projectId, task._id),
    dedupeKey: `assignment:${task._id}:v${task.version ?? 0}`,
  });
}

function deadlineFields(task, projectId) {
  return {
    recipient: idOf(task.assignee),
    type: 'deadline',
    project: projectId,
    actor: null,
    summary: `${quote(task.title)} is due in less than 24 hours`,
    targetType: 'task',
    targetId: task._id,
    targetLabel: task.title,
    link: taskLink(projectId, task._id),
    dedupeKey: task.dedupeKey || deadlineDedupeKey(task),
  };
}

/*
 * A task was saved (created, edited, moved on the board). If it is assigned, not Done and now
 * less than 24 hours from its deadline, the assignee gets the Deadline notification at once,
 * instead of waiting for the next periodic check.
 */
export async function notifyDeadlineIfDue({ task, project, now = new Date() }) {
  if (!task?.assignee || !isDueWithin24h(task, now)) return null;
  return createNotification(deadlineFields(task, idOf(project) || idOf(task.project)));
}

/*
 * One pass of the periodic check: every open, assigned task due within 24 hours.
 * Safe to run as often as needed; the dedupeKey keeps it to one notification per task and day.
 * Returns { checked } (how many tasks were in the window).
 */
export async function sendDeadlineNotifications({ now = new Date() } = {}) {
  const tasks = await findTasksDueSoon({ now });
  for (const task of tasks) {
    // findTasksDueSoon populates project and assignee; deadlineFields reads their ids.
    await createNotification(deadlineFields(task, idOf(task.project)));
  }
  return { checked: tasks.length };
}

export const DEADLINE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

let timer = null;
let running = false;

async function runCheck() {
  if (running) return; // a slow pass is never overlapped by the next one
  running = true;
  try {
    await sendDeadlineNotifications();
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.error('Deadline check failed:', error.message);
  } finally {
    running = false;
  }
}

/*
 * Starts the periodic Deadline check (called once by server.js after MongoDB is connected).
 * Runs once straight away, then every intervalMs. The timer does not keep the process alive.
 */
export function startDeadlineNotifier({ intervalMs = DEADLINE_CHECK_INTERVAL_MS } = {}) {
  if (timer) return;
  runCheck();
  timer = setInterval(runCheck, intervalMs);
  timer.unref?.();
}

export function stopDeadlineNotifier() {
  if (timer) clearInterval(timer);
  timer = null;
}
