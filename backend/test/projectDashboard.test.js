// [Sprint 4 · M7] US-39: GET /api/projects/:id/dashboard (milestone progress, open tasks, due in 7 days).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { setup, teardown, signup, authed } from './helpers.js';
import Task from '../src/models/Task.js';
import Milestone from '../src/models/Milestone.js';
import { buildProjectDashboard } from '../src/lib/projectDashboard.js';

let app;
let owner, admin, contributor, viewer, outsider;
let projectId, publicProjectId, emptyProjectId;
let mvpId, betaId, emptyMilestoneId;

const as = (account) => authed(app, account.token);
const url = (id = projectId) => `/api/projects/${id}/dashboard`;
const DAY_MS = 24 * 60 * 60 * 1000;

// Date-only strings in the format the task form sends (stored as midnight UTC).
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

async function createMilestone(project, body) {
  const res = await as(owner).post(`/api/projects/${project}/milestones`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.milestone._id;
}

const dueTitles = (res) => res.body.dueSoon.tasks.map((task) => task.title);

before(async () => {
  ({ app } = await setup());

  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Dee Owner', 'Ada Admin', 'Cy Contributor', 'Vi Viewer', 'Otto Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Dashboard Project', visibility: 'Private' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const publicProject = await as(owner).post('/api/projects').send({ name: 'Open Project', visibility: 'Public' });
  publicProjectId = publicProject.body.project._id;
  const emptyProject = await as(owner).post('/api/projects').send({ name: 'Empty Project' });
  emptyProjectId = emptyProject.body.project._id;

  mvpId = await createMilestone(projectId, { title: 'MVP', dueDate: inDays(10) });
  betaId = await createMilestone(projectId, { title: 'Beta', dueDate: inDays(30) });
  emptyMilestoneId = await createMilestone(projectId, { title: 'Later' });

  // MVP: 2 of 3 Done -> 67%. Beta: 1 of 1 Done -> 100%. Later: no tasks -> 0%.
  await createTask(owner, projectId, { title: 'MVP done 1', status: 'Done', milestone: mvpId });
  await createTask(owner, projectId, { title: 'MVP done 2', status: 'Done', milestone: mvpId, dueDate: inDays(2) });
  await createTask(owner, projectId, { title: 'Due today', milestone: mvpId, dueDate: inDays(0), assignee: contributor.user.id });
  await createTask(owner, projectId, { title: 'Beta done', status: 'Done', milestone: betaId });

  await createTask(owner, projectId, { title: 'Due day 7', status: 'In progress', dueDate: inDays(7) });
  await createTask(owner, projectId, { title: 'Due day 3 blocked', status: 'Blocked', dueDate: inDays(3) });
  await createTask(owner, projectId, { title: 'Due day 8', dueDate: inDays(8) });
  await createTask(owner, projectId, { title: 'Overdue', dueDate: inDays(-1) });
  await createTask(owner, projectId, { title: 'No due date', status: 'In progress' });

  // Another project's task due tomorrow must never show up.
  await createTask(owner, publicProjectId, { title: 'Other project due tomorrow', dueDate: inDays(1) });
});

after(teardown);

test('requires a signed-in user', async () => {
  const res = await request(app).get(url());
  assert.equal(res.status, 401);
});

test('rejects an invalid or unknown project ID', async () => {
  assert.equal((await as(owner).get('/api/projects/not-an-id/dashboard')).status, 400);
  assert.equal((await as(owner).get(url(new mongoose.Types.ObjectId().toString()))).status, 404);
});

test('only project members can open the dashboard, even of a Public project', async () => {
  const privateRes = await as(outsider).get(url());
  assert.equal(privateRes.status, 403);
  assert.equal(privateRes.body.milestones, undefined, 'no data leaks in the error');

  const publicRes = await as(outsider).get(url(publicProjectId));
  assert.equal(publicRes.status, 403);
});

test('every member role can read it, Viewers included', async () => {
  for (const [account, role] of [[owner, 'Owner'], [admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(account).get(url());
    assert.equal(res.status, 200, `${role}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.membershipRole, role);
    assert.equal(res.body.project.name, 'Dashboard Project');
  }
});

test('milestone progress comes from the tasks attached to each milestone', async () => {
  const res = await as(viewer).get(url());
  const { milestones } = res.body;
  assert.equal(milestones.total, 3);
  assert.equal(milestones.completed, 1);
  assert.deepEqual(milestones.items.map((m) => m.title), ['MVP', 'Beta', 'Later'], 'sorted by due date, undated last');

  const [mvp, beta, later] = milestones.items;
  assert.deepEqual([mvp.taskCount, mvp.doneCount, mvp.progress, mvp.completed], [3, 2, 67, false]);
  assert.deepEqual([beta.taskCount, beta.doneCount, beta.progress, beta.completed], [1, 1, 100, true]);
  assert.deepEqual([later.taskCount, later.doneCount, later.progress, later.completed], [0, 0, 0, false]);
  assert.equal(later._id, emptyMilestoneId);
});

test('milestone progress matches the Milestones tab', async () => {
  const dashboard = await as(owner).get(url());
  const tab = await as(owner).get(`/api/projects/${projectId}/milestones`);
  const pick = (m) => [m._id, m.taskCount, m.doneCount, m.progress, m.completed];
  assert.deepEqual(dashboard.body.milestones.items.map(pick), tab.body.milestones.map(pick));
});

test('open task count is every task that is not Done', async () => {
  const res = await as(owner).get(url());
  assert.deepEqual(res.body.tasks, {
    total: 9,
    open: 6,
    done: 3,
    byStatus: { 'To do': 3, 'In progress': 2, Blocked: 1, Done: 3 },
  });
});

test('due in the next 7 days: today through day 7, open tasks of this project only, soonest first', async () => {
  const res = await as(owner).get(url());
  const { dueSoon } = res.body;
  assert.equal(dueSoon.days, 7);
  assert.equal(dueSoon.from, inDays(0));
  assert.equal(dueSoon.to, inDays(7));
  assert.deepEqual(dueTitles(res), ['Due today', 'Due day 3 blocked', 'Due day 7']);
  assert.equal(dueSoon.total, 3);

  for (const missing of ['Due day 8', 'Overdue', 'No due date', 'MVP done 2', 'Other project due tomorrow']) {
    assert.ok(!dueTitles(res).includes(missing), `${missing} must not be listed`);
  }
});

test('each upcoming task has title, due date, status, assignee and milestone', async () => {
  const res = await as(owner).get(url());
  const task = res.body.dueSoon.tasks[0];
  assert.equal(task.title, 'Due today');
  assert.equal(task.status, 'To do');
  assert.equal(task.dueDate, `${inDays(0)}T00:00:00.000Z`);
  assert.equal(task.assignee.name, 'Cy Contributor');
  assert.equal(task.milestone.title, 'MVP');
  assert.equal(task.description, undefined, 'only the fields the dashboard needs');
  assert.equal(res.body.dueSoon.tasks[1].assignee, null);
});

test('numbers follow task changes (no stored or hardcoded values)', async () => {
  const created = await createTask(owner, projectId, { title: 'Fresh task', dueDate: inDays(1), milestone: betaId });
  let res = await as(owner).get(url());
  assert.equal(res.body.tasks.open, 7);
  assert.ok(dueTitles(res).includes('Fresh task'));
  assert.equal(res.body.milestones.items.find((m) => m.title === 'Beta').progress, 50);

  const done = await as(owner).patch(`/api/projects/${projectId}/tasks/${created._id}`).send({ status: 'Done' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  res = await as(owner).get(url());
  assert.equal(res.body.tasks.open, 6);
  assert.ok(!dueTitles(res).includes('Fresh task'));
  assert.equal(res.body.milestones.items.find((m) => m.title === 'Beta').progress, 100);

  await as(owner).delete(`/api/projects/${projectId}/tasks/${created._id}`);
});

test('empty project: zeros and empty lists, not an error', async () => {
  const res = await as(owner).get(url(emptyProjectId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.milestones, { total: 0, completed: 0, items: [] });
  assert.equal(res.body.tasks.total, 0);
  assert.equal(res.body.tasks.open, 0);
  assert.deepEqual(res.body.dueSoon.tasks, []);
  assert.equal(res.body.dueSoon.total, 0);
});

test('a removed member loses access straight away', async () => {
  const project = await as(owner).post('/api/projects').send({ name: 'Short stay', visibility: 'Private' });
  const id = project.body.project._id;
  await as(owner).post(`/api/projects/${id}/members`).send({ identifier: outsider.user.username, role: 'Contributor' });
  assert.equal((await as(outsider).get(url(id))).status, 200);

  const removed = await as(owner).delete(`/api/projects/${id}/members/${outsider.user.id}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal((await as(outsider).get(url(id))).status, 403);
});

test('buildProjectDashboard: fixed clock, exact UTC day boundaries and list limit', async () => {
  const projectOid = new mongoose.Types.ObjectId();
  const creator = new mongoose.Types.ObjectId();
  const now = new Date('2026-10-31T23:59:59.999Z'); // last moment of Sat 31 Oct (UTC)
  const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

  await Task.insertMany([
    { project: projectOid, createdBy: creator, title: 'Fri 30 Oct', dueDate: day('2026-10-30') },
    { project: projectOid, createdBy: creator, title: 'Sat 31 Oct', dueDate: day('2026-10-31') },
    { project: projectOid, createdBy: creator, title: 'Sat 7 Nov', dueDate: day('2026-11-07') },
    { project: projectOid, createdBy: creator, title: 'Sun 8 Nov', dueDate: day('2026-11-08') },
    ...Array.from({ length: 4 }, (_, i) => ({ project: projectOid, createdBy: creator, title: `Mon 2 Nov #${i}`, dueDate: day('2026-11-02') })),
  ]);
  await Milestone.create({ project: projectOid, createdBy: creator, title: 'No tasks yet' });

  const result = await buildProjectDashboard(projectOid, { now, limit: 3 });
  assert.equal(result.dueSoon.from, '2026-10-31');
  assert.equal(result.dueSoon.to, '2026-11-07');
  assert.equal(result.dueSoon.total, 6, 'Sat 31 Oct + 4 x Mon 2 Nov + Sat 7 Nov');
  assert.equal(result.dueSoon.tasks.length, 3, 'list is limited, total is not');
  assert.equal(result.dueSoon.tasks[0].title, 'Sat 31 Oct');
  assert.equal(result.tasks.open, 8);
  assert.deepEqual(result.milestones.items.map((m) => m.progress), [0]);

  const nextDay = await buildProjectDashboard(projectOid, { now: new Date('2026-11-01T00:00:00.000Z') });
  const titles = nextDay.dueSoon.tasks.map((t) => t.title);
  assert.ok(!titles.includes('Sat 31 Oct'), 'once its day has passed it is overdue, not upcoming');
  assert.ok(titles.includes('Sun 8 Nov'), 'the window moved one day forward');
});
