// In-memory stand-in for taskApi that follows the same contract as backend/src/routes/tasks.js.
// Used for demo accounts and sample projects (no real project ID), so the Tasks tab still works offline.
// To preview the error state, run in the browser console:  localStorage.setItem('devorbit_mock_tasks', 'error')

export const MOCK_USER_ID = 'demo-you';

export const MOCK_MEMBERS = [
  { userId: MOCK_USER_ID, name: 'You', username: 'you', role: 'Owner', avatarUrl: '' },
  { userId: 'demo-riya', name: 'Riya Kapoor', username: 'riya', role: 'Admin', avatarUrl: '' },
  { userId: 'demo-nikhil', name: 'Nikhil Rao', username: 'nikhil', role: 'Contributor', avatarUrl: '' },
  { userId: 'demo-jay', name: 'Jay Shah', username: 'jay', role: 'Viewer', avatarUrl: '' },
];

const STATUSES = ['To do', 'In progress', 'Done'];
const PRIORITIES = ['Low', 'Medium', 'High'];

const SEED = [
  { title: 'Finalize dashboard information hierarchy', priority: 'Medium', status: 'Done', assignee: 'demo-riya', dueDate: '2026-10-09' },
  { title: 'Build project overview cards', priority: 'High', status: 'In progress', assignee: MOCK_USER_ID, dueDate: '2026-10-13' },
  { title: 'Connect activity feed endpoint', priority: 'High', status: 'In progress', assignee: 'demo-nikhil', dueDate: '2026-10-14' },
  { title: 'Add loading and empty states', priority: 'Low', status: 'To do', assignee: null, dueDate: '2026-10-20' },
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

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  error.response = { status, data: { message } };
  throw error;
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
      priority: 'Medium',
      assignee: null,
      dueDate: null,
      ...values,
      status,
      createdBy: person(MOCK_USER_ID),
      completedAt: status === 'Done' ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
    };
    tasksFor(projectId).unshift(task);
    return { task: clone(task) };
  },

  async update(projectId, taskId, body = {}) {
    await wait();
    const task = tasksFor(projectId).find((item) => item._id === taskId);
    if (!task) fail(404, 'Task not found.');
    const values = readInput(body, false);
    Object.assign(task, values);
    if (values.status !== undefined) task.completedAt = values.status === 'Done' ? new Date().toISOString() : null;
    return { task: clone(task) };
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
