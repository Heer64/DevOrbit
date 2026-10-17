// Sprint 2 Pair D: Kanban status API (US-27, US-28, NFR-5a/NFR-25).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
let owner, contributor, viewer, outsider;
let projectId;
let otherProjectId;

const as = (account) => authed(app, account.token);
const tasksUrl = (pid = projectId) => `/api/projects/${pid}/tasks`;
const statusUrl = (taskId, pid = projectId) => `${tasksUrl(pid)}/${taskId}/status`;

async function newTask(title = 'Board task', extra = {}) {
  const res = await as(owner).post(tasksUrl()).send({ title, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.task;
}

before(async () => {
  ({ app } = await setup());

  [owner, contributor, viewer, outsider] = await Promise.all(
    ['Kara Owner', 'Kai Contributor', 'Kim Viewer', 'Kit Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Kanban Project', visibility: 'Private' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;

  for (const [account, role] of [[contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner)
      .post(`/api/projects/${projectId}/members`)
      .send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const other = await as(owner).post('/api/projects').send({ name: 'Other Kanban Project', visibility: 'Private' });
  otherProjectId = other.body.project._id;
});

after(teardown);

test('New tasks start at version 0 and the list includes it', async () => {
  const task = await newTask('Fresh task');
  assert.equal(task.version, 0);

  const listed = await as(viewer).get(tasksUrl());
  assert.equal(listed.status, 200);
  const found = listed.body.tasks.find((item) => item._id === task._id);
  assert.equal(found.version, 0);
});

test('US-27: tasks keep the status they were saved with, including Blocked', async () => {
  const blocked = await newTask('Waiting on API keys', { status: 'Blocked' });
  assert.equal(blocked.status, 'Blocked');

  const listed = await as(viewer).get(`${tasksUrl()}?status=Blocked`);
  assert.equal(listed.status, 200);
  assert.ok(listed.body.tasks.some((item) => item._id === blocked._id));
});

test('US-28: moving a task saves the status and bumps the version', async () => {
  const task = await newTask();

  const res = await as(contributor).patch(statusUrl(task._id)).send({ status: 'In progress', version: 0 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.task.status, 'In progress');
  assert.equal(res.body.task.version, 1);
  assert.equal(res.body.task.assignee, null);
  assert.equal(typeof res.body.task.createdBy.name, 'string');

  const next = await as(contributor).patch(statusUrl(task._id)).send({ status: 'Blocked', version: 1 });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal(next.body.task.version, 2);
});

test('Moving to Done sets completedAt and moving out clears it', async () => {
  const task = await newTask();

  const done = await as(owner).patch(statusUrl(task._id)).send({ status: 'Done', version: 0 });
  assert.equal(done.status, 200);
  assert.ok(done.body.task.completedAt);

  const reopened = await as(owner).patch(statusUrl(task._id)).send({ status: 'Blocked', version: 1 });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.task.completedAt, null);
});

test('Dropping a task into its own column changes nothing', async () => {
  const task = await newTask();
  const res = await as(owner).patch(statusUrl(task._id)).send({ status: 'To do', version: 0 });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.version, 0);
});

test('Invalid status, missing or bad version are rejected with 400', async () => {
  const task = await newTask();

  for (const body of [
    { status: 'Later', version: 0 },
    { status: 'Done' },
    { status: 'Done', version: '0' },
    { status: 'Done', version: -1 },
    { status: 'Done', version: 1.5 },
  ]) {
    const res = await as(owner).patch(statusUrl(task._id)).send(body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} -> ${res.status}`);
  }

  const unchanged = await as(owner).get(`${tasksUrl()}/${task._id}`);
  assert.equal(unchanged.body.task.status, 'To do');
  assert.equal(unchanged.body.task.version, 0);
});

test('US-28: a stale version gets 409 with the latest task, and nothing is overwritten', async () => {
  const task = await newTask('Contested task');

  const first = await as(owner).patch(statusUrl(task._id)).send({ status: 'Done', version: 0 });
  assert.equal(first.status, 200);

  const stale = await as(contributor).patch(statusUrl(task._id)).send({ status: 'Blocked', version: 0 });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.message, 'This task was changed by someone else.');
  assert.equal(stale.body.task._id, task._id);
  assert.equal(stale.body.task.status, 'Done');
  assert.equal(stale.body.task.version, 1);

  const saved = await as(owner).get(`${tasksUrl()}/${task._id}`);
  assert.equal(saved.body.task.status, 'Done');
});

test('Two simultaneous moves with the same version: exactly one wins', async () => {
  const task = await newTask('Race task');

  const results = await Promise.all([
    as(owner).patch(statusUrl(task._id)).send({ status: 'In progress', version: 0 }),
    as(contributor).patch(statusUrl(task._id)).send({ status: 'Blocked', version: 0 }),
  ]);

  const codes = results.map((res) => res.status).sort();
  assert.deepEqual(codes, [200, 409]);

  const saved = await as(owner).get(`${tasksUrl()}/${task._id}`);
  assert.equal(saved.body.task.version, 1);
});

test('Viewers and non-members cannot change status (backend enforces it)', async () => {
  const task = await newTask();

  const asViewer = await as(viewer).patch(statusUrl(task._id)).send({ status: 'Done', version: 0 });
  assert.equal(asViewer.status, 403);

  const asOutsider = await as(outsider).patch(statusUrl(task._id)).send({ status: 'Done', version: 0 });
  assert.equal(asOutsider.status, 403);

  const saved = await as(owner).get(`${tasksUrl()}/${task._id}`);
  assert.equal(saved.body.task.status, 'To do');
  assert.equal(saved.body.task.version, 0);
});

test('A task cannot be moved through another project URL', async () => {
  const task = await newTask();
  const res = await as(owner).patch(statusUrl(task._id, otherProjectId)).send({ status: 'Done', version: 0 });
  assert.equal(res.status, 404);
});

test('Status change logs a task.status_changed activity event', async () => {
  const task = await newTask('Logged move');
  await as(owner).patch(statusUrl(task._id)).send({ status: 'Blocked', version: 0 });

  const feed = await as(owner).get(`/api/projects/${projectId}/activity`);
  assert.equal(feed.status, 200);
  const event = feed.body.activity.find(
    (item) => item.type === 'task.status_changed' && item.targetLabel === 'Logged move'
  );
  assert.ok(event, 'expected a task.status_changed event');
  assert.deepEqual(event.meta, { from: 'To do', to: 'Blocked' });
});

test('Project progress follows status moves', async () => {
  const project = await as(owner).post('/api/projects').send({ name: 'Progress board', visibility: 'Private' });
  const pid = project.body.project._id;
  const created = await as(owner).post(tasksUrl(pid)).send({ title: 'Only task' });

  await as(owner).patch(statusUrl(created.body.task._id, pid)).send({ status: 'Done', version: 0 });
  let detail = await as(owner).get(`/api/projects/${pid}`);
  assert.equal(detail.body.project.progress, 100);

  await as(owner).patch(statusUrl(created.body.task._id, pid)).send({ status: 'Blocked', version: 1 });
  detail = await as(owner).get(`/api/projects/${pid}`);
  assert.equal(detail.body.project.progress, 0);
});

/* ---- General edit endpoint (Pair A route, version bump added by Pair D) ---- */

test('Editing a task bumps its version, so an old board copy gets 409', async () => {
  const task = await newTask('Edit me');

  const edited = await as(owner).patch(`${tasksUrl()}/${task._id}`).send({ title: 'Edited' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.task.version, 1);

  const stale = await as(contributor).patch(statusUrl(task._id)).send({ status: 'Done', version: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.task.title, 'Edited');
});

test('An edit that changes nothing does not bump the version', async () => {
  const task = await newTask('Same title');
  const res = await as(owner).patch(`${tasksUrl()}/${task._id}`).send({ title: 'Same title' });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.version, 0);
});

test('General edit accepts an optional version and rejects a stale one', async () => {
  const task = await newTask('Versioned edit');

  const ok = await as(owner).patch(`${tasksUrl()}/${task._id}`).send({ priority: 'High', version: 0 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.task.version, 1);

  const stale = await as(contributor).patch(`${tasksUrl()}/${task._id}`).send({ priority: 'Low', version: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.message, 'This task was changed by someone else.');
  assert.equal(stale.body.task.priority, 'High');
});

test('Two simultaneous general edits with the same version: one wins, one gets 409', async () => {
  const task = await newTask('Edit race');
  const url = `${tasksUrl()}/${task._id}`;

  const results = await Promise.all([
    as(owner).patch(url).send({ title: 'Edit race A', version: 0 }),
    as(contributor).patch(url).send({ title: 'Edit race B', version: 0 }),
  ]);

  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409]);
  const saved = await as(owner).get(url);
  assert.equal(saved.body.task.version, 1);
});

test('Tasks saved before the version field existed count as version 0', async () => {
  const task = await newTask('Legacy task');
  await mongoose.connection.collection('tasks').updateOne(
    { _id: new mongoose.Types.ObjectId(task._id) },
    { $unset: { version: '' } }
  );

  const fetched = await as(owner).get(`${tasksUrl()}/${task._id}`);
  assert.equal(fetched.body.task.version, 0);

  const moved = await as(owner).patch(statusUrl(task._id)).send({ status: 'In progress', version: 0 });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.task.version, 1);
});

/* ---- Single task read ---- */

test('GET one task works for members and stays inside its project', async () => {
  const task = await newTask('Readable task');

  const asViewer = await as(viewer).get(`${tasksUrl()}/${task._id}`);
  assert.equal(asViewer.status, 200);
  assert.equal(asViewer.body.task.title, 'Readable task');

  assert.equal((await as(outsider).get(`${tasksUrl()}/${task._id}`)).status, 403);
  assert.equal((await as(owner).get(`${tasksUrl(otherProjectId)}/${task._id}`)).status, 404);
  assert.equal((await as(owner).get(`${tasksUrl()}/not-an-id`)).status, 400);
});
