// Pure helpers for the Kanban board (Sprint 2 Pair D). No React here, so they are easy to unit test.

// Column order. Values are the statuses the API stores (backend/src/routes/tasks.js TASK_STATUSES).
export const BOARD_STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];

// Headings shown on the board (US-27 wording).
export const COLUMN_LABELS = {
  'To do': 'To Do',
  'In progress': 'In Progress',
  Blocked: 'Blocked',
  Done: 'Done',
};

export const CONFLICT_MESSAGE = 'This task was changed by someone else.';

export const idOf = (value) => String(value?._id || value?.id || value || '');

// Tasks saved before the version field existed come back without one; they count as 0.
export const versionOf = (task) => (Number.isInteger(task?.version) ? task.version : 0);

// { 'To do': [...], 'In progress': [...], Blocked: [...], Done: [...] }, keeping the list order.
// A task with an unknown status goes to To do so it never disappears from the board.
export function groupByStatus(tasks = []) {
  const columns = Object.fromEntries(BOARD_STATUSES.map((status) => [status, []]));
  for (const task of tasks) {
    const status = BOARD_STATUSES.includes(task?.status) ? task.status : 'To do';
    columns[status].push(task);
  }
  return columns;
}

/*
 * Puts a task from the server into the list.
 *   mode 'server': an answer to our own request. Wins unless we already hold a newer version.
 *   mode 'remote': a task:updated event. Only applied when it is strictly newer, so a late
 *                  or repeated event never moves a card back.
 * A task that is not in the list yet is added at the top.
 */
export function mergeTask(list = [], incoming, mode = 'server') {
  if (!incoming) return list;
  const id = idOf(incoming);
  const index = list.findIndex((task) => idOf(task) === id);

  if (index === -1) return [incoming, ...list];

  const local = list[index];
  const newer = mode === 'remote'
    ? versionOf(incoming) > versionOf(local)
    : versionOf(incoming) >= versionOf(local);

  if (!newer) return list;

  const next = list.slice();
  next[index] = incoming;
  return next;
}

// Shows a move on screen before the server answers. The version is left alone on purpose:
// it is still the version the server has, and it is what we send with the request.
export function moveLocally(list = [], taskId, status) {
  return list.map((task) => (idOf(task) === taskId ? { ...task, status } : task));
}

// Undoes an optimistic move. If a newer version arrived meanwhile (live update), that one is kept.
export function rollback(list = [], original) {
  const id = idOf(original);
  return list.map((task) => (
    idOf(task) === id && versionOf(task) === versionOf(original) ? original : task
  ));
}
