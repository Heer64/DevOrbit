import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
let owner, admin, contributor, viewer, outsider;
let projectId;
let otherProjectId;

const as = (account) => authed(app, account.token);
const base = () => `/api/projects/${projectId}/milestones`;

before(async () => {
  ({ app } = await setup());

  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Mira Owner', 'Ari Admin', 'Cody Contributor', 'Val Viewer', 'Oz Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Milestone Project', visibility: 'Private' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;

  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const other = await as(owner).post('/api/projects').send({ name: 'Another Project' });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  otherProjectId = other.body.project._id;
});

after(teardown);

test('Owner and Admin can create milestones with zero progress', async () => {
  const byOwner = await as(owner).post(base()).send({ title: 'MVP', description: 'First usable version', dueDate: '2026-10-25' });
  assert.equal(byOwner.status, 201, JSON.stringify(byOwner.body));
  assert.equal(byOwner.body.milestone.title, 'MVP');
  assert.equal(byOwner.body.milestone.taskCount, 0);
  assert.equal(byOwner.body.milestone.progress, 0);
  assert.equal(byOwner.body.milestone.completed, false);

  const byAdmin = await as(admin).post(base()).send({ title: 'Beta' });
  assert.equal(byAdmin.status, 201, JSON.stringify(byAdmin.body));
  assert.equal(byAdmin.body.milestone.dueDate, null);
});

test('Contributor and Viewer cannot create, edit or delete milestones', async () => {
  const created = await as(owner).post(base()).send({ title: 'Locked' });
  const id = created.body.milestone._id;

  for (const account of [contributor, viewer]) {
    assert.equal((await as(account).post(base()).send({ title: 'Nope' })).status, 403);
    assert.equal((await as(account).patch(`${base()}/${id}`).send({ title: 'Nope' })).status, 403);
    assert.equal((await as(account).delete(`${base()}/${id}`)).status, 403);
  }
});

test('Every member can list milestones; an outsider of a private project cannot', async () => {
  for (const account of [owner, contributor, viewer]) {
    const res = await as(account).get(base());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.milestones.length >= 2);
  }
  assert.equal((await as(outsider).get(base())).status, 403);
});

test('Milestones are sorted by due date, undated ones last', async () => {
  const res = await as(owner).get(base());
  const dated = res.body.milestones.filter((m) => m.dueDate);
  const firstUndated = res.body.milestones.findIndex((m) => !m.dueDate);
  assert.ok(firstUndated === -1 || res.body.milestones.slice(firstUndated).every((m) => !m.dueDate));
  for (let i = 1; i < dated.length; i += 1) assert.ok(new Date(dated[i - 1].dueDate) <= new Date(dated[i].dueDate));
});

test('Milestone input is validated', async () => {
  assert.equal((await as(owner).post(base()).send({ title: '   ' })).status, 400);
  assert.equal((await as(owner).post(base()).send({ title: 'x'.repeat(121) })).status, 400);
  assert.equal((await as(owner).post(base()).send({ title: 'Bad date', dueDate: 'not-a-date' })).status, 400);
  assert.equal((await as(owner).patch(`${base()}/not-an-id`).send({ title: 'x' })).status, 400);
});

test('Owner can edit a milestone and clear its due date', async () => {
  const created = await as(owner).post(base()).send({ title: 'Draft', dueDate: '2026-11-01' });
  const id = created.body.milestone._id;

  const edited = await as(owner).patch(`${base()}/${id}`).send({ title: 'Release candidate', dueDate: null });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.milestone.title, 'Release candidate');
  assert.equal(edited.body.milestone.dueDate, null);
});

test('Milestone progress is calculated from its tasks', async () => {
  const created = await as(owner).post(base()).send({ title: 'Progress check' });
  const milestoneId = created.body.milestone._id;
  const tasks = `/api/projects/${projectId}/tasks`;

  const first = await as(contributor).post(tasks).send({ title: 'Task one', milestone: milestoneId });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(String(first.body.task.milestone), milestoneId);

  const second = await as(contributor).post(tasks).send({ title: 'Task two' });
  const attached = await as(contributor).patch(`${tasks}/${second.body.task._id}`).send({ milestone: milestoneId });
  assert.equal(attached.status, 200, JSON.stringify(attached.body));

  await as(contributor).patch(`${tasks}/${first.body.task._id}`).send({ status: 'Done' });

  let row = (await as(owner).get(base())).body.milestones.find((m) => m._id === milestoneId);
  assert.equal(row.taskCount, 2);
  assert.equal(row.doneCount, 1);
  assert.equal(row.progress, 50);
  assert.equal(row.completed, false);

  await as(contributor).patch(`${tasks}/${second.body.task._id}`).send({ status: 'Done' });
  row = (await as(owner).get(base())).body.milestones.find((m) => m._id === milestoneId);
  assert.equal(row.progress, 100);
  assert.equal(row.completed, true);

  const filtered = await as(owner).get(`${tasks}?milestone=${milestoneId}`);
  assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
  assert.equal(filtered.body.tasks.length, 2);
});

test('A task cannot be attached to another project milestone', async () => {
  const foreign = await as(owner).post(`/api/projects/${otherProjectId}/milestones`).send({ title: 'Elsewhere' });
  assert.equal(foreign.status, 201, JSON.stringify(foreign.body));

  const res = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Wrong milestone', milestone: foreign.body.milestone._id });
  assert.equal(res.status, 400);

  const edit = await as(owner).patch(`${base()}/${foreign.body.milestone._id}`).send({ title: 'Through wrong URL' });
  assert.equal(edit.status, 404);
});

test('Deleting a milestone keeps its tasks but detaches them', async () => {
  const created = await as(owner).post(base()).send({ title: 'To delete' });
  const milestoneId = created.body.milestone._id;
  const task = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Survivor', milestone: milestoneId });

  const removed = await as(admin).delete(`${base()}/${milestoneId}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.detachedTasks, 1);

  const list = await as(owner).get(`/api/projects/${projectId}/tasks`);
  const survivor = list.body.tasks.find((t) => t._id === task.body.task._id);
  assert.ok(survivor, 'task should still exist');
  assert.equal(survivor.milestone, null);

  assert.equal((await as(owner).delete(`${base()}/${milestoneId}`)).status, 404);
});
