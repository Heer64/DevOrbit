// [Sprint 4 · M8] US-40: GET /api/projects/:id/health (overdue tasks, blocked tasks, activity level).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { setup, teardown, signup, authed } from './helpers.js';
import Activity from '../src/models/Activity.js';
import Task from '../src/models/Task.js';
import { buildProjectHealth } from '../src/lib/projectHealth.js';
import {
  activityLevel,
  daysOverdue,
  isBlocked,
  isOverdue,
} from '../src/lib/healthRules.js';

let app;
let owner, admin, contributor, viewer, outsider;
let projectId, otherProjectId, quietProjectId;

const as = (account) => authed(app, account.token);
const url = (id = projectId) => `/api/projects/${id}/health`;
const DAY_MS = 24 * 60 * 60 * 1000;

function inDays(n) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today + n * DAY_MS).toISOString().slice(0, 10);
}

async function createTask(project, body) {
  const res = await as(owner).post(`/api/projects/${project}/tasks`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.task;
}

// Writes `count` feed events directly, `ageDays` days ago.
async function addEvents(project, count, ageDays = 0) {
  const createdAt = new Date(Date.now() - ageDays * DAY_MS);
  const docs = Array.from({ length: count }, (_, i) => ({
    project, actor: owner.user.id, type: 'task.updated', summary: `test event ${i}`, createdAt,
  }));
  // insertMany keeps the given createdAt (timestamps only fill it when missing).
  await Activity.collection.insertMany(docs.map((doc) => ({
    ...doc, project: new mongoose.Types.ObjectId(String(project)), actor: new mongoose.Types.ObjectId(owner.user.id), targetType: 'project', targetLabel: '', meta: {},
  })));
}

const titles = (list) => list.tasks.map((task) => task.title).sort();

before(async () => {
  ({ app } = await setup());
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Hal Owner', 'Ana Admin', 'Carl Contributor', 'Vera Viewer', 'Ozzy Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Health Project', visibility: 'Private' });
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  otherProjectId = (await as(owner).post('/api/projects').send({ name: 'Other' })).body.project._id;
  quietProjectId = (await as(owner).post('/api/projects').send({ name: 'Quiet' })).body.project._id;

  // Overdue: past due day and not Done.
  await createTask(projectId, { title: 'Overdue 3 days', dueDate: inDays(-3), assignee: contributor.user.id });
  await createTask(projectId, { title: 'Overdue yesterday', status: 'In progress', dueDate: inDays(-1) });
  // Overdue AND blocked: shows in both lists.
  await createTask(projectId, { title: 'Overdue blocked', status: 'Blocked', dueDate: inDays(-2) });
  // Not overdue.
  await createTask(projectId, { title: 'Due today', dueDate: inDays(0) });
  await createTask(projectId, { title: 'Due tomorrow', dueDate: inDays(1) });
  await createTask(projectId, { title: 'Done late', status: 'Done', dueDate: inDays(-5) });
  await createTask(projectId, { title: 'No due date' });
  // Blocked by status or by label.
  await createTask(projectId, { title: 'Blocked status', status: 'Blocked' });
  await createTask(projectId, { title: 'Blocked label', label: 'Blocked' });
  await createTask(projectId, { title: 'Blocked label lower', label: ' blocked ' });
  // Not blocked.
  await createTask(projectId, { title: 'Done but labelled blocked', status: 'Done', label: 'Blocked' });
  await createTask(projectId, { title: 'Label mentions blocker', label: 'Blocker' });
  // Another project's overdue/blocked task never shows.
  await createTask(otherProjectId, { title: 'Other overdue', status: 'Blocked', dueDate: inDays(-4) });
});

after(teardown);

// ---- Pure rules ----------------------------------------------------------------------------

test('rules: activity level boundaries (Low < 5, Medium 5-20, High > 20)', () => {
  assert.equal(activityLevel(0), 'Low');
  assert.equal(activityLevel(4), 'Low');
  assert.equal(activityLevel(5), 'Medium');
  assert.equal(activityLevel(20), 'Medium');
  assert.equal(activityLevel(21), 'High');
  assert.equal(activityLevel(-3), 'Low');
  assert.equal(activityLevel('x'), 'Low');
});

test('rules: blocked = status Blocked or label "Blocked", never Done', () => {
  assert.equal(isBlocked({ status: 'Blocked' }), true);
  assert.equal(isBlocked({ status: 'To do', label: 'Blocked' }), true);
  assert.equal(isBlocked({ status: 'In progress', label: '  BLOCKED ' }), true);
  assert.equal(isBlocked({ status: 'Done', label: 'Blocked' }), false);
  assert.equal(isBlocked({ status: 'To do', label: 'Blocker' }), false);
  assert.equal(isBlocked({ status: 'To do' }), false);
  assert.equal(isBlocked(null), false);
});

test('rules: overdue = due day has ended and not Done; days overdue', () => {
  const now = new Date('2026-11-01T10:00:00Z');
  assert.equal(isOverdue({ status: 'To do', dueDate: '2026-10-31T00:00:00.000Z' }, now), true);
  assert.equal(isOverdue({ status: 'To do', dueDate: '2026-11-01T00:00:00.000Z' }, now), false, 'due today is not overdue yet');
  assert.equal(isOverdue({ status: 'Done', dueDate: '2026-10-20T00:00:00.000Z' }, now), false);
  assert.equal(daysOverdue({ status: 'To do', dueDate: '2026-10-29T00:00:00.000Z' }, now), 3);
  assert.equal(daysOverdue({ status: 'To do', dueDate: '2026-11-03T00:00:00.000Z' }, now), 0);
});

// ---- API -----------------------------------------------------------------------------------

test('access: 401, 400, 404; Contributors, Viewers and outsiders get 403', async () => {
  assert.equal((await request(app).get(url())).status, 401);
  assert.equal((await as(owner).get(url('nope'))).status, 400);
  assert.equal((await as(owner).get(url('0123456789abcdef01234567'))).status, 404);
  for (const account of [contributor, viewer, outsider]) {
    assert.equal((await as(account).get(url())).status, 403);
  }
});

test('Owner and Admin can open project health', async () => {
  for (const account of [owner, admin]) {
    const res = await as(account).get(url());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.project.name, 'Health Project');
  }
});

test('lists overdue tasks (past due, not Done), most overdue first', async () => {
  const res = await as(owner).get(url());
  assert.deepEqual(titles(res.body.overdue), ['Overdue 3 days', 'Overdue blocked', 'Overdue yesterday']);
  assert.equal(res.body.overdue.total, 3);
  assert.equal(res.body.overdue.tasks[0].title, 'Overdue 3 days');
  assert.equal(res.body.overdue.tasks[0].daysOverdue, 3);
  assert.equal(res.body.overdue.tasks[0].assignee.name, 'Carl Contributor');
});

test('lists blocked tasks (status or label Blocked, not Done)', async () => {
  const res = await as(owner).get(url());
  assert.deepEqual(titles(res.body.blocked), ['Blocked label', 'Blocked label lower', 'Blocked status', 'Overdue blocked']);
  assert.equal(res.body.blocked.total, 4);
});

test('lists update when a task is finished', async () => {
  const task = await Task.findOne({ project: projectId, title: 'Overdue yesterday' });
  const res = await as(owner).patch(`/api/projects/${projectId}/tasks/${task._id}`).send({ status: 'Done', version: task.version });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const health = await as(owner).get(url());
  assert.ok(!titles(health.body.overdue).includes('Overdue yesterday'));
});

test('activity level: Low, Medium, High from events in the last 7 days only', async () => {
  // The quiet project has only its "project.created" event.
  let res = await as(owner).get(url(quietProjectId));
  assert.equal(res.body.activity.count, 1);
  assert.equal(res.body.activity.level, 'Low');
  assert.equal(res.body.activity.days, 7);
  assert.deepEqual(res.body.activity.thresholds, { mediumFrom: 5, highAbove: 20 });

  await addEvents(quietProjectId, 30, 8); // older than 7 days: ignored
  await addEvents(quietProjectId, 3, 1); // 1 + 3 = 4
  res = await as(owner).get(url(quietProjectId));
  assert.equal(res.body.activity.count, 4);
  assert.equal(res.body.activity.level, 'Low');

  await addEvents(quietProjectId, 1, 6); // 5
  res = await as(owner).get(url(quietProjectId));
  assert.equal(res.body.activity.level, 'Medium');

  await addEvents(quietProjectId, 15, 2); // 20
  res = await as(owner).get(url(quietProjectId));
  assert.equal(res.body.activity.count, 20);
  assert.equal(res.body.activity.level, 'Medium');

  await addEvents(quietProjectId, 1, 0); // 21
  res = await as(owner).get(url(quietProjectId));
  assert.equal(res.body.activity.level, 'High');
});

test('empty project: empty lists, Low activity', async () => {
  const health = await buildProjectHealth(new mongoose.Types.ObjectId());
  assert.deepEqual(health.overdue, { total: 0, limit: 50, tasks: [] });
  assert.deepEqual(health.blocked, { total: 0, limit: 50, tasks: [] });
  assert.equal(health.activity.level, 'Low');
});

test('lists are capped but totals are exact', async () => {
  const health = await buildProjectHealth(new mongoose.Types.ObjectId(projectId), { limit: 2 });
  assert.equal(health.blocked.tasks.length, 2);
  assert.equal(health.blocked.total, 4);
});
