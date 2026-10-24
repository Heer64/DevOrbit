import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Notification, {
  NOTIFICATION_TYPES,
  NOTIFICATION_LABELS,
  IN_APP_LINK,
} from '../src/models/Notification.js';
import { createNotification, taskLink, messageLink } from '../src/lib/notifications.js';

// [Sprint 3 · M7 Part 1] Notification storage (US-30): model, createNotification(), /api/notifications.

let app;
let owner, member, outsider;
let projectId;
const taskId = new mongoose.Types.ObjectId().toString();

const as = (account) => authed(app, account.token);
const list = (account, query = '') => as(account).get(`/api/notifications${query}`);

// A valid notification for `member`, caused by `owner`. Override any field.
const sample = (overrides = {}) => ({
  recipient: member.user.id,
  type: 'assignment',
  project: projectId,
  actor: owner.user.id,
  summary: 'assigned you to "Write docs"',
  targetType: 'task',
  targetId: taskId,
  targetLabel: 'Write docs',
  link: taskLink(projectId, taskId),
  ...overrides,
});

// Rows created in the same millisecond would share createdAt; spread them out so order and paging are exact.
async function setCreatedAt(id, date) {
  await Notification.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(id)) }, { $set: { createdAt: date } });
}

before(async () => {
  ({ app } = await setup());
  await Notification.init(); // build the unique dedupe index before the idempotency tests

  [owner, member, outsider] = await Promise.all(
    ['Nia Owner', 'Leo Member', 'Max Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Notify Project', visibility: 'Private' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;

  const added = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: member.user.username, role: 'Contributor' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
});

after(teardown);

// ---------------------------------------------------------------- model

test('Notification types match US-30 (Mention, Assignment, Deadline)', () => {
  assert.deepEqual(NOTIFICATION_TYPES, ['mention', 'assignment', 'deadline']);
  assert.deepEqual(NOTIFICATION_TYPES.map((type) => NOTIFICATION_LABELS[type]), ['Mention', 'Assignment', 'Deadline']);
});

test('A stored notification is unread by default and has timestamps', async () => {
  const saved = await Notification.create(sample());
  assert.equal(saved.read, false);
  assert.equal(saved.readAt, null);
  assert.ok(saved.createdAt instanceof Date);
  assert.ok(saved.updatedAt instanceof Date);
  assert.equal(saved.dedupeKey, undefined);
  assert.equal(String(saved.recipient), member.user.id);
  assert.equal(String(saved.project), projectId);

  const deadline = await Notification.create(sample({ type: 'deadline', actor: null, summary: '"Write docs" is due in less than 24 hours' }));
  assert.equal(deadline.actor, null, 'system notifications have no actor');

  await Notification.deleteMany({});
});

test('Required fields, type, target type and lengths are validated', async () => {
  const errorFor = async (fields) => {
    const error = await new Notification(fields).validate().then(() => null, (err) => err);
    assert.ok(error, `expected a validation error for ${JSON.stringify(Object.keys(fields))}`);
    return Object.keys(error.errors);
  };

  const { recipient, type, project, summary, targetType, targetId, link, ...rest } = sample();
  const missing = await errorFor(rest);
  for (const field of ['recipient', 'type', 'project', 'summary', 'targetType', 'targetId', 'link']) {
    assert.ok(missing.includes(field), `${field} should be required`);
  }
  assert.ok(recipient && type && project && summary && targetType && targetId && link);

  assert.deepEqual(await errorFor(sample({ type: 'like' })), ['type']);
  assert.deepEqual(await errorFor(sample({ targetType: 'milestone' })), ['targetType']);
  assert.deepEqual(await errorFor(sample({ summary: 'x'.repeat(301) })), ['summary']);
  assert.deepEqual(await errorFor(sample({ targetLabel: 'x'.repeat(201) })), ['targetLabel']);
  assert.deepEqual(await errorFor(sample({ recipient: 'not-an-id' })), ['recipient']);
});

test('Links must be in-app paths', async () => {
  for (const good of [taskLink(projectId, taskId), messageLink(projectId, 'c1', 'm1'), '/dashboard']) {
    assert.ok(IN_APP_LINK.test(good), good);
    await new Notification(sample({ link: good })).validate();
  }

  for (const bad of ['https://evil.example', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', 'project/1', '/a b']) {
    assert.equal(IN_APP_LINK.test(bad), false, bad);
    const error = await new Notification(sample({ link: bad })).validate().then(() => null, (err) => err);
    assert.ok(error?.errors?.link, `${bad} should be rejected`);
  }
});

test('Link helpers build the deep links ProjectPage opens', () => {
  assert.equal(taskLink('p1', 't1'), '/project/p1?tab=tasks&task=t1');
  assert.equal(messageLink('p1', 'c1', 'm1'), '/project/p1?tab=chat&channel=c1&message=m1');
});

test('Indexes for listing, unread filtering and idempotency exist', async () => {
  const indexes = await Notification.collection.indexes();
  const byKey = (key) => indexes.find((index) => JSON.stringify(index.key) === JSON.stringify(key));

  assert.ok(byKey({ recipient: 1, createdAt: -1, _id: -1 }), 'list index');
  assert.ok(byKey({ recipient: 1, read: 1, createdAt: -1 }), 'unread index');
  const dedupe = byKey({ recipient: 1, dedupeKey: 1 });
  assert.ok(dedupe?.unique, 'unique dedupe index');
  assert.deepEqual(dedupe.partialFilterExpression, { dedupeKey: { $type: 'string' } });
});

// ---------------------------------------------------------------- createNotification()

test('createNotification stores a notification for a project member', async () => {
  const saved = await createNotification(sample({ project: new mongoose.Types.ObjectId(projectId) }));
  assert.ok(saved, 'should be stored');
  assert.equal(saved.type, 'assignment');
  assert.equal(saved.read, false);
  assert.equal(String(saved.actor), owner.user.id);
  assert.equal(await Notification.countDocuments({ recipient: member.user.id }), 1);
  await Notification.deleteMany({});
});

test('createNotification skips non-members and the actor themselves', async () => {
  assert.equal(await createNotification(sample({ recipient: outsider.user.id })), null, 'outsider is not a member');
  assert.equal(await createNotification(sample({ recipient: owner.user.id, actor: owner.user.id })), null, 'no self-notification');
  assert.equal(await createNotification(sample({ project: new mongoose.Types.ObjectId().toString() })), null, 'unknown project');
  assert.equal(await Notification.countDocuments({}), 0);
});

test('createNotification never throws on bad input', async () => {
  assert.equal(await createNotification(sample({ type: 'like' })), null);
  assert.equal(await createNotification(sample({ link: 'https://evil.example' })), null);
  assert.equal(await createNotification(sample({ recipient: 'nope' })), null);
  assert.equal(await createNotification({}), null);
  assert.equal(await Notification.countDocuments({}), 0);
});

test('createNotification with a dedupeKey is idempotent', async () => {
  const dedupeKey = `deadline:${taskId}:2026-11-01T00:00:00.000Z`;
  const fields = sample({ type: 'deadline', actor: null, summary: '"Write docs" is due soon', dedupeKey });

  const first = await createNotification(fields);
  const second = await createNotification(fields);
  const [third, fourth] = await Promise.all([createNotification(fields), createNotification(fields)]);

  assert.ok(first && second && third && fourth);
  for (const again of [second, third, fourth]) assert.equal(String(again._id), String(first._id));
  assert.equal(await Notification.countDocuments({ recipient: member.user.id, dedupeKey }), 1);

  // Without a key, two calls make two notifications. The same key for another recipient is separate.
  await createNotification(sample());
  await createNotification(sample());
  const forOwner = await createNotification(sample({ recipient: owner.user.id, actor: null, type: 'deadline', dedupeKey }));
  assert.ok(forOwner);
  assert.notEqual(String(forOwner._id), String(first._id));
  assert.equal(await Notification.countDocuments({}), 4);
  await Notification.deleteMany({});
});

// ---------------------------------------------------------------- API

test('The notifications API requires a signed-in user', async () => {
  assert.equal((await request(app).get('/api/notifications')).status, 401);
  const fakeId = new mongoose.Types.ObjectId().toString();
  assert.equal((await request(app).patch(`/api/notifications/${fakeId}/read`)).status, 401);
  assert.equal((await request(app).get('/api/notifications').set('Authorization', 'Bearer not-a-token')).status, 401);
});

test('Users only see their own notifications, newest first, with actor and project', async () => {
  const start = Date.now() - 60_000;
  const a = await createNotification(sample({ summary: 'first' }));
  const b = await createNotification(sample({ type: 'mention', summary: 'mentioned you in #general', targetType: 'message', link: messageLink(projectId, 'c1', 'm1') }));
  const forOwner = await createNotification(sample({ recipient: owner.user.id, actor: member.user.id, summary: 'for the owner' }));
  await setCreatedAt(a._id, new Date(start));
  await setCreatedAt(b._id, new Date(start + 1000));
  await setCreatedAt(forOwner._id, new Date(start + 2000));

  const res = await list(member);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.notifications.map((n) => n.summary), ['mentioned you in #general', 'first']);
  assert.equal(res.body.unreadCount, 2);
  assert.equal(res.body.nextBefore, null);

  const [latest] = res.body.notifications;
  assert.equal(latest.type, 'mention');
  assert.equal(latest.read, false);
  assert.equal(latest.readAt, null);
  assert.equal(latest.link, `/project/${projectId}?tab=chat&channel=c1&message=m1`);
  assert.equal(latest.actor.name, 'Nia Owner');
  assert.equal(latest.actor.passwordHash, undefined);
  assert.equal(latest.actor.email, undefined, 'only public actor fields are returned');
  assert.equal(latest.project.name, 'Notify Project');
  assert.ok(latest.createdAt);

  const ownerRes = await list(owner);
  assert.deepEqual(ownerRes.body.notifications.map((n) => n.summary), ['for the owner']);
  assert.equal(ownerRes.body.unreadCount, 1);

  const outsiderRes = await list(outsider);
  assert.deepEqual(outsiderRes.body.notifications, []);
  assert.equal(outsiderRes.body.unreadCount, 0);

  await Notification.deleteMany({});
});

test('Notifications page with limit and before, and filter unread', async () => {
  const base = Date.now() - 60_000;
  const ids = [];
  for (let i = 0; i < 5; i += 1) {
    const saved = await createNotification(sample({ summary: `n${i}` }));
    await setCreatedAt(saved._id, new Date(base + i * 1000));
    ids.push(String(saved._id));
  }
  await Notification.collection.updateOne({ _id: new mongoose.Types.ObjectId(ids[4]) }, { $set: { read: true, readAt: new Date() } });

  const first = await list(member, '?limit=2');
  assert.deepEqual(first.body.notifications.map((n) => n.summary), ['n4', 'n3']);
  assert.ok(first.body.nextBefore, 'there should be an older page');
  assert.equal(first.body.unreadCount, 4);

  const second = await list(member, `?limit=2&before=${encodeURIComponent(first.body.nextBefore)}`);
  assert.deepEqual(second.body.notifications.map((n) => n.summary), ['n2', 'n1']);
  const third = await list(member, `?limit=2&before=${encodeURIComponent(second.body.nextBefore)}`);
  assert.deepEqual(third.body.notifications.map((n) => n.summary), ['n0']);
  assert.equal(third.body.nextBefore, null);

  const unread = await list(member, '?unread=true');
  assert.deepEqual(unread.body.notifications.map((n) => n.summary), ['n3', 'n2', 'n1', 'n0']);
  const all = await list(member, '?unread=false');
  assert.equal(all.body.notifications.length, 5);

  // limit is clamped to 1-50
  assert.equal((await list(member, '?limit=0')).body.notifications.length, 5);
  assert.equal((await list(member, '?limit=1')).body.notifications.length, 1);

  assert.equal((await list(member, '?before=yesterday-ish')).status, 400);
  assert.equal((await list(member, '?unread=maybe')).status, 400);

  await Notification.deleteMany({});
});

test('Marking a notification read is limited to its recipient and safe to repeat', async () => {
  const mine = await createNotification(sample());
  const other = await createNotification(sample({ summary: 'still unread' }));
  const url = `/api/notifications/${mine._id}/read`;

  // Another user cannot read or change it, and cannot tell it exists.
  const stranger = await as(outsider).patch(url);
  assert.equal(stranger.status, 404);
  const byOwner = await as(owner).patch(url);
  assert.equal(byOwner.status, 404, 'the actor is not the recipient');
  assert.equal((await Notification.findById(mine._id)).read, false);

  const res = await as(member).patch(url);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.notification.read, true);
  assert.ok(res.body.notification.readAt);
  assert.equal(res.body.notification.actor.name, 'Nia Owner');
  assert.equal(res.body.unreadCount, 1);

  const again = await as(member).patch(url);
  assert.equal(again.status, 200);
  assert.equal(again.body.notification.readAt, res.body.notification.readAt, 'readAt keeps the first read time');
  assert.equal(again.body.unreadCount, 1);

  assert.equal((await Notification.findById(other._id)).read, false, 'other notifications are untouched');

  assert.equal((await as(member).patch('/api/notifications/not-an-id/read')).status, 400);
  assert.equal((await as(member).patch(`/api/notifications/${new mongoose.Types.ObjectId()}/read`)).status, 404);

  await Notification.deleteMany({});
});

test('A removed member no longer sees that project\'s notifications, and gets them back when re-added', async () => {
  const kept = await createNotification(sample({ summary: 'from a project I am in' }));
  assert.ok(kept);
  assert.equal((await list(member)).body.notifications.length, 1);

  // The owner removes the member. The stored rows stay, but are no longer readable by them.
  const removed = await as(owner).delete(`/api/projects/${projectId}/members/${member.user.id}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const afterRemoval = await list(member);
  assert.equal(afterRemoval.status, 200);
  assert.deepEqual(afterRemoval.body.notifications, [], 'no summaries or links of a project they left');
  assert.equal(afterRemoval.body.unreadCount, 0, 'the unread badge ignores it too');
  assert.equal((await as(member).patch(`/api/notifications/${kept._id}/read`)).status, 404);
  assert.equal((await Notification.findById(kept._id)).read, false, 'a removed member cannot change it');
  assert.equal(await Notification.countDocuments({ recipient: member.user.id }), 1, 'the row itself is kept');

  // New notifications are not created for someone who is not a member (already covered), and
  // adding them again makes the kept one visible again.
  const readded = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: member.user.username, role: 'Contributor' });
  assert.equal(readded.status, 201, JSON.stringify(readded.body));
  const back = await list(member);
  assert.deepEqual(back.body.notifications.map((n) => n.summary), ['from a project I am in']);
  assert.equal(back.body.unreadCount, 1);

  await Notification.deleteMany({});
});
