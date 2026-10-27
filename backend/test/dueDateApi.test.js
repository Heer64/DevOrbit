// [Sprint 3 · M5] Task due dates through the API (US-23): edit, clear, display data,
// and the "due within 24 hours, not Done" deadline query that M7 uses for notifications.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';
import Task from '../src/models/Task.js';
import { findTasksDueSoon } from '../src/lib/deadlines.js';
import { DUE_DATE_FORMAT_MESSAGE, DUE_DATE_RANGE_MESSAGE } from '../src/lib/dueDates.js';

let app;
let owner, contributor, viewer, outsider;
let projectId, otherProjectId;

const as = (account) => authed(app, account.token);
const tasksUrl = () => `/api/projects/${projectId}/tasks`;
const DAY_MS = 24 * 60 * 60 * 1000;
const titles = (list) => list.map((task) => task.title);

// Date-only strings, the format the task form sends.
function inDays(n) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today + n * DAY_MS).toISOString().slice(0, 10);
}

async function createTask(account, body, project = projectId) {
  const res = await as(account).post(`/api/projects/${project}/tasks`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.task;
}

before(async () => {
  ({ app } = await setup());

  [owner, contributor, viewer, outsider] = await Promise.all(
    ['Dee Owner', 'Cal Contributor', 'Vic Viewer', 'Oz Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Deadlines Project', visibility: 'Private' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;

  for (const [account, role] of [[contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const other = await as(outsider).post('/api/projects').send({ name: 'Other Project', visibility: 'Public' });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  otherProjectId = other.body.project._id;
});

after(teardown);

/* ---------- set, edit, clear ---------- */

test('US-23: a Contributor sets a due date; it is stored and returned as midnight UTC', async () => {
  const task = await createTask(contributor, { title: 'Write report', dueDate: '2026-11-20' });
  assert.equal(task.dueDate, '2026-11-20T00:00:00.000Z');

  const read = await as(viewer).get(`${tasksUrl()}/${task._id}`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.task.dueDate, '2026-11-20T00:00:00.000Z', 'every member sees the same day');

  const list = await as(viewer).get(tasksUrl());
  assert.equal(list.body.tasks.find((t) => t._id === task._id).dueDate, '2026-11-20T00:00:00.000Z');
});

test('US-23: editing the due date bumps the version, logs the new day and can be cleared', async () => {
  const task = await createTask(contributor, { title: 'Plan demo' });
  assert.equal(task.dueDate, null);

  const set = await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ dueDate: '2026-12-01', version: 0 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.task.dueDate, '2026-12-01T00:00:00.000Z');
  assert.equal(set.body.task.version, 1);

  // Sending back what the API returned (a midnight-UTC timestamp) changes nothing.
  const same = await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ dueDate: set.body.task.dueDate });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.equal(same.body.task.version, 1, 'same day again is not a change');

  const cleared = await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ dueDate: null });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.task.dueDate, null);
  assert.equal(cleared.body.task.version, 2);

  await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ dueDate: '2026-12-05' });
  const emptyString = await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ dueDate: '' });
  assert.equal(emptyString.body.task.dueDate, null, "'' also clears it (an emptied date field)");

  const feed = await as(owner).get(`/api/projects/${projectId}/activity?limit=10`);
  const summaries = feed.body.activity.filter((event) => event.targetLabel === 'Plan demo').map((event) => event.summary);
  assert.ok(summaries.includes('set the due date of "Plan demo" to Dec 1, 2026'), JSON.stringify(summaries));
  assert.ok(summaries.includes('removed the due date of "Plan demo"'), JSON.stringify(summaries));
});

test('US-23: bad due dates answer 400 on create and edit, and nothing is saved', async () => {
  const bad = [
    ['not-a-date', DUE_DATE_FORMAT_MESSAGE],
    ['2026-10-28T00:00:00+05:30', DUE_DATE_FORMAT_MESSAGE], // local midnight in India
    ['2026-02-30', 'Invalid due date.'],
    ['1999-12-31', DUE_DATE_RANGE_MESSAGE],
  ];
  for (const [dueDate, message] of bad) {
    const res = await as(contributor).post(tasksUrl()).send({ title: `Bad ${dueDate}`, dueDate });
    assert.equal(res.status, 400, dueDate);
    assert.equal(res.body.message, message, dueDate);
  }
  assert.equal(await Task.countDocuments({ title: /^Bad / }), 0);

  const task = await createTask(contributor, { title: 'Keep my date', dueDate: '2026-11-15' });
  const res = await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ dueDate: '15/11/2026' });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  const stored = await Task.findById(task._id).lean();
  assert.equal(stored.dueDate.toISOString(), '2026-11-15T00:00:00.000Z');
});

test('US-23: a leap day is a valid due date', async () => {
  const task = await createTask(contributor, { title: 'Leap day', dueDate: '2028-02-29' });
  assert.equal(task.dueDate, '2028-02-29T00:00:00.000Z');
});

test('US-23: Viewers cannot change a due date', async () => {
  const task = await createTask(contributor, { title: 'Viewer cannot touch', dueDate: '2026-11-15' });
  const res = await as(viewer).patch(`${tasksUrl()}/${task._id}`).send({ dueDate: '2026-11-16' });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

/* ---------- deadline query: "due within 24 hours, not Done" ---------- */

test('US-23 deadline query: exact 24-hour boundaries with a fixed clock', async () => {
  // A project of its own so the other tests' tasks do not interfere.
  const project = await as(owner).post('/api/projects').send({ name: 'Boundary Project', visibility: 'Private' });
  const boundaryId = project.body.project._id;
  await as(owner).post(`/api/projects/${boundaryId}/members`).send({ identifier: contributor.user.username, role: 'Contributor' });

  const assignee = contributor.user.id;
  await createTask(owner, { title: 'Due 10 Nov', dueDate: '2031-11-10', assignee }, boundaryId);
  await createTask(owner, { title: 'Due 11 Nov', dueDate: '2031-11-11', assignee }, boundaryId);
  await createTask(owner, { title: 'Due 9 Nov', dueDate: '2031-11-09', assignee }, boundaryId);
  await createTask(owner, { title: 'Done 10 Nov', dueDate: '2031-11-10', assignee, status: 'Done' }, boundaryId);
  await createTask(owner, { title: 'Blocked 10 Nov', dueDate: '2031-11-10', assignee, status: 'Blocked' }, boundaryId);
  await createTask(owner, { title: 'Unassigned 10 Nov', dueDate: '2031-11-10' }, boundaryId);
  await createTask(owner, { title: 'No date', assignee }, boundaryId);

  const dueAt = async (now, options = {}) =>
    titles(await findTasksDueSoon({ now: new Date(now), projectIds: [boundaryId], ...options })).sort();

  // Deadline of "Due 10 Nov" is 11 Nov 00:00 UTC.
  assert.deepEqual(await dueAt('2031-11-09T23:59:59.999Z'), ['Due 9 Nov']);
  assert.deepEqual(await dueAt('2031-11-10T00:00:00.000Z'), [], 'exactly 24 h away is not "less than 24 hours"');
  assert.deepEqual(await dueAt('2031-11-10T00:00:00.001Z'), ['Blocked 10 Nov', 'Due 10 Nov']);
  assert.deepEqual(await dueAt('2031-11-10T23:59:59.999Z'), ['Blocked 10 Nov', 'Due 10 Nov']);
  assert.deepEqual(await dueAt('2031-11-11T00:00:00.000Z'), [], 'deadline passed: overdue, not due soon');
  assert.deepEqual(await dueAt('2031-11-11T12:00:00.000Z'), ['Due 11 Nov']);

  // 15:30 on 10 Nov in India is 10:00 UTC.
  assert.deepEqual(await dueAt('2031-11-10T15:30:00+05:30'), ['Blocked 10 Nov', 'Due 10 Nov']);

  // Unassigned tasks are left out by default (no one to notify) but can be included.
  assert.deepEqual(
    await dueAt('2031-11-10T12:00:00.000Z', { assignedOnly: false }),
    ['Blocked 10 Nov', 'Due 10 Nov', 'Unassigned 10 Nov'],
  );

  const [first] = await findTasksDueSoon({ now: new Date('2031-11-10T12:00:00.000Z'), projectIds: [boundaryId] });
  assert.equal(first.deadline, '2031-11-11T00:00:00.000Z');
  assert.equal(first.dedupeKey, `deadline:${first._id}:2031-11-10T00:00:00.000Z`);
  assert.equal(first.assignee.name, 'Cal Contributor');
  assert.equal(first.project.name, 'Boundary Project');
});

test('US-23 deadline query: marking a task Done or moving its date takes it out', async () => {
  const task = await createTask(contributor, { title: 'Finish soon', dueDate: '2031-11-10', assignee: contributor.user.id });
  const now = new Date('2031-11-10T08:00:00.000Z');
  const query = async () => titles(await findTasksDueSoon({ now, projectIds: [projectId] }));

  assert.ok((await query()).includes('Finish soon'));

  await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ dueDate: '2031-11-12' });
  assert.ok(!(await query()).includes('Finish soon'), 'moved to a later day');

  await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ dueDate: '2031-11-10' });
  assert.ok((await query()).includes('Finish soon'));

  await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ status: 'Done' });
  assert.ok(!(await query()).includes('Finish soon'), 'Done tasks are never due soon');
});

test('GET /api/tasks/due-soon: my open tasks due within 24 hours, only from my projects', async () => {
  await createTask(owner, { title: 'Mine today', dueDate: inDays(0), assignee: contributor.user.id });
  await createTask(owner, { title: 'Mine tomorrow', dueDate: inDays(1), assignee: contributor.user.id });
  await createTask(owner, { title: 'Mine yesterday', dueDate: inDays(-1), assignee: contributor.user.id });
  await createTask(owner, { title: 'Mine today but Done', dueDate: inDays(0), assignee: contributor.user.id, status: 'Done' });
  await createTask(owner, { title: 'Owner today', dueDate: inDays(0), assignee: owner.user.id });
  await createTask(outsider, { title: 'Outsider today', dueDate: inDays(0), assignee: outsider.user.id }, otherProjectId);

  const res = await as(contributor).get('/api/tasks/due-soon');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.windowHours, 24);
  assert.deepEqual(titles(res.body.tasks), ['Mine today']);
  assert.equal(res.body.tasks[0].project.name, 'Deadlines Project');
  assert.ok(res.body.tasks[0].deadline, 'deadline is included');

  const outsiderView = await as(outsider).get('/api/tasks/due-soon');
  assert.deepEqual(titles(outsiderView.body.tasks), ['Outsider today']);

  const loner = await signup(app, 'Lo Loner');
  const empty = await as(loner).get('/api/tasks/due-soon');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.tasks, []);

  const anonymous = await (await import('supertest')).default(app).get('/api/tasks/due-soon');
  assert.equal(anonymous.status, 401);
});
