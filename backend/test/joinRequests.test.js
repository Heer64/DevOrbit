import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import JoinRequest, { REJOIN_BLOCK_DAYS } from '../src/models/JoinRequest.js';

// [Sprint 3 · M2] Join requests: US-47 (request to join a public project) and US-12 (approve / reject, 7-day block).

const DAY_MS = 24 * 60 * 60 * 1000;

let app;
let owner, admin, contributor, viewer;
let publicId, privateId, otherPublicId;

const as = (account) => authed(app, account.token);
const base = (projectId = publicId) => `/api/projects/${projectId}/join-requests`;
const ask = (account, body = {}, projectId = publicId) => as(account).post(base(projectId)).send(body);
const queue = (account, query = '', projectId = publicId) => as(account).get(`${base(projectId)}${query}`);
const approve = (account, requestId, body = {}, projectId = publicId) => as(account).post(`${base(projectId)}/${requestId}/approve`).send(body);
const reject = (account, requestId, projectId = publicId) => as(account).post(`${base(projectId)}/${requestId}/reject`).send({});
const roleIn = async (account, projectId = publicId) => (await as(account).get(`/api/projects/${projectId}`)).body.membershipRole ?? null;
const memberCount = async (account) => (await as(owner).get(`/api/projects/${publicId}/members`)).body.members.filter((m) => m.userId === account.user.id).length;
const feedTypes = async () => (await as(owner).get(`/api/projects/${publicId}/activity`)).body.activity.map((event) => event.type);

before(async () => {
  ({ app } = await setup());
  await JoinRequest.init(); // unique "one pending request" index, needed by the race tests

  [owner, admin, contributor, viewer] = await Promise.all(
    ['Nia Owner', 'Ari Admin', 'Leo Contributor', 'Ivy Viewer'].map((name) => signup(app, name))
  );

  const pub = await as(owner).post('/api/projects').send({ name: 'Open Garden', visibility: 'Public' });
  assert.equal(pub.status, 201, JSON.stringify(pub.body));
  publicId = pub.body.project._id;

  const priv = await as(owner).post('/api/projects').send({ name: 'Secret Lab', visibility: 'Private' });
  privateId = priv.body.project._id;

  const other = await as(owner).post('/api/projects').send({ name: 'Other Public', visibility: 'Public' });
  otherPublicId = other.body.project._id;

  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${publicId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

after(teardown);

// ---------------------------------------------------------------- US-47: request to join

test('A signed-in non-member can request to join a public project with a message', async () => {
  const visitor = await signup(app, 'Vera Visitor');
  const res = await ask(visitor, { message: '  I can help with the frontend.  ' });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { joinRequest } = res.body;
  assert.equal(joinRequest.status, 'Pending');
  assert.equal(joinRequest.message, 'I can help with the frontend.');
  assert.equal(joinRequest.role, null);
  assert.equal(joinRequest.decidedAt, null);
  assert.equal(joinRequest.user.name, 'Vera Visitor');
  assert.equal(joinRequest.user.email, undefined, 'only public user fields are returned');
  assert.ok(joinRequest.createdAt);

  // The message is optional.
  const quiet = await signup(app, 'Quinn Quiet');
  const noMessage = await ask(quiet);
  assert.equal(noMessage.status, 201, JSON.stringify(noMessage.body));
  assert.equal(noMessage.body.joinRequest.message, '');

  // Asking does not make anyone a member, and project managers can see it in the activity feed.
  assert.equal(await roleIn(visitor), null);
  assert.ok((await feedTypes()).includes('join_request.created'));
});

test('A second request while one is pending is refused', async () => {
  const visitor = await signup(app, 'Dana Double');
  assert.equal((await ask(visitor)).status, 201);

  const again = await ask(visitor, { message: 'Hello again' });
  assert.equal(again.status, 409);
  assert.equal(again.body.message, 'You already have a pending request for this project.');
  assert.equal(await JoinRequest.countDocuments({ user: visitor.user.id, project: publicId }), 1);
});

test('Two requests sent at the same moment create only one', async () => {
  const visitor = await signup(app, 'Rex Racer');
  const results = await Promise.all([ask(visitor), ask(visitor), ask(visitor)]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409]);
  assert.equal(await JoinRequest.countDocuments({ user: visitor.user.id, project: publicId, status: 'Pending' }), 1);
});

test('Requests are refused for members, private projects and bad input', async () => {
  const visitor = await signup(app, 'Bo Bad');

  const member = await ask(contributor);
  assert.equal(member.status, 409);
  assert.equal(member.body.message, 'You are already a member of this project.');
  assert.equal((await ask(owner)).status, 409);

  const privateProject = await ask(visitor, {}, privateId);
  assert.equal(privateProject.status, 403);
  assert.equal(privateProject.body.message, 'Only public projects accept join requests.');

  assert.equal((await ask(visitor, { message: 'x'.repeat(501) })).status, 400);
  assert.equal((await ask(visitor, { message: 'x'.repeat(500) }, otherPublicId)).status, 201, '500 characters is allowed');
  assert.equal((await as(visitor).post('/api/projects/not-an-id/join-requests').send({})).status, 400);
  assert.equal((await ask(visitor, {}, new mongoose.Types.ObjectId().toString())).status, 404);
});

test('Signing in is required (US-47: not logged in -> asked to log in)', async () => {
  assert.equal((await request(app).post(base()).send({})).status, 401);
  assert.equal((await request(app).get(`${base()}/me`)).status, 401);
  assert.equal((await request(app).get(base())).status, 401);
});

test('GET /me shows my latest request, the block date and whether I am a member', async () => {
  const visitor = await signup(app, 'Mo Mine');
  const empty = await as(visitor).get(`${base()}/me`);
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.deepEqual(empty.body, { joinRequest: null, canRequestAgainAt: null, isMember: false });

  await ask(visitor, { message: 'Hi' });
  const pending = await as(visitor).get(`${base()}/me`);
  assert.equal(pending.body.joinRequest.status, 'Pending');
  assert.equal(pending.body.joinRequest.message, 'Hi');
  assert.equal(pending.body.canRequestAgainAt, null);

  const memberView = await as(contributor).get(`${base()}/me`);
  assert.equal(memberView.body.isMember, true);

  assert.equal((await as(visitor).get(`${base(privateId)}/me`)).status, 403, 'private projects stay hidden');
});

// ---------------------------------------------------------------- US-12: the managers' queue

test('Only the Owner and Admins can see the queue, oldest first', async () => {
  const ownerView = await queue(owner);
  assert.equal(ownerView.status, 200, JSON.stringify(ownerView.body));
  assert.ok(ownerView.body.joinRequests.length >= 3);
  assert.ok(ownerView.body.joinRequests.every((r) => r.status === 'Pending'), 'Pending is the default filter');
  const times = ownerView.body.joinRequests.map((r) => new Date(r.createdAt).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'oldest first');
  assert.equal(ownerView.body.joinRequests[0].user.name, 'Vera Visitor');

  assert.equal((await queue(admin)).status, 200);
  assert.equal((await queue(contributor)).status, 403);
  assert.equal((await queue(viewer)).status, 403);
  const outsider = await signup(app, 'Out Sider');
  assert.equal((await queue(outsider)).status, 403);

  assert.equal((await queue(owner, '?status=all')).status, 200);
  assert.equal((await queue(owner, '?status=maybe')).status, 400);
});

test('Approving adds the person as a Contributor by default, and they can open the project', async () => {
  const visitor = await signup(app, 'Ana Approved');
  const created = await ask(visitor, { message: 'Let me in' });
  const requestId = created.body.joinRequest._id;

  const res = await approve(owner, requestId);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.joinRequest.status, 'Approved');
  assert.equal(res.body.joinRequest.role, 'Contributor');
  assert.equal(res.body.joinRequest.decidedBy.name, 'Nia Owner');
  assert.ok(res.body.joinRequest.decidedAt);

  assert.equal(await roleIn(visitor), 'Contributor');
  assert.equal((await as(visitor).get(`/api/projects/${publicId}/tasks`)).status, 200);
  assert.equal((await as(visitor).get(`/api/projects/${publicId}/activity`)).status, 200, 'members-only pages open');
  assert.ok((await feedTypes()).includes('join_request.approved'));

  // No longer in the pending queue, and it cannot be decided twice.
  assert.ok(!(await queue(owner)).body.joinRequests.some((r) => r._id === requestId));
  assert.equal((await approve(owner, requestId)).status, 409);
  const late = await reject(admin, requestId);
  assert.equal(late.status, 409);
  assert.equal(late.body.message, 'This request was already approved.');

  // A member cannot ask again.
  assert.equal((await ask(visitor)).status, 409);
});

test('The approver can choose the role, within their own role limits', async () => {
  const viewerToBe = await signup(app, 'Vic Viewer');
  const asViewer = await ask(viewerToBe);
  const byAdmin = await approve(admin, asViewer.body.joinRequest._id, { role: 'Viewer' });
  assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
  assert.equal(await roleIn(viewerToBe), 'Viewer');

  const hopeful = await signup(app, 'Hal Hopeful');
  const pending = await ask(hopeful);
  const requestId = pending.body.joinRequest._id;

  assert.equal((await approve(admin, requestId, { role: 'Admin' })).status, 403, 'an Admin cannot make Admins');
  assert.equal((await approve(owner, requestId, { role: 'Owner' })).status, 400, 'nobody can be made Owner');
  assert.equal((await approve(owner, requestId, { role: 'Boss' })).status, 400);
  assert.equal((await approve(contributor, requestId)).status, 403, 'Contributors cannot approve');
  assert.equal((await reject(viewer, requestId)).status, 403, 'Viewers cannot reject');
  assert.equal((await JoinRequest.findById(requestId)).status, 'Pending', 'refused attempts change nothing');
  assert.equal(await roleIn(hopeful), null);

  const byOwner = await approve(owner, requestId, { role: 'Admin' });
  assert.equal(byOwner.status, 200);
  assert.equal(await roleIn(hopeful), 'Admin');
});

test('Two managers approving at once add the person only once', async () => {
  const visitor = await signup(app, 'Tia Twice');
  const requestId = (await ask(visitor)).body.joinRequest._id;

  const results = await Promise.all([approve(owner, requestId), approve(admin, requestId)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await memberCount(visitor), 1);
});

test('Approving someone who was added by hand meanwhile does not duplicate them', async () => {
  const visitor = await signup(app, 'Hank Hand');
  const requestId = (await ask(visitor)).body.joinRequest._id;
  await as(owner).post(`/api/projects/${publicId}/members`).send({ identifier: visitor.user.username, role: 'Viewer' });

  assert.equal((await approve(owner, requestId)).status, 200);
  assert.equal(await memberCount(visitor), 1);
  assert.equal(await roleIn(visitor), 'Viewer', 'the existing membership is kept as it was');
});

test('Rejecting does not add the person, and blocks a new request for 7 days', async () => {
  const visitor = await signup(app, 'Rae Rejected');
  const requestId = (await ask(visitor, { message: 'Please?' })).body.joinRequest._id;

  const res = await reject(owner, requestId);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.joinRequest.status, 'Rejected');
  assert.equal(res.body.joinRequest.role, null);
  assert.equal(await roleIn(visitor), null);
  assert.equal((await as(visitor).get(`/api/projects/${publicId}/tasks`)).status, 200, 'public tasks stay readable');
  assert.equal((await as(visitor).get(`/api/projects/${publicId}/activity`)).status, 403, 'but members-only pages do not');
  assert.ok((await feedTypes()).includes('join_request.rejected'));

  const blocked = await ask(visitor);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /not approved\. You can ask again on \d{4}-\d{2}-\d{2}\./);
  const until = new Date(blocked.body.canRequestAgainAt).getTime();
  const decidedAt = new Date(res.body.joinRequest.decidedAt).getTime();
  assert.equal(until - decidedAt, REJOIN_BLOCK_DAYS * DAY_MS);

  const me = await as(visitor).get(`${base()}/me`);
  assert.equal(me.body.joinRequest.status, 'Rejected');
  assert.equal(me.body.canRequestAgainAt, blocked.body.canRequestAgainAt);

  // The block is per project.
  assert.equal((await ask(visitor, {}, otherPublicId)).status, 201);

  // Still blocked just before 7 days...
  await JoinRequest.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(requestId) },
    { $set: { decidedAt: new Date(Date.now() - REJOIN_BLOCK_DAYS * DAY_MS + 60_000) } }
  );
  assert.equal((await ask(visitor)).status, 409);

  // ...and free to ask again once 7 days have passed.
  await JoinRequest.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(requestId) },
    { $set: { decidedAt: new Date(Date.now() - REJOIN_BLOCK_DAYS * DAY_MS - 60_000) } }
  );
  const again = await ask(visitor, { message: 'Trying again' });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  const meAgain = await as(visitor).get(`${base()}/me`);
  assert.equal(meAgain.body.joinRequest.message, 'Trying again', 'GET /me shows the newest request');
  assert.equal(meAgain.body.canRequestAgainAt, null);
});

test('Requests are only decided inside their own project', async () => {
  const visitor = await signup(app, 'Wes Wrong');
  const requestId = (await ask(visitor)).body.joinRequest._id;

  // The owner also manages otherPublic, but the request belongs to publicId.
  assert.equal((await approve(owner, requestId, {}, otherPublicId)).status, 404);
  assert.equal((await reject(owner, requestId, otherPublicId)).status, 404);
  assert.equal((await approve(owner, 'not-an-id')).status, 400);
  assert.equal((await approve(owner, new mongoose.Types.ObjectId().toString())).status, 404);
  assert.equal((await JoinRequest.findById(requestId)).status, 'Pending');
});

test('The one-pending-request index exists', async () => {
  const indexes = await JoinRequest.collection.indexes();
  const pendingIndex = indexes.find((index) => JSON.stringify(index.key) === JSON.stringify({ project: 1, user: 1 }));
  assert.ok(pendingIndex?.unique);
  assert.deepEqual(pendingIndex.partialFilterExpression, { status: 'Pending' });
});
