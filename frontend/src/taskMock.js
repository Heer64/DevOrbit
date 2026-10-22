// In-memory stand-in for taskApi that follows the same contract as backend/src/routes/tasks.js.
// Used for demo accounts and sample projects (no real project ID), so the Tasks tab still works offline.
// To preview the error state, run in the browser console:  localStorage.setItem('devorbit_mock_tasks', 'error')
//
// [Pair D] Kanban demo switches (browser console):
//   localStorage.setItem('devorbit_mock_move', 'reject')     every board move fails with 500 -> card goes back + error toast
//   localStorage.setItem('devorbit_mock_move', 'conflict')   the next board move finds that "someone else" changed the
//                                                            task first -> 409 toast, card lands in the server's column
//   localStorage.removeItem('devorbit_mock_move')            back to normal

export const MOCK_USER_ID = 'demo-you';

export const MOCK_MEMBERS = [
  { userId: MOCK_USER_ID, name: 'You', username: 'you', role: 'Owner', avatarUrl: '' },
  { userId: 'demo-riya', name: 'Riya Kapoor', username: 'riya', role: 'Admin', avatarUrl: '' },
  { userId: 'demo-nikhil', name: 'Nikhil Rao', username: 'nikhil', role: 'Contributor', avatarUrl: '' },
  { userId: 'demo-jay', name: 'Jay Shah', username: 'jay', role: 'Viewer', avatarUrl: '' },
];

const STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
const PRIORITIES = ['Low', 'Medium', 'High'];

const SEED = [
  { title: 'Finalize dashboard information hierarchy', priority: 'Medium', status: 'Done', assignee: 'demo-riya', dueDate: '2026-10-09' },
  { title: 'Build project overview cards', priority: 'High', status: 'In progress', assignee: MOCK_USER_ID, dueDate: '2026-10-13' },
  { title: 'Connect activity feed endpoint', priority: 'High', status: 'In progress', assignee: 'demo-nikhil', dueDate: '2026-10-14' },
  { title: 'Add loading and empty states', priority: 'Low', status: 'To do', assignee: null, dueDate: '2026-10-20' },
  { title: 'Wait for GitHub OAuth app approval', priority: 'Medium', status: 'Blocked', assignee: 'demo-riya', dueDate: '2026-10-18' },
  { title: 'Run responsive layout checks', priority: 'Medium', status: 'To do', assignee: MOCK_USER_ID, dueDate: null },
];

const store = new Map();
let counter = 0;

const wait = (ms = 250) => new Promise((resolve) => { setTimeout(resolve, ms); });
const person = (userId) => {
  const member = MOCK_MEMBERS.find((item) => item.userId === userId);
  return member ? { _id: member.userId, name: member.name, username: member.username, avatarUrl: member.avatarUrl } : null;
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function fail(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.response = { status, data: { message, ...extra } };
  throw error;
}

// [Pair D] Same 409 body as the API: { message, task } with the latest saved task.
const CONFLICT_MESSAGE = 'This task was changed by someone else.';
const conflict = (task) => fail(409, CONFLICT_MESSAGE, { task: clone(task) });
const versionOf = (task) => (Number.isInteger(task?.version) ? task.version : 0);

// [Pair D] Stand-in for the task:updated socket event.
const listeners = new Map(); // projectId -> Set(callback)
function emitUpdated(projectId, task) {
  for (const callback of listeners.get(projectId) || []) {
    setTimeout(() => callback(clone(task)), 0);
  }
}

function moveSwitch() {
  try { return localStorage.getItem('devorbit_mock_move') || ''; } catch { return ''; }
}

function tasksFor(projectId) {
  if (!store.has(projectId)) {
    store.set(projectId, SEED.map((task, index) => ({
      _id: `mock-${projectId}-${index}`,
      project: projectId,
      description: '',
      ...task,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
      assignee: person(task.assignee),
      createdBy: person(index % 2 ? 'demo-riya' : MOCK_USER_ID),
      completedAt: task.status === 'Done' ? new Date().toISOString() : null,
      createdAt: new Date(Date.now() - index * 60000).toISOString(),
      version: 0,
    })));
  }
  return store.get(projectId);
}

// Applies the same validation as the real API. Returns the cleaned fields.
function readInput(body, creating) {
  const values = {};
  if (creating || body.title !== undefined) {
    values.title = String(body.title || '').trim();
    if (!values.title) fail(400, 'Task title is required.');
    if (values.title.length > 200) fail(400, 'Task title must be 200 characters or fewer.');
  }
  if (body.description !== undefined) values.description = String(body.description || '').trim();
  if (body.label !== undefined) {
    values.label = String(body.label || '').trim();
    if (values.label.length > 30) fail(400, 'Task label must be 30 characters or fewer.');
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) fail(400, 'Invalid task status.');
    values.status = body.status;
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) fail(400, 'Invalid task priority.');
    values.priority = body.priority;
  }
  if (body.assignee !== undefined) {
    if (!body.assignee) values.assignee = null;
    else if (!person(body.assignee)) fail(400, 'Assignee must be a member of this project.');
    else values.assignee = person(body.assignee);
  }
  if (body.dueDate !== undefined) {
    if (!body.dueDate) values.dueDate = null;
    else if (Number.isNaN(new Date(body.dueDate).getTime())) fail(400, 'Invalid due date.');
    else values.dueDate = new Date(body.dueDate).toISOString();
  }
  return values;
}

export const mockTaskApi = {
  async list(projectId, params = {}) {
    await wait();
    let forcedError = false;
    try { forcedError = localStorage.getItem('devorbit_mock_tasks') === 'error'; } catch { forcedError = false; }
    if (forcedError) fail(500, 'Mock error: the task list could not be loaded.');
    let tasks = tasksFor(projectId);
    if (params.status) tasks = tasks.filter((task) => task.status === params.status);
    if (params.assignee === 'none') tasks = tasks.filter((task) => !task.assignee);
    else if (params.assignee) {
      const wanted = params.assignee === 'me' ? MOCK_USER_ID : params.assignee;
      tasks = tasks.filter((task) => task.assignee?._id === wanted);
    }
    return { tasks: clone(tasks), membershipRole: 'Owner' };
  },

  async create(projectId, body = {}) {
    await wait();
    const values = readInput(body, true);
    const status = values.status || 'To do';
    const task = {
      _id: `mock-${projectId}-new-${(counter += 1)}`,
      project: projectId,
      description: '',
      label: '',
      priority: 'Medium',
      assignee: null,
      dueDate: null,
      ...values,
      status,
      createdBy: person(MOCK_USER_ID),
      completedAt: status === 'Done' ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
      version: 0,
    };
    tasksFor(projectId).unshift(task);
    return { task: clone(task) };
  },

  async update(projectId, taskId, body = {}) {
    await wait();
    const task = tasksFor(projectId).find((item) => item._id === taskId);
    if (!task) fail(404, 'Task not found.');
    if (body.version !== undefined && body.version !== versionOf(task)) conflict(task);
    const values = readInput(body, false);
    const changed = Object.entries(values).some(([key, value]) => JSON.stringify(task[key] ?? null) !== JSON.stringify(value ?? null));
    Object.assign(task, values);
    if (values.status !== undefined) task.completedAt = values.status === 'Done' ? new Date().toISOString() : null;
    if (changed) {
      task.version = versionOf(task) + 1;
      emitUpdated(projectId, task);
    }
    return { task: clone(task) };
  },

  // [Pair D] Same contract as GET /api/projects/:id/tasks/:taskId.
  async get(projectId, taskId) {
    await wait(100);
    const task = tasksFor(projectId).find((item) => item._id === taskId);
    if (!task) fail(404, 'Task not found.');
    return { task: clone(task) };
  },

  // [Pair D] Same contract as PATCH /api/projects/:id/tasks/:taskId/status.
  async updateStatus(projectId, taskId, { status, version } = {}) {
    await wait();
    const task = tasksFor(projectId).find((item) => item._id === taskId);
    if (!task) fail(404, 'Task not found.');
    if (!STATUSES.includes(status)) fail(400, 'Invalid task status.');
    if (!Number.isInteger(version) || version < 0) fail(400, 'Task version is required.');

    const mode = moveSwitch();
    if (mode === 'reject') fail(500, 'Mock error: the server rejected this move.');
    if (mode === 'conflict') {
      // Pretend another member moved the task to a different column just before us.
      try { localStorage.removeItem('devorbit_mock_move'); } catch { /* ignore */ }
      const others = STATUSES.filter((item) => item !== status && item !== task.status);
      task.status = others[0];
      task.completedAt = task.status === 'Done' ? new Date().toISOString() : null;
      task.version = versionOf(task) + 1;
      emitUpdated(projectId, task);
    }

    if (versionOf(task) !== version) conflict(task);
    if (task.status === status) return { task: clone(task) };

    task.status = status;
    task.completedAt = status === 'Done' ? new Date().toISOString() : null;
    task.version = versionOf(task) + 1;
    emitUpdated(projectId, task);
    return { task: clone(task) };
  },

  // [Pair D] Same contract as taskApi.subscribe (task:updated events).
  // [Sprint 2 final] Accepts onTaskDeleted like the real API; the mock has one user, so it is never called.
  subscribe(projectId, onTaskUpdated, onTaskDeleted) { // eslint-disable-line no-unused-vars
    if (!listeners.has(projectId)) listeners.set(projectId, new Set());
    listeners.get(projectId).add(onTaskUpdated);
    return () => listeners.get(projectId)?.delete(onTaskUpdated);
  },

  async remove(projectId, taskId) {
    await wait();
    const tasks = tasksFor(projectId);
    const index = tasks.findIndex((item) => item._id === taskId);
    if (index === -1) fail(404, 'Task not found.');
    tasks.splice(index, 1);
    return { message: 'Task deleted successfully.' };
  },
};
