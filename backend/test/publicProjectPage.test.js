// [Sprint 5 · M2] US-46 View a public project page (Actor: Visitor) and US-47 Request to join
// a public project (Actor: Registered User), end to end against the API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Project from '../src/models/Project.js';

let app;
let owner;
let casey;
let publicId;
let privateId;

const visitor = (url) => request(app).get(url); // no Authorization header at all
const as = (account) => authed(app, account.token);
const page = (id) => `/api/public/projects/${id}`;

before(async () => {
  ({ app } = await setup());
  [owner, casey] = await Promise.all([signup(app, 'Olivia Owner'), signup(app, 'Casey Contributor')]);

  const pub = await as(owner)
    .post('/api/projects')
    .send({ name: 'Open Garden', description: 'Community gardening app', domain: 'Community', visibility: 'Public' });
  assert.equal(pub.status, 201, JSON.stringify(pub.body));
  publicId = pub.body.project._id;

  const priv = await as(owner)
    .post('/api/projects')
    .send({ name: 'Secret Lab', description: 'Private research notes', domain: 'Community', visibility: 'Private' });
  assert.equal(priv.status, 201, JSON.stringify(priv.body));
  privateId = priv.body.project._id;

  const added = await as(owner).post(`/api/projects/${publicId}/members`).send({ identifier: casey.user.username, role: 'Contributor' });
  assert.equal(added.status, 201, JSON.stringify(added.body));

  // Fields a visitor must never see.
  await Project.updateOne(
    { _id: publicId },
    { $set: { status: 'In progress', tags: ['React'], githubRepo: 'team/open-garden', progress: 40 } }
  );
  await as(owner).post(`/api/projects/${publicId}/tasks`).send({ title: 'Secret task title' });
});

after(teardown);

// --- US-46 AC1: name, description, domain, status and member names, read-only ---------------------

test('US-46 AC1: a visitor (no login) sees name, description, domain, status and member names', async () => {
  const res = await visitor(page(publicId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.project, {
    _id: publicId,
    name: 'Open Garden',
    description: 'Community gardening app',
    domain: 'Community',
    status: 'In progress',
    memberNames: ['Olivia Owner', 'Casey Contributor'],
  });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('US-46 AC1: nothing else is sent: no emails, usernames, user IDs, roles, repo, tags, progress or visibility', async () => {
  const res = await visitor(page(publicId));
  const text = JSON.stringify(res.body);
  for (const hidden of [
    owner.email,
    casey.email,
    owner.user.id,
    casey.user.id,
    `"${owner.user.username}"`,
    `"${casey.user.username}"`,
    'team/open-garden',
    'React',
    '"role"',
    '"Owner"',
    '"Contributor"',
    'visibility',
    '"progress"',
    'githubRepo',
    '"tags"',
    'Secret task title',
  ]) {
    assert.ok(!text.includes(hidden), `"${hidden}" must not be on the public page: ${text}`);
  }
});

test('US-46 AC1: everyone gets the same public answer: logged in, member, or a garbage token', async () => {
  const expected = (await visitor(page(publicId))).body;
  assert.deepEqual((await as(casey).get(page(publicId))).body, expected);
  assert.deepEqual((await request(app).get(page(publicId)).set('Authorization', 'Bearer not-a-real-token')).body, expected);
});

test('US-46 AC1: the page is read-only: visitors cannot edit the project', async () => {
  assert.equal((await request(app).patch(`/api/projects/${publicId}`).send({ name: 'Hacked' })).status, 401);
  const stranger = await signup(app, 'Sam Stranger');
  assert.equal((await as(stranger).patch(`/api/projects/${publicId}`).send({ name: 'Hacked' })).status, 403);
  // The public router has no write routes at all.
  for (const method of ['post', 'patch', 'put', 'delete']) {
    assert.equal((await request(app)[method](page(publicId)).send({ name: 'Hacked' })).status, 404, method);
  }
  assert.equal((await visitor(page(publicId))).body.project.name, 'Open Garden');
});

test('US-46: changes by the team show up on the public page (new member, new status)', async () => {
  const newbie = await signup(app, 'Nia Newbie');
  await as(owner).post(`/api/projects/${publicId}/members`).send({ identifier: newbie.user.username, role: 'Viewer' });
  const res = await visitor(page(publicId));
  assert.deepEqual(res.body.project.memberNames, ['Olivia Owner', 'Casey Contributor', 'Nia Newbie']);
  await as(owner).delete(`/api/projects/${publicId}/members/${newbie.user.id}`);
  assert.deepEqual((await visitor(page(publicId))).body.project.memberNames, ['Olivia Owner', 'Casey Contributor']);
});

// --- Private projects never have a public page ----------------------------------------------------

test('a Private project answers 404 exactly like a project that does not exist, for everyone', async () => {
  const missing = await visitor(page('0123456789abcdef01234567'));
  assert.equal(missing.status, 404);
  assert.equal(missing.body.message, 'This project is not public or does not exist.');

  const asVisitor = await visitor(page(privateId));
  assert.equal(asVisitor.status, 404);
  assert.deepEqual(asVisitor.body, missing.body);
  assert.ok(!JSON.stringify(asVisitor.body).includes('Secret Lab'));

  // Even its own Owner gets no public page for it (they use the normal workspace).
  assert.equal((await as(owner).get(page(privateId))).status, 404);
});

test('a project made Private disappears from the public page at once', async () => {
  const made = await as(owner).post('/api/projects').send({ name: 'Soon Private', domain: 'Community', visibility: 'Public' });
  const id = made.body.project._id;
  assert.equal((await visitor(page(id))).status, 200);
  assert.equal((await as(owner).patch(`/api/projects/${id}`).send({ visibility: 'Private' })).status, 200);
  assert.equal((await visitor(page(id))).status, 404);
});

test('an invalid project ID answers 400; "filters" still means the Discover filter list', async () => {
  const bad = await visitor(page('not-an-id'));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.message, 'Invalid project ID.');
  const filters = await visitor(page('filters'));
  assert.equal(filters.status, 200);
  assert.ok(Array.isArray(filters.body.domains));
});

// --- US-46 AC2: channels, messages, tasks and files are not shown to non-members --------------------

test('US-46 AC2: a logged-in non-member gets no channels, messages, tasks, files or docs, even on a Public project', async () => {
  const stranger = await signup(app, 'Nora Nonmember');
  const base = `/api/projects/${publicId}`;

  const channels = await as(owner).get(`${base}/channels`);
  assert.equal(channels.status, 200, JSON.stringify(channels.body));
  const channelId = channels.body.channels[0]._id;
  const taskList = await as(owner).get(`${base}/tasks`);
  const taskId = taskList.body.tasks[0]._id;

  for (const url of [
    `${base}/channels`,
    `${base}/channels/${channelId}/messages`,
    `${base}/tasks`,
    `${base}/tasks/${taskId}`,
    `${base}/files`,
    `${base}/docs`,
  ]) {
    const res = await as(stranger).get(url);
    assert.equal(res.status, 403, `${url}: ${JSON.stringify(res.body)}`);
  }
  assert.equal((await as(stranger).get(`${base}/tasks`)).body.message, 'Tasks are visible to project members only.');

  // Without a login none of them open either.
  for (const url of [`${base}/channels`, `${base}/tasks`, `${base}/files`]) {
    assert.equal((await request(app).get(url)).status, 401, url);
  }
});

test('US-46 AC2: members still see their tasks and channels', async () => {
  assert.equal((await as(casey).get(`/api/projects/${publicId}/tasks`)).status, 200);
  assert.equal((await as(casey).get(`/api/projects/${publicId}/channels`)).status, 200);
});

// --- US-47 Request to join, from the public page ---------------------------------------------------

test('US-47 AC3: a visitor who is not logged in cannot send a join request (must log in first)', async () => {
  const res = await request(app).post(`/api/projects/${publicId}/join-requests`).send({ message: 'Hi' });
  assert.equal(res.status, 401);
  assert.equal((await as(owner).get(`/api/projects/${publicId}/join-requests`)).body.joinRequests.length, 0);
});

test('US-47 AC1 + AC2: a logged-in non-member sends one pending request with a message; a second is refused; managers see it', async () => {
  const ravi = await signup(app, 'Ravi Requester');

  const status = await as(ravi).get(`/api/projects/${publicId}/join-requests/me`);
  assert.equal(status.status, 200);
  assert.equal(status.body.isMember, false);
  assert.equal(status.body.joinRequest, null);

  const sent = await as(ravi).post(`/api/projects/${publicId}/join-requests`).send({ message: 'I know React' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.joinRequest.status, 'Pending');
  assert.equal(sent.body.joinRequest.message, 'I know React');

  const again = await as(ravi).post(`/api/projects/${publicId}/join-requests`).send({});
  assert.equal(again.status, 409);
  assert.equal(again.body.message, 'You already have a pending request for this project.');

  const queue = await as(owner).get(`/api/projects/${publicId}/join-requests`);
  assert.equal(queue.status, 200);
  assert.deepEqual(
    queue.body.joinRequests.map((r) => r.user.name),
    ['Ravi Requester']
  );

  // The message is optional.
  const mia = await signup(app, 'Mia Quiet');
  const quiet = await as(mia).post(`/api/projects/${publicId}/join-requests`).send({});
  assert.equal(quiet.status, 201, JSON.stringify(quiet.body));
  assert.equal(quiet.body.joinRequest.message, '');

  // Approving (Sprint 3 flow) adds the name to the public page and opens the tasks.
  const approved = await as(owner).post(`/api/projects/${publicId}/join-requests/${sent.body.joinRequest._id}/approve`).send({});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.ok((await visitor(page(publicId))).body.project.memberNames.includes('Ravi Requester'));
  assert.equal((await as(ravi).get(`/api/projects/${publicId}/tasks`)).status, 200);
  assert.equal((await as(ravi).get(`/api/projects/${publicId}/join-requests/me`)).body.isMember, true);
});

test('US-47: join requests are only for Public projects', async () => {
  const stranger = await signup(app, 'Pia Private');
  assert.equal((await as(stranger).post(`/api/projects/${privateId}/join-requests`).send({})).status, 403);
});
