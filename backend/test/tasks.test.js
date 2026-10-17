import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
let owner, contributor, viewer, outsider;
let projectId;
let taskId;

const as = (account) => authed(app, account.token);

before(async () => {
  ({ app } = await setup());

  [owner, contributor, viewer, outsider] = await Promise.all(
    ['Olivia Owner', 'Casey Contributor', 'Vera Viewer', 'Otto Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner)
    .post('/api/projects')
    .send({ name: 'Task API Project', visibility: 'Private' });

  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;

  for (const [account, role] of [[contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner)
      .post(`/api/projects/${projectId}/members`)
      .send({ identifier: account.user.username, role });

    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

after(teardown);

test('Owner can create and list tasks', async () => {
  const created = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Implement task API', description: 'Backend endpoints', priority: 'High' });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.task.title, 'Implement task API');
  assert.equal(created.body.task.priority, 'High');

  taskId = created.body.task._id;

  const listed = await as(owner).get(`/api/projects/${projectId}/tasks`);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.ok(listed.body.tasks.some((task) => task._id === taskId));
});

test('Contributor can create and edit tasks', async () => {
  const created = await as(contributor)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Contributor task' });

  assert.equal(created.status, 201, JSON.stringify(created.body));

  const edited = await as(contributor)
    .patch(`/api/projects/${projectId}/tasks/${created.body.task._id}`)
    .send({ title: 'Updated contributor task', status: 'In progress' });

  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.task.title, 'Updated contributor task');
  assert.equal(edited.body.task.status, 'In progress');
});

test('Viewer cannot create or edit tasks', async () => {
  const created = await as(viewer)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Not allowed' });

  assert.equal(created.status, 403);

  const edited = await as(viewer)
    .patch(`/api/projects/${projectId}/tasks/${taskId}`)
    .send({ title: 'Not allowed' });

  assert.equal(edited.status, 403);
});

test('Non-member cannot access tasks in a private project', async () => {
  assert.equal((await as(outsider).get(`/api/projects/${projectId}/tasks`)).status, 403);

  assert.equal(
    (await as(outsider).post(`/api/projects/${projectId}/tasks`).send({ title: 'Not allowed' })).status,
    403
  );
});

test('Assignee must be a member of the project', async () => {
  const res = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Invalid assignee', assignee: outsider.user.id });

  assert.equal(res.status, 400);
});

test('Owner can delete tasks', async () => {
  const created = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Task to delete' });

  assert.equal(created.status, 201, JSON.stringify(created.body));

  const deleted = await as(owner)
    .delete(`/api/projects/${projectId}/tasks/${created.body.task._id}`);

  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
});

test('Invalid task IDs are rejected', async () => {
  const res = await as(owner).patch(`/api/projects/${projectId}/tasks/not-an-id`).send({ title: 'Invalid' });
  assert.equal(res.status, 400);
});

test('Project progress updates when tasks are completed and reopened', async () => {
  const projectRes = await as(owner)
    .post('/api/projects')
    .send({ name: 'Progress Test Project', visibility: 'Private' });

  assert.equal(projectRes.status, 201);
  const id = projectRes.body.project._id;

  const first = await as(owner)
    .post(`/api/projects/${id}/tasks`)
    .send({ title: 'First task' });

  const second = await as(owner)
    .post(`/api/projects/${id}/tasks`)
    .send({ title: 'Second task' });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const getProgress = async () => {
    const res = await as(owner).get(`/api/projects/${id}`);
    assert.equal(res.status, 200);
    return res.body.project.progress;
  };

  assert.equal(await getProgress(), 0);

  await as(owner)
    .patch(`/api/projects/${id}/tasks/${first.body.task._id}`)
    .send({ status: 'Done' });

  assert.equal(await getProgress(), 50);

  await as(owner)
    .patch(`/api/projects/${id}/tasks/${second.body.task._id}`)
    .send({ status: 'Done' });

  assert.equal(await getProgress(), 100);

  await as(owner)
    .patch(`/api/projects/${id}/tasks/${first.body.task._id}`)
    .send({ status: 'To do' });

  await as(owner)
    .patch(`/api/projects/${id}/tasks/${second.body.task._id}`)
    .send({ status: 'To do' });

  assert.equal(await getProgress(), 0);
});

test('Deleting a completed task recalculates project progress', async () => {
  const projectRes = await as(owner)
    .post('/api/projects')
    .send({ name: 'Delete Progress Test', visibility: 'Private' });

  assert.equal(projectRes.status, 201);
  const id = projectRes.body.project._id;

  const first = await as(owner)
    .post(`/api/projects/${id}/tasks`)
    .send({ title: 'Completed task' });

  const second = await as(owner)
    .post(`/api/projects/${id}/tasks`)
    .send({ title: 'Remaining task' });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  await as(owner)
    .patch(`/api/projects/${id}/tasks/${first.body.task._id}`)
    .send({ status: 'Done' });

  const beforeDelete = await as(owner).get(`/api/projects/${id}`);
  assert.equal(beforeDelete.body.project.progress, 50);

  const deleted = await as(owner)
    .delete(`/api/projects/${id}/tasks/${first.body.task._id}`);

  assert.equal(deleted.status, 200);

  const afterDelete = await as(owner).get(`/api/projects/${id}`);
  assert.equal(afterDelete.status, 200);
  assert.equal(afterDelete.body.project.progress, 0);
});

test('Task listing supports status and assignee filters', async () => {
  const first = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Completed filter task', status: 'Done' });

  const second = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Unassigned filter task' });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const completed = await as(owner)
    .get(`/api/projects/${projectId}/tasks?status=Done`);

  assert.equal(completed.status, 200);
  assert.ok(completed.body.tasks.some((task) => task._id === first.body.task._id));
  assert.ok(completed.body.tasks.every((task) => task.status === 'Done'));

  const unassigned = await as(owner)
    .get(`/api/projects/${projectId}/tasks?assignee=none`);

  assert.equal(unassigned.status, 200);
  assert.ok(unassigned.body.tasks.some((task) => task._id === second.body.task._id));
  assert.ok(unassigned.body.tasks.every((task) => !task.assignee));

  const mine = await as(owner)
    .get(`/api/projects/${projectId}/tasks?assignee=me`);

  assert.equal(mine.status, 200);
  assert.ok(mine.body.tasks.every((task) => task.assignee &&
    String(task.assignee._id) === owner.user.id));
});

test('Contributor can delete their own task but not another member task', async () => {
  const ownTask = await as(contributor)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Contributor owned task' });

  const ownerTask = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Owner owned task' });

  assert.equal(ownTask.status, 201);
  assert.equal(ownerTask.status, 201);

  const deleteOwn = await as(contributor)
    .delete(`/api/projects/${projectId}/tasks/${ownTask.body.task._id}`);

  assert.equal(deleteOwn.status, 200);

  const deleteOthers = await as(contributor)
    .delete(`/api/projects/${projectId}/tasks/${ownerTask.body.task._id}`);

  assert.equal(deleteOthers.status, 403);

  const deleteOthersAsOwner = await as(owner)
    .delete(`/api/projects/${projectId}/tasks/${ownerTask.body.task._id}`);

  assert.equal(deleteOthersAsOwner.status, 200);
});

test('A task cannot be accessed through another project URL', async () => {
  const otherProject = await as(owner)
    .post('/api/projects')
    .send({ name: 'Another Private Project', visibility: 'Private' });

  assert.equal(otherProject.status, 201);
  const otherProjectId = otherProject.body.project._id;

  const created = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Task belongs to first project' });

  assert.equal(created.status, 201);

  const taskId = created.body.task._id;

  const result = await as(owner)
    .get(`/api/projects/${otherProjectId}/tasks/${taskId}`);

  assert.equal(result.status, 404);
});

test('A task cannot be edited or deleted through another project URL', async () => {
  const otherProject = await as(owner)
    .post('/api/projects')
    .send({ name: 'Another Private Project', visibility: 'Private' });

  assert.equal(otherProject.status, 201);
  const otherProjectId = otherProject.body.project._id;

  const created = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Task belongs to first project' });

  assert.equal(created.status, 201);

  const taskId = created.body.task._id;

  const edited = await as(owner)
    .patch(`/api/projects/${otherProjectId}/tasks/${taskId}`)
    .send({ title: 'Should not be edited' });

  assert.equal(edited.status, 404);

  const deleted = await as(owner)
    .delete(`/api/projects/${otherProjectId}/tasks/${taskId}`);

  assert.equal(deleted.status, 404);

  const original = await as(owner)
    .get(`/api/projects/${projectId}/tasks`);

  assert.equal(original.status, 200);
  assert.ok(original.body.tasks.some(
    (task) => task._id === taskId && task.title === 'Task belongs to first project'
  ));
});

/* ---- Sprint 2 leftovers: task label (US-21) ---- */

test('US-21 a task can be created with an optional label', async () => {
  const withLabel = await as(contributor)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Labelled task', label: '  Frontend  ' });

  assert.equal(withLabel.status, 201, JSON.stringify(withLabel.body));
  assert.equal(withLabel.body.task.label, 'Frontend');
  assert.equal(withLabel.body.task.status, 'To do');

  const withoutLabel = await as(contributor)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Unlabelled task' });

  assert.equal(withoutLabel.status, 201, JSON.stringify(withoutLabel.body));
  assert.equal(withoutLabel.body.task.label, '');

  const listed = await as(viewer).get(`/api/projects/${projectId}/tasks`);
  const found = listed.body.tasks.find((task) => task._id === withLabel.body.task._id);
  assert.equal(found.label, 'Frontend');
});

test('US-21 the label can be edited and cleared', async () => {
  const created = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Edit my label', label: 'Bug' });
  const id = created.body.task._id;

  const edited = await as(owner)
    .patch(`/api/projects/${projectId}/tasks/${id}`)
    .send({ label: 'Backend' });

  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.task.label, 'Backend');
  assert.equal(edited.body.task.version, 1);

  const cleared = await as(owner)
    .patch(`/api/projects/${projectId}/tasks/${id}`)
    .send({ label: '' });

  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.task.label, '');

  const activity = await as(owner).get(`/api/projects/${projectId}/activity`);
  assert.ok(
    activity.body.activity.some((event) => event.type === 'task.updated' && (event.meta?.fields || []).includes('label')),
    'editing the label is logged in the activity feed'
  );
});

test('US-21 a label over 30 characters is rejected with 400', async () => {
  const tooLong = 'x'.repeat(31);

  const created = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Long label', label: tooLong });

  assert.equal(created.status, 400, JSON.stringify(created.body));
  assert.match(created.body.message, /30 characters/);

  const ok = await as(owner)
    .post(`/api/projects/${projectId}/tasks`)
    .send({ title: 'Exactly 30', label: 'y'.repeat(30) });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  const edited = await as(owner)
    .patch(`/api/projects/${projectId}/tasks/${ok.body.task._id}`)
    .send({ label: tooLong });
  assert.equal(edited.status, 400, JSON.stringify(edited.body));
});
