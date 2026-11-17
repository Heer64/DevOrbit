// [Sprint 6 · M7] FR-20 "the requester shall be notified of the outcome" of a join request (US-47 follow-up).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';
import Notification from '../src/models/Notification.js';
import { createNotification } from '../src/lib/notifications.js';
import { joinOutcomeNotification } from '../src/lib/joinRequestNotifications.js';

let app;
let owner, admin, approvedUser, rejectedUser, member;
let projectId;
let approvedRequestId, rejectedRequestId;

const as = (account) => authed(app, account.token);
const base = () => `/api/projects/${projectId}/join-requests`;
const requestToJoin = async (account) => {
  const res = await as(account).post(base()).send({ message: 'I would like to help.' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.joinRequest._id;
};
const bell = (account) => as(account).get('/api/notifications');

before(async () => {
  ({ app } = await setup());
  [owner, admin, approvedUser, rejectedUser, member] = await Promise.all(
    ['Olu Owner', 'Ade Admin', 'Ana Approved', 'Rex Rejected', 'Mia Member'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'Open Garden', visibility: 'Public' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [member, 'Contributor']]) {
    const added = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(added.status, 201, JSON.stringify(added.body));
  }
});

after(teardown);

test('approve: the requester gets "Join request approved" with a link to the project, and sees it in the bell', async () => {
  const requestId = await requestToJoin(approvedUser);
  approvedRequestId = requestId;
  const res = await as(admin).post(`${base()}/${requestId}/approve`).send({ role: 'Viewer' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const rows = await Notification.find({ recipient: approvedUser.user.id, type: 'join_approved' }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link, `/project/${projectId}`);
  assert.equal(String(rows[0].actor), admin.user.id);
  assert.equal(rows[0].summary, 'approved your request to join "Open Garden" as Viewer');

  const list = await bell(approvedUser);
  const shown = list.body.notifications.find((n) => n.type === 'join_approved');
  assert.ok(shown);
  assert.equal(shown.project.name, 'Open Garden');
  assert.equal(shown.actor.name, 'Ade Admin');
  assert.equal(list.body.unreadCount, 1);
});

test('reject: the requester (not a member) gets "Join request declined" with the public page link, and sees it', async () => {
  const requestId = await requestToJoin(rejectedUser);
  rejectedRequestId = requestId;
  const res = await as(owner).post(`${base()}/${requestId}/reject`).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const rows = await Notification.find({ recipient: rejectedUser.user.id, type: 'join_rejected' }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link, `/discover/${projectId}`);
  assert.equal(rows[0].actor, null, 'a non-member is not told which Owner/Admin declined');
  assert.equal(rows[0].summary, 'Your request to join "Open Garden" was declined.');

  const list = await bell(rejectedUser);
  assert.equal(list.status, 200);
  const shown = list.body.notifications.find((n) => n.type === 'join_rejected');
  assert.ok(shown, 'shown although they are not a member');
  assert.equal(list.body.unreadCount, 1);
  const marked = await as(rejectedUser).patch(`/api/notifications/${shown._id}/read`);
  assert.equal(marked.status, 200);
  assert.equal(marked.body.unreadCount, 0);
});

test('repeating approve or reject never sends a second notification', async () => {
  const before = await Notification.countDocuments({ type: { $in: ['join_approved', 'join_rejected'] } });
  assert.equal(before, 2);
  for (const id of [approvedRequestId, rejectedRequestId]) {
    const again = await as(owner).post(`${base()}/${id}/approve`).send({});
    assert.notEqual(again.status, 200, 'an already-decided request cannot be decided again');
    await as(owner).post(`${base()}/${id}/reject`).send({});
  }
  assert.equal(await Notification.countDocuments({ type: { $in: ['join_approved', 'join_rejected'] } }), before);
});

test('project notifications still follow the "member right now" rule; personal ones stay visible', async () => {
  // A mention for Mia in this project, then she is removed from it.
  const mention = await createNotification({
    recipient: member.user.id,
    type: 'mention',
    project: projectId,
    actor: owner.user.id,
    summary: 'mentioned you in #general',
    targetType: 'message',
    targetId: projectId,
    link: `/project/${projectId}?tab=chat`,
  });
  assert.ok(mention);
  const removed = await as(owner).delete(`/api/projects/${projectId}/members/${member.user.id}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const list = await bell(member);
  assert.equal(list.body.notifications.some((n) => n.type === 'mention'), false, 'project notifications of a left project stay hidden');
  assert.equal((await as(member).patch(`/api/notifications/${mention._id}/read`)).status, 404);

  // The rejected requester still sees their personal notification, and nothing from the project itself.
  const rejected = await bell(rejectedUser);
  assert.deepEqual(rejected.body.notifications.map((n) => n.type), ['join_rejected']);
});

test('joinOutcomeNotification builds both messages', () => {
  const approved = joinOutcomeNotification({ joinRequest: { _id: 'r1', user: 'u1' }, project: { _id: 'p1', name: 'X' }, outcome: 'approved', role: 'Contributor', actor: 'a1' });
  assert.equal(approved.type, 'join_approved');
  assert.equal(approved.dedupeKey, 'join-request:r1:approved');
  const rejected = joinOutcomeNotification({ joinRequest: { _id: 'r1', user: 'u1' }, project: { _id: 'p1', name: 'X' }, outcome: 'rejected', actor: 'a1' });
  assert.equal(rejected.type, 'join_rejected');
  assert.equal(rejected.actor, null);
  assert.equal(rejected.link, '/discover/p1');
});
