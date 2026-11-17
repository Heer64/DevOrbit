// [Sprint 6 · M7] US-56 Moderate reported posts (FR-27, NFR-19, NFR-22) against a real MongoDB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed, pngBytes } from './helpers.js';
import User from '../src/models/User.js';
import Post from '../src/models/Post.js';
import PostCreateLog from '../src/models/PostCreateLog.js';
import PostReport from '../src/models/PostReport.js';
import PostVote from '../src/models/PostVote.js';
import Notification from '../src/models/Notification.js';
import ModerationAction from '../src/models/ModerationAction.js';
import ModerationLock from '../src/models/ModerationLock.js'; // imported so setup() builds its unique index
import { POST_IMAGES_BUCKET } from '../src/lib/postImages.js';
import { MODERATION_MESSAGES } from '../src/lib/moderationRules.js';

let app;
let author, moderator, admin, regular, r1, r2, r3, r4, r5;

const as = (account) => authed(app, account.token);
const queue = (account = moderator) => as(account).get('/api/moderation/reports');
const act = (account, postId, action) => as(account).post(`/api/moderation/reports/${postId}/${action}`).send({});
const report = (account, postId, reason = 'spam', details) =>
  as(account).post(`/api/posts/${postId}/report`).send(details ? { reason, details } : { reason });
const vote = (account, postId, value) =>
  request(app).put(`/api/posts/${postId}/vote`).set('Authorization', `Bearer ${account.token}`).send({ value });

const newPost = async (account = author, text = 'Buy cheap followers now, click my link') => {
  await PostCreateLog.deleteMany({ user: account.user.id }); // the 10-posts-per-hour limit is tested elsewhere
  const res = await as(account).post('/api/posts').send({ text });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.post._id;
};
const imagePost = async () => {
  await PostCreateLog.deleteMany({ user: author.user.id });
  const res = await request(app).post('/api/posts').set('Authorization', `Bearer ${author.token}`)
    .field('text', 'Look at this picture').attach('image', pngBytes(2048), { filename: 'shot.png', contentType: 'image/png' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.post._id;
};
const entryFor = async (postId, account = moderator) => (await queue(account)).body.reports.find((item) => item.post._id === postId) || null;
const imageFiles = () => mongoose.connection.db.collection(`${POST_IMAGES_BUCKET}.files`).countDocuments();

before(async () => {
  ({ app } = await setup());
  [author, moderator, admin, regular, r1, r2, r3, r4, r5] = await Promise.all(
    ['Asha Author', 'Mo Moderator', 'Ada Admin', 'Uma User', 'Rae One', 'Rae Two', 'Rae Three', 'Rae Four', 'Rae Five']
      .map((name) => signup(app, name))
  );
  await User.updateOne({ _id: moderator.user.id }, { $set: { platformRole: 'moderator' } });
  await User.updateOne({ _id: admin.user.id }, { $set: { platformRole: 'admin' } });
});

after(teardown);

// --- US-56 AC1: the queue ------------------------------------------------------------------------------------

test('AC1: the queue shows each reported post with its reasons and report count, the longest-waiting first', async () => {
  const first = await newPost(author, 'First reported post');
  const second = await newPost(author, 'Second reported post');
  await report(r1, first, 'spam');
  await report(r2, first, 'harassment');
  await report(r3, first, 'spam');
  await report(r1, second, 'other', 'Links to a phishing site');

  const res = await queue();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.reports.map((item) => item.post._id);
  assert.ok(ids.indexOf(first) < ids.indexOf(second), 'oldest first');

  const one = res.body.reports.find((item) => item.post._id === first);
  assert.equal(one.reportCount, 3);
  assert.deepEqual(one.reasons, [
    { reason: 'spam', label: 'Spam or misleading', count: 2 },
    { reason: 'harassment', label: 'Harassment or bullying', count: 1 },
  ]);
  assert.equal(one.post.text, 'First reported post');
  assert.equal(one.post.author.name, 'Asha Author');
  assert.equal(one.post.hasImage, false);
  assert.equal(one.ownPost, false);

  const two = res.body.reports.find((item) => item.post._id === second);
  assert.equal(two.reportCount, 1);
  assert.equal(two.notes[0].details, 'Links to a phishing site');
  assert.equal(two.notes[0].label, 'Something else');
});

test('the queue never says who reported a post and has no secrets', async () => {
  const postId = await newPost();
  await report(r4, postId, 'other', 'Please check');
  const body = JSON.stringify((await queue()).body);
  for (const account of [r1, r2, r3, r4]) {
    assert.equal(body.includes(account.user.id), false, 'no reporter IDs');
    assert.equal(body.includes(account.user.name), false, 'no reporter names');
  }
  assert.equal(/@|password|token|storageId|"reporter"/i.test(body), false);
});

// --- US-56 AC3: 401 / 403 ------------------------------------------------------------------------------------

test('AC3: a user who is not a moderator gets 403 for the queue, every action and the log; no login gets 401', async () => {
  const postId = await newPost();
  await report(r1, postId);
  assert.equal((await queue(regular)).status, 403);
  for (const action of ['remove', 'warn', 'dismiss']) {
    assert.equal((await act(regular, postId, action)).status, 403, action);
    assert.equal((await request(app).post(`/api/moderation/reports/${postId}/${action}`)).status, 401, action);
  }
  assert.equal((await as(regular).get('/api/moderation/actions')).status, 403);
  assert.equal((await request(app).get('/api/moderation/reports')).status, 401);
  assert.ok(await Post.exists({ _id: postId }), 'nothing changed');
  assert.equal(await PostReport.countDocuments({ post: postId, status: 'open' }), 1);
});

test('AC3: a moderator whose role is revoked is refused on the next request', async () => {
  const temp = await signup(app, 'Temp Moderator');
  await User.updateOne({ _id: temp.user.id }, { $set: { platformRole: 'moderator' } });
  assert.equal((await queue(temp)).status, 200);
  await User.updateOne({ _id: temp.user.id }, { $set: { platformRole: 'user' } });
  assert.equal((await queue(temp)).status, 403);
});

test('a Platform Admin can moderate too', async () => {
  const postId = await newPost();
  await report(r1, postId);
  assert.ok(await entryFor(postId, admin));
  const res = await act(admin, postId, 'dismiss');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.moderationAction.moderator.name, 'Ada Admin');
});

// --- US-56 AC2: Remove / Warn / Dismiss ---------------------------------------------------------------------

test('AC2 Remove: the post, its image and its votes are deleted and all its open reports are resolved', async () => {
  const postId = await imagePost();
  await vote(r1, postId, 1);
  await vote(r2, postId, -1);
  for (const account of [r1, r2, r3, r4, r5]) assert.equal((await report(account, postId, 'explicit')).status, 201);
  const imagesBefore = await imageFiles();

  const res = await act(moderator, postId, 'remove');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.resolution, 'removed');
  assert.equal(res.body.resolvedReports, 5);
  assert.equal(res.body.message, MODERATION_MESSAGES.removed);

  assert.equal(await Post.exists({ _id: postId }), null);
  assert.equal(await PostVote.countDocuments({ post: postId }), 0);
  assert.equal(await imageFiles(), imagesBefore - 1);
  const reports = await PostReport.find({ post: postId }).lean();
  assert.equal(reports.length, 5, 'reports are kept as history');
  assert.ok(reports.every((r) => r.status === 'resolved' && r.resolution === 'removed' && String(r.resolvedBy) === moderator.user.id && r.resolvedAt));
  assert.equal(await entryFor(postId), null, 'it left the queue');
  assert.equal((await as(r1).get(`/api/posts/${postId}`)).status, 404, 'gone for everyone');
  const feed = await as(r1).get('/api/posts');
  assert.equal(feed.status, 200);
  assert.equal(feed.body.posts.some((p) => p._id === postId), false, 'no longer in the feed');
});

test('AC2 Warn: the author gets exactly one in-app "Moderation warning"; the post stays', async () => {
  const postId = await newPost(author, 'You are all idiots, this app is trash');
  await report(r1, postId, 'harassment');
  await report(r2, postId, 'harassment');
  await report(r3, postId, 'spam');

  const res = await act(moderator, postId, 'warn');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.resolution, 'warned');
  assert.equal(res.body.notified, true);
  assert.ok(await Post.exists({ _id: postId }), 'the post is kept');

  const warnings = await Notification.find({ recipient: author.user.id, type: 'moderation_warning', targetId: postId }).lean();
  assert.equal(warnings.length, 1);
  const [warning] = warnings;
  assert.equal(warning.project, null);
  assert.equal(warning.actor, null, 'the author is not told which moderator');
  assert.equal(warning.link, '/feed');
  assert.equal(warning.targetType, 'post');
  assert.match(warning.summary, /^A Content Moderator warned you about your post "You are all idiots, this app is trash" \(reason: Harassment or bullying\)/);

  // The author sees it in their bell list and unread count, although it belongs to no project.
  const list = await as(author).get('/api/notifications');
  assert.equal(list.status, 200);
  const shown = list.body.notifications.find((n) => n.type === 'moderation_warning' && String(n.targetId) === postId);
  assert.ok(shown, 'warning is listed');
  assert.equal(shown.project, null);
  assert.ok(list.body.unreadCount >= 1);
  const marked = await as(author).patch(`/api/notifications/${shown._id}/read`);
  assert.equal(marked.status, 200);
  assert.equal(marked.body.notification.read, true);

  const reports = await PostReport.find({ post: postId }).lean();
  assert.ok(reports.every((r) => r.status === 'resolved' && r.resolution === 'warned'));
});

test('AC2 Dismiss: nothing changes on the post; the reports are closed', async () => {
  const postId = await newPost(author, 'An ordinary post');
  await vote(r1, postId, 1);
  await report(r2, postId, 'spam');
  const before = await Post.findById(postId).lean();

  const res = await act(moderator, postId, 'dismiss');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.resolution, 'dismissed');
  const after = await Post.findById(postId).lean();
  assert.equal(after.text, before.text);
  assert.equal(after.score, before.score);
  assert.equal(String(after.updatedAt), String(before.updatedAt));
  assert.equal(await Notification.countDocuments({ recipient: author.user.id, targetId: postId }), 0);
  assert.equal((await PostReport.findOne({ post: postId }).lean()).resolution, 'dismissed');
  assert.equal(await entryFor(postId), null);
});

test('the same users cannot report again after a decision, but a new reporter puts the post back in the queue', async () => {
  const postId = await newPost();
  await report(r1, postId);
  await act(moderator, postId, 'dismiss');
  assert.equal((await report(r1, postId)).status, 409, 'one report per user per post (US-55)');
  assert.equal(await entryFor(postId), null);
  assert.equal((await report(r2, postId, 'hate')).status, 201);
  const entry = await entryFor(postId);
  assert.equal(entry.reportCount, 1, 'only the new open report counts');
});

// --- Log ------------------------------------------------------------------------------------------------------

test('every outcome is logged (moderator, action, post, author, count, reasons) without secrets', async () => {
  const postId = await newPost(author, 'Logged post text');
  await report(r1, postId, 'spam');
  await report(r2, postId, 'violence');
  await act(moderator, postId, 'warn');

  const row = await ModerationAction.findOne({ post: postId }).lean();
  assert.equal(row.action, 'warn');
  assert.equal(String(row.moderator), moderator.user.id);
  assert.equal(String(row.postAuthor), author.user.id);
  assert.equal(row.reportCount, 2);
  assert.equal(row.postExcerpt, 'Logged post text');
  assert.equal(row.notified, true);

  const log = await as(moderator).get('/api/moderation/actions');
  assert.equal(log.status, 200);
  const [newest] = log.body.actions;
  assert.equal(newest.postId, postId);
  assert.equal(newest.resolution, 'warned');
  assert.equal(newest.moderator.name, 'Mo Moderator');
  assert.equal(newest.postAuthor.name, 'Asha Author');
  assert.deepEqual(newest.reasons.map((r) => r.label).sort(), ['Spam or misleading', 'Violence or threats']);
  const text = JSON.stringify(log.body);
  assert.equal(/@|password|token|cookie|storageId/i.test(text), false);
  assert.equal(text.includes(r1.user.id) || text.includes(r2.user.id), false, 'no reporter IDs');
});

// --- Errors and races ---------------------------------------------------------------------------------------

test('400 for a bad ID; 404 for an unknown post or a post with no open reports', async () => {
  assert.equal((await act(moderator, 'not-an-id', 'warn')).status, 400);
  assert.equal((await act(moderator, new mongoose.Types.ObjectId().toString(), 'remove')).status, 404);
  const clean = await newPost(author, 'Nobody reported me');
  const res = await act(moderator, clean, 'dismiss');
  assert.equal(res.status, 404);
  assert.equal(res.body.message, MODERATION_MESSAGES.noOpenReports);
  assert.equal((await as(moderator).post(`/api/moderation/reports/${clean}/delete`)).status, 404, 'unknown action route');
});

test('two moderators at the same moment: one action happens, the other gets 409', async () => {
  const second = await signup(app, 'Second Moderator');
  await User.updateOne({ _id: second.user.id }, { $set: { platformRole: 'moderator' } });
  const postId = await newPost(author, 'Race me');
  await report(r1, postId, 'spam');
  await report(r2, postId, 'spam');

  const results = await Promise.all([act(moderator, postId, 'warn'), act(second, postId, 'remove')]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify(results.map((r) => r.body)));
  const loser = results.find((r) => r.status === 409);
  assert.equal(loser.body.message, MODERATION_MESSAGES.alreadyHandled);
  assert.equal(await ModerationAction.countDocuments({ post: postId }), 1);
  assert.equal(await ModerationLock.countDocuments({ post: postId }), 0, 'the lock is released');

  // A double click by the same moderator never warns twice.
  const again = await newPost(author, 'Double click');
  await report(r3, again, 'spam');
  const twice = await Promise.all([act(moderator, again, 'warn'), act(moderator, again, 'warn')]);
  assert.deepEqual(twice.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await Notification.countDocuments({ recipient: author.user.id, targetId: again, type: 'moderation_warning' }), 1);
});

test('own post: a moderator may resolve reports on their own post; Warn sends no self-notification', async () => {
  const own = await newPost(moderator, 'Moderator wrote this');
  await report(r1, own, 'spam');
  const entry = await entryFor(own);
  assert.equal(entry.ownPost, true);

  const res = await act(moderator, own, 'warn');
  assert.equal(res.status, 200);
  assert.equal(res.body.notified, false);
  assert.equal(res.body.message, MODERATION_MESSAGES.warnedSelf);
  assert.equal(await Notification.countDocuments({ recipient: moderator.user.id, type: 'moderation_warning' }), 0);

  const another = await newPost(moderator, 'Moderator wrote this too');
  await report(r2, another, 'spam');
  assert.equal((await act(moderator, another, 'remove')).status, 200);
  assert.equal(await Post.exists({ _id: another }), null);
});

test('an author deleting their reported post first: the moderator gets 404, nothing breaks', async () => {
  const postId = await newPost(author, 'Delete me before review');
  await report(r1, postId);
  assert.equal((await as(author).delete(`/api/posts/${postId}`)).status, 200);
  assert.equal(await entryFor(postId), null);
  assert.equal((await act(moderator, postId, 'warn')).status, 404);
});
