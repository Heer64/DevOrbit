// [Sprint 4 · M8] US-15: Owner marks a project Completed or reopens it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Activity from '../src/models/Activity.js';
import Project from '../src/models/Project.js';
import {
  checkCompletionChange,
  completionFields,
  reopenFields,
  touchesCompletion,
} from '../src/lib/projectCompletion.js';

let app;
let owner, admin, contributor, viewer, outsider;
let projectId;

const as = (account) => authed(app, account.token);
const complete = (account, id = projectId) => as(account).post(`/api/projects/${id}/complete`);
const reopen = (account, id = projectId) => as(account).post(`/api/projects/${id}/reopen`);

before(async () => {
  ({ app } = await setup());
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Olive Owner', 'Adam Admin', 'Cora Contributor', 'Vik Viewer', 'Oscar Outsider'].map((name) => signup(app, name))
  );
  const res = await as(owner).post('/api/projects').send({ name: 'Finish Line', visibility: 'Private' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  projectId = res.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const added = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(added.status, 201, JSON.stringify(added.body));
  }
});

after(teardown);

// ---- Pure rules ----------------------------------------------------------------------------

test('rules: only the Owner may complete or reopen', () => {
  assert.deepEqual(checkCompletionChange('Owner', 'In progress', 'complete'), { ok: true });
  assert.deepEqual(checkCompletionChange('Owner', 'Completed', 'reopen'), { ok: true });
  for (const role of ['Admin', 'Contributor', 'Viewer', null]) {
    assert.equal(checkCompletionChange(role, 'In progress', 'complete').status, 403);
    assert.equal(checkCompletionChange(role, 'Completed', 'reopen').status, 403);
  }
});

test('rules: completing twice or reopening an active project is a 409', () => {
  assert.equal(checkCompletionChange('Owner', 'Completed', 'complete').status, 409);
  assert.equal(checkCompletionChange('Owner', 'Planning', 'reopen').status, 409);
  assert.equal(checkCompletionChange('Owner', 'In progress', 'reopen').status, 409);
});

test('rules: reopen restores the earlier active status, default In progress', () => {
  const now = new Date('2026-11-01T10:00:00Z');
  assert.deepEqual(completionFields({ status: 'Planning' }, now), { status: 'Completed', completedAt: now, reopenStatus: 'Planning' });
  assert.equal(completionFields({ status: 'In progress' }, now).reopenStatus, 'In progress');
  assert.deepEqual(reopenFields({ reopenStatus: 'Planning' }), { status: 'Planning', completedAt: null, reopenStatus: '' });
  assert.equal(reopenFields({ reopenStatus: '' }).status, 'In progress');
  assert.equal(reopenFields({}).status, 'In progress');
});

test('rules: only status changes across Completed are guarded on PATCH', () => {
  assert.equal(touchesCompletion('Planning', 'In progress'), false);
  assert.equal(touchesCompletion('Planning', undefined), false);
  assert.equal(touchesCompletion('Completed', 'Completed'), false);
  assert.equal(touchesCompletion('Planning', 'Completed'), true);
  assert.equal(touchesCompletion('Completed', 'In progress'), true);
});

// ---- API -----------------------------------------------------------------------------------

test('needs sign-in, a valid id and an existing project', async () => {
  assert.equal((await request(app).post(`/api/projects/${projectId}/complete`)).status, 401);
  assert.equal((await complete(owner, 'not-an-id')).status, 400);
  assert.equal((await complete(owner, '0123456789abcdef01234567')).status, 404);
});

test('Admin, Contributor, Viewer and outsiders cannot complete (403) and nothing changes', async () => {
  for (const account of [admin, contributor, viewer, outsider]) {
    const res = await complete(account);
    assert.equal(res.status, 403, JSON.stringify(res.body));
  }
  const project = await Project.findById(projectId).lean();
  assert.equal(project.status, 'Planning');
  assert.equal(project.completedAt, null);
});

test('reopening an active project is refused (409)', async () => {
  const res = await reopen(owner);
  assert.equal(res.status, 409);
  assert.match(res.body.message, /not Completed/);
});

test('Owner marks the project Completed: status, completedAt and an activity event', async () => {
  const before = Date.now();
  const res = await complete(owner);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.project.status, 'Completed');
  assert.ok(new Date(res.body.project.completedAt).getTime() >= before - 1000);

  const got = await as(viewer).get(`/api/projects/${projectId}`);
  assert.equal(got.body.project.status, 'Completed');

  const event = await Activity.findOne({ project: projectId, type: 'project.completed' }).lean();
  assert.ok(event, 'project.completed is logged in the activity feed');
  assert.equal(event.actor.toString(), owner.user.id);
  assert.deepEqual(event.meta, { from: 'Planning', to: 'Completed' });
});

test('completing again is a 409 and keeps the first completedAt', async () => {
  const first = (await Project.findById(projectId).lean()).completedAt.getTime();
  const res = await complete(owner);
  assert.equal(res.status, 409);
  assert.equal((await Project.findById(projectId).lean()).completedAt.getTime(), first);
});

test('completed projects can be queried for portfolios: GET /api/projects?status=Completed', async () => {
  const other = await as(contributor).post('/api/projects').send({ name: 'Still going' });
  assert.equal(other.status, 201);

  const done = await as(contributor).get('/api/projects?status=Completed');
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.projects.map((p) => p.name), ['Finish Line']);

  const all = await as(contributor).get('/api/projects');
  assert.equal(all.body.projects.length, 2, 'without ?status the list is unchanged');

  assert.equal((await as(contributor).get('/api/projects?status=Archived')).status, 400);
});

test('Admins cannot bypass the rule through PATCH; Owners are pointed to the reopen action', async () => {
  const byAdmin = await as(admin).patch(`/api/projects/${projectId}`).send({ status: 'In progress' });
  assert.equal(byAdmin.status, 403);
  const byOwner = await as(owner).patch(`/api/projects/${projectId}`).send({ status: 'In progress' });
  assert.equal(byOwner.status, 400);
  assert.equal((await Project.findById(projectId).lean()).status, 'Completed');

  // Other edits still work on a Completed project.
  const edit = await as(admin).patch(`/api/projects/${projectId}`).send({ description: 'Shipped!' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.project.status, 'Completed');
});

test('Admin cannot reopen (403); Owner reopens and the earlier status comes back', async () => {
  assert.equal((await reopen(admin)).status, 403);
  const res = await reopen(owner);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.project.status, 'Planning');
  assert.equal(res.body.project.completedAt, null);
  assert.ok(await Activity.findOne({ project: projectId, type: 'project.reopened' }).lean());

  const done = await as(contributor).get('/api/projects?status=Completed');
  assert.equal(done.body.projects.length, 0, 'a reopened project leaves the completed list');
});

test('a project that was In progress returns to In progress after reopen', async () => {
  const patched = await as(admin).patch(`/api/projects/${projectId}`).send({ status: 'In progress' });
  assert.equal(patched.status, 200, 'Planning -> In progress is an ordinary edit');
  assert.equal((await complete(owner)).status, 200);
  const res = await reopen(owner);
  assert.equal(res.body.project.status, 'In progress');
});

test('two simultaneous "complete" clicks change the project once', async () => {
  const results = await Promise.all([complete(owner), complete(owner)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await Activity.countDocuments({ project: projectId, type: 'project.completed' }), 3);
});
