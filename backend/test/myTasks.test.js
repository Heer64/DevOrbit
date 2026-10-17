// Sprint 2 leftovers: dashboard task views (GET /api/tasks/upcoming, /mine, /stats). US-23.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';
import Task from '../src/models/Task.js';

let app;
let owner, member, outsider;
let projectId, otherProjectId;

const as = (account) => authed(app, account.token);
const DAY_MS = 24 * 60 * 60 * 1000;

// Date-only strings, the same format the task form sends (stored as midnight UTC).
function inDays(n) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today + n * DAY_MS).toISOString().slice(0, 10);
}

async function createTask(account, project, body) {
  const res = await as(account).post(`/api/projects/${project}/tasks`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.task;
}

const titles = (res) => res.body.tasks.map((task) => task.title);

before(async () => {
  ({ app } = await setup());

  [owner, member, outsider] = await Promise.all(
    ['Dana Owner', 'Mo Member', 'Ola Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Dashboard Project', visibility: 'Private' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;

  const added = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: member.user.username, role: 'Contributor' });
  assert.equal(added.status, 201, JSON.stringify(added.body));

  // A project only the outsider belongs to.
  const other = await as(outsider).post('/api/projects').send({ name: 'Outsider Project', visibility: 'Public' });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  otherProjectId = other.body.project._id;

  await createTask(owner, projectId, { title: 'Due in 3 days', dueDate: inDays(3), assignee: member.user.id });
  await createTask(owner, projectId, { title: 'Due today', dueDate: inDays(0) });
  await createTask(owner, projectId, { title: 'Due in 6 days', dueDate: inDays(6), assignee: member.user.id });
  await createTask(owner, projectId, { title: 'Due in 20 days', dueDate: inDays(20) });
  await createTask(owner, projectId, { title: 'Overdue', dueDate: inDays(-2), assignee: member.user.id });
  await createTask(owner, projectId, { title: 'No due date', assignee: member.user.id });
  await createTask(owner, projectId, { title: 'Done but due soon', dueDate: inDays(1), status: 'Done', assignee: member.user.id });
  await createTask(outsider, otherProjectId, { title: 'Outsider task due tomorrow', dueDate: inDays(1), assignee: outsider.user.id });
});

after(teardown);

test('US-23 upcoming: open tasks due in the next 7 days, soonest first', async () => {
  const res = await as(owner).get('/api/tasks/upcoming');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.days, 7);
  assert.deepEqual(titles(res), ['Due today', 'Due in 3 days', 'Due in 6 days']);

  const first = res.body.tasks[1];
  assert.equal(first.project.name, 'Dashboard Project');
  assert.ok(first.project.color, 'project color is included');
  assert.equal(first.assignee.name, 'Mo Member');
});

test('US-23 upcoming: Done tasks and overdue tasks are excluded', async () => {
  const res = await as(owner).get('/api/tasks/upcoming?days=30');
  assert.ok(!titles(res).includes('Done but due soon'));
  assert.ok(!titles(res).includes('Overdue'));
  assert.ok(!titles(res).includes('No due date'));
  assert.ok(titles(res).includes('Due in 20 days'));
});

test('US-23 upcoming: days is capped at 30 and has a minimum of 1', async () => {
  const capped = await as(owner).get('/api/tasks/upcoming?days=999');
  assert.equal(capped.body.days, 30);

  const minimum = await as(owner).get('/api/tasks/upcoming?days=0');
  assert.equal(minimum.body.days, 1);
  assert.deepEqual(titles(minimum), ['Due today']);
});

test('US-23 upcoming: only tasks from your own projects', async () => {
  const ownerView = await as(owner).get('/api/tasks/upcoming');
  assert.ok(!titles(ownerView).includes('Outsider task due tomorrow'));

  const outsiderView = await as(outsider).get('/api/tasks/upcoming');
  assert.deepEqual(titles(outsiderView), ['Outsider task due tomorrow']);
});

test('upcoming: a user with no projects gets an empty list', async () => {
  const loner = await signup(app, 'Lou Loner');
  const res = await as(loner).get('/api/tasks/upcoming');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.tasks, []);
});

test('mine: open tasks assigned to me, dated first, undated last', async () => {
  const res = await as(member).get('/api/tasks/mine');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(titles(res), ['Overdue', 'Due in 3 days', 'Due in 6 days', 'No due date']);
  assert.equal(res.body.total, 4);

  const limited = await as(member).get('/api/tasks/mine?limit=2');
  assert.equal(limited.body.tasks.length, 2);
  assert.equal(limited.body.total, 4);
});

test('stats: tasks completed in the last 7 days and my open tasks', async () => {
  const before = await as(member).get('/api/tasks/stats');
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.deepEqual(before.body, { completedLast7Days: 1, openAssignedToMe: 4 });

  // An old completion does not count.
  const old = await createTask(owner, projectId, { title: 'Finished long ago', status: 'Done' });
  await Task.updateOne({ _id: old._id }, { completedAt: new Date(Date.now() - 10 * DAY_MS) });

  const after = await as(member).get('/api/tasks/stats');
  assert.deepEqual(after.body, { completedLast7Days: 1, openAssignedToMe: 4 });
});

test('a member who leaves a project no longer sees its tasks', async () => {
  const leaver = await signup(app, 'Lee Leaver');
  const added = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: leaver.user.username, role: 'Contributor' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  await createTask(owner, projectId, { title: 'Leaver task', dueDate: inDays(2), assignee: leaver.user.id });

  assert.ok(titles(await as(leaver).get('/api/tasks/mine')).includes('Leaver task'));

  const left = await as(leaver).delete(`/api/projects/${projectId}/members/${leaver.user.id}`);
  assert.equal(left.status, 200, JSON.stringify(left.body));

  assert.deepEqual(titles(await as(leaver).get('/api/tasks/mine')), []);
  assert.deepEqual(titles(await as(leaver).get('/api/tasks/upcoming')), []);
  assert.equal((await as(leaver).get('/api/tasks/stats')).body.openAssignedToMe, 0);
});

test('the dashboard task endpoints need a signed-in user', async () => {
  const { default: request } = await import('supertest');
  for (const path of ['/api/tasks/upcoming', '/api/tasks/mine', '/api/tasks/stats']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 401, `${path}: ${JSON.stringify(res.body)}`);
  }
});
