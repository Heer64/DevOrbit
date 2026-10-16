import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
let owner, contributor, viewer, outsider;
let projectId;

const as = (account) => authed(app, account.token);
const feed = async (account, query = '') => as(account).get(`/api/projects/${projectId}/activity${query}`);
const types = (res) => res.body.activity.map((event) => event.type);

before(async () => {
  ({ app } = await setup());

  [owner, contributor, viewer, outsider] = await Promise.all(
    ['Nia Owner', 'Leo Contributor', 'Ivy Viewer', 'Max Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Activity Project', visibility: 'Public' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;

  for (const [account, role] of [[contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

after(teardown);

test('Creating a project and adding members are recorded', async () => {
  const res = await feed(owner);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // Newest first: two member additions, then the project creation.
  assert.deepEqual(types(res).slice(-3), ['member.added', 'member.added', 'project.created']);

  const added = res.body.activity.find((event) => event.type === 'member.added' && event.targetLabel === 'Leo Contributor');
  assert.ok(added, 'member.added for the contributor');
  assert.equal(added.actor.name, 'Nia Owner');
  assert.equal(added.summary, 'added Leo Contributor as Contributor');
});

test('Task create, status change, assignment and delete are recorded', async () => {
  const tasks = `/api/projects/${projectId}/tasks`;
  const created = await as(contributor).post(tasks).send({ title: 'Write docs' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const taskId = created.body.task._id;

  await as(contributor).patch(`${tasks}/${taskId}`).send({ status: 'In progress' });
  await as(contributor).patch(`${tasks}/${taskId}`).send({ assignee: contributor.user.id });
  await as(contributor).patch(`${tasks}/${taskId}`).send({ priority: 'High' });
  // Sending the same values again changes nothing, so nothing new is logged.
  await as(contributor).patch(`${tasks}/${taskId}`).send({ priority: 'High' });
  await as(owner).delete(`${tasks}/${taskId}`);

  const res = await feed(owner);
  assert.deepEqual(types(res).slice(0, 5), ['task.deleted', 'task.updated', 'task.assigned', 'task.status_changed', 'task.created']);

  const moved = res.body.activity.find((event) => event.type === 'task.status_changed');
  assert.equal(moved.summary, 'moved "Write docs" from To do to In progress');
  assert.deepEqual(moved.meta, { from: 'To do', to: 'In progress' });

  const assigned = res.body.activity.find((event) => event.type === 'task.assigned');
  assert.equal(assigned.summary, 'assigned "Write docs" to themselves');
});

test('Role changes and leaving are recorded', async () => {
  await as(owner).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Contributor' });
  await as(viewer).delete(`/api/projects/${projectId}/members/${viewer.user.id}`);

  const res = await feed(owner);
  assert.deepEqual(types(res).slice(0, 2), ['member.left', 'member.role_changed']);
  assert.equal(res.body.activity[1].summary, "changed Ivy Viewer's role from Viewer to Contributor");

  // Ivy left, so she can no longer read the feed.
  assert.equal((await feed(viewer)).status, 403);
});

test('Project feed is members-only, even for a public project', async () => {
  assert.equal((await feed(contributor)).status, 200);
  assert.equal((await feed(outsider)).status, 403);
  assert.equal((await as(outsider).get('/api/projects/not-an-id/activity')).status, 400);
});

test('Project feed pages with limit and before', async () => {
  const first = await feed(owner, '?limit=2');
  assert.equal(first.body.activity.length, 2);
  assert.ok(first.body.nextBefore, 'there should be an older page');

  const second = await feed(owner, `?limit=2&before=${encodeURIComponent(first.body.nextBefore)}`);
  assert.equal(second.status, 200);
  assert.ok(second.body.activity.length > 0);
  const firstIds = new Set(first.body.activity.map((event) => event._id));
  assert.ok(second.body.activity.every((event) => !firstIds.has(event._id)));

  assert.equal((await feed(owner, '?before=yesterday-ish')).status, 400);
});

test('My activity shows events from my projects only', async () => {
  const mine = await as(contributor).get('/api/activity/me?limit=5');
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.ok(mine.body.activity.length > 0 && mine.body.activity.length <= 5);
  assert.ok(mine.body.activity.every((event) => event.project.name === 'Activity Project'));

  const own = await as(outsider).post('/api/projects').send({ name: 'Outsider Solo' });
  assert.equal(own.status, 201);
  const outsiderFeed = await as(outsider).get('/api/activity/me');
  assert.deepEqual(outsiderFeed.body.activity.map((event) => event.project.name), ['Outsider Solo']);

  const stranger = await signup(app, 'New Person');
  const empty = await as(stranger).get('/api/activity/me');
  assert.deepEqual(empty.body.activity, []);
});
