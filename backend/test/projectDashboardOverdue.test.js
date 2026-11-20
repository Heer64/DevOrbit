// [Sprint 7 · M7] FR-15: the project dashboard also lists overdue tasks (open, due day has ended).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { setup, teardown, signup, authed } from './helpers.js';
import Task from '../src/models/Task.js';
import { buildProjectDashboard } from '../src/lib/projectDashboard.js';

let app;
let owner, viewer, outsider;
let projectId, emptyProjectId;

const as = (account) => authed(app, account.token);
const DAY_MS = 24 * 60 * 60 * 1000;

function inDays(n) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today + n * DAY_MS).toISOString().slice(0, 10);
}

async function createTask(body) {
  const res = await as(owner).post(`/api/projects/${projectId}/tasks`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.task;
}

before(async () => {
  ({ app } = await setup());
  [owner, viewer, outsider] = await Promise.all(['Dee Owner', 'Vi Viewer', 'Otto Outsider'].map((name) => signup(app, name)));
  const project = await as(owner).post('/api/projects').send({ name: 'Late Project', visibility: 'Private' });
  projectId = project.body.project._id;
  await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: viewer.user.username, role: 'Viewer' });
  emptyProjectId = (await as(owner).post('/api/projects').send({ name: 'Nothing Late' })).body.project._id;

  await createTask({ title: 'Ten days late', dueDate: inDays(-10), assignee: viewer.user.id });
  await createTask({ title: 'One day late', dueDate: inDays(-1), status: 'Blocked' });
  await createTask({ title: 'Three days late', dueDate: inDays(-3) });
  await createTask({ title: 'Late but Done', dueDate: inDays(-5), status: 'Done' });
  await createTask({ title: 'Due today', dueDate: inDays(0) });
  await createTask({ title: 'Due in 2 days', dueDate: inDays(2) });
  await createTask({ title: 'No due date' });
});

after(teardown);

test('FR-15: overdue open tasks are listed, most overdue first, with days overdue', async () => {
  const res = await as(owner).get(`/api/projects/${projectId}/dashboard`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(
    res.body.overdue.tasks.map((task) => [task.title, task.daysOverdue]),
    [
      ['Ten days late', 10],
      ['Three days late', 3],
      ['One day late', 1],
    ]
  );
  assert.equal(res.body.overdue.total, 3);
  assert.equal(res.body.overdue.limit, 50);
  const first = res.body.overdue.tasks[0];
  assert.equal(first.assignee.name, 'Vi Viewer');
  assert.equal(first.status, 'To do');
});

test('FR-15: Done tasks, today, future and undated tasks are never overdue; overdue and due soon never overlap', async () => {
  const res = await as(owner).get(`/api/projects/${projectId}/dashboard`);
  const overdue = res.body.overdue.tasks.map((task) => task.title);
  const soon = res.body.dueSoon.tasks.map((task) => task.title);
  for (const title of ['Late but Done', 'Due today', 'Due in 2 days', 'No due date']) assert.equal(overdue.includes(title), false, title);
  assert.deepEqual(soon, ['Due today', 'Due in 2 days']);
  assert.equal(overdue.filter((title) => soon.includes(title)).length, 0);
});

test('FR-15: the dashboard and project health agree on what is overdue', async () => {
  const dashboard = await as(owner).get(`/api/projects/${projectId}/dashboard`);
  const health = await as(owner).get(`/api/projects/${projectId}/health`);
  assert.equal(health.status, 200, JSON.stringify(health.body));
  assert.deepEqual(
    dashboard.body.overdue.tasks.map((task) => task.title).sort(),
    health.body.overdue.tasks.map((task) => task.title).sort()
  );
  assert.equal(dashboard.body.overdue.total, health.body.overdue.total);
});

test('FR-15: every member sees overdue tasks on the dashboard (Viewer too); outsiders get 403', async () => {
  const res = await as(viewer).get(`/api/projects/${projectId}/dashboard`);
  assert.equal(res.status, 200);
  assert.equal(res.body.overdue.total, 3);
  assert.equal((await as(outsider).get(`/api/projects/${projectId}/dashboard`)).status, 403);
});

test('FR-15: finishing an overdue task removes it from the list', async () => {
  const late = await createTask({ title: 'Finish me', dueDate: inDays(-2) });
  let res = await as(owner).get(`/api/projects/${projectId}/dashboard`);
  assert.ok(res.body.overdue.tasks.some((task) => task.title === 'Finish me'));
  await Task.updateOne({ _id: late._id }, { status: 'Done' });
  res = await as(owner).get(`/api/projects/${projectId}/dashboard`);
  assert.equal(
    res.body.overdue.tasks.some((task) => task.title === 'Finish me'),
    false
  );
});

test('FR-15: an empty project has an empty overdue list, not an error', async () => {
  const res = await as(owner).get(`/api/projects/${emptyProjectId}/dashboard`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.overdue, { total: 0, limit: 50, tasks: [] });
});

test('buildProjectDashboard: fixed clock and list limit for overdue tasks', async () => {
  const oid = new mongoose.Types.ObjectId(projectId);
  const now = new Date(Date.now() + 2 * DAY_MS); // two days later: "Due today" and earlier are now overdue
  const result = await buildProjectDashboard(oid, { now, overdueLimit: 2 });
  assert.equal(result.overdue.tasks.length, 2);
  assert.equal(result.overdue.total, 4, 'Ten, Three, One day late and Due today');
  assert.equal(result.overdue.tasks[0].title, 'Ten days late');
  assert.equal(result.overdue.tasks[0].daysOverdue, 12);
});
