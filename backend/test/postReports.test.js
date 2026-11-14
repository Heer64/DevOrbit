// [Sprint 6 · M6] US-55 Report a public post (FR-27, NFR-19, NFR-21, NFR-26) against a real MongoDB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Post from '../src/models/Post.js';
import PostCreateLog from '../src/models/PostCreateLog.js';
import PostReport from '../src/models/PostReport.js';
import { openReportQueue } from '../src/lib/postReports.js';
import { POST_NOT_FOUND_MESSAGE } from '../src/lib/postRules.js';
import {
  REPORT_ALREADY_MESSAGE,
  REPORT_CREATED_MESSAGE,
  REPORT_DETAILS_REQUIRED_MESSAGE,
  REPORT_DETAILS_TOO_LONG_MESSAGE,
  REPORT_DETAILS_TYPE_MESSAGE,
  REPORT_OWN_POST_MESSAGE,
  REPORT_REASON_MESSAGE,
  REPORT_STATUS_RESOLVED,
} from '../src/lib/reportRules.js';

let app;
let author, reporter, second, third, racer;

const as = (account) => authed(app, account.token);
const report = (account, postId, body) => as(account).post(`/api/posts/${postId}/report`).send(body);
const status = (account, postId) => as(account).get(`/api/posts/${postId}/report`);
// authed() in helpers.js has no .put(), so votes are sent with supertest directly (like postVotes.test.js).
const vote = (account, postId, value) =>
  request(app).put(`/api/posts/${postId}/vote`).set('Authorization', `Bearer ${account.token}`).send({ value });

const newPost = async (account = author, text = 'Please review me') => {
  // This file creates more than 10 posts. The M6 limit (10 posts per hour, tested in posts.test.js)
  // is not what is tested here, so the author's post-limit slots are cleared first.
  await PostCreateLog.deleteMany({ user: account.user.id });
  const res = await as(account).post('/api/posts').send({ text });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.post._id;
};
const queueEntry = async (postId) => (await openReportQueue({ postId }))[0] || null;
const storedReports = (postId) => PostReport.countDocuments({ post: postId });

before(async () => {
  ({ app } = await setup());
  [author, reporter, second, third, racer] = await Promise.all(
    ['Asha Author', 'Rae Reporter', 'Sid Second', 'Tia Third', 'Ray Racer'].map((name) => signup(app, name))
  );
});

after(async () => {
  await teardown();
});

test('reporting needs a login (NFR-19)', async () => {
  const postId = await newPost();
  assert.equal((await request(app).post(`/api/posts/${postId}/report`).send({ reason: 'spam' })).status, 401);
  assert.equal((await request(app).get(`/api/posts/${postId}/report`)).status, 401);
  assert.equal(await storedReports(postId), 0);
});

test('US-55 AC1: report with a reason -> 201, success message, and the report is in the moderator queue', async () => {
  const postId = await newPost();
  assert.equal(await queueEntry(postId), null, 'not in the queue before it is reported');

  const res = await report(reporter, postId, { reason: 'spam' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message, REPORT_CREATED_MESSAGE);
  assert.equal(res.body.report.post, postId);
  assert.equal(res.body.report.reason, 'spam');
  assert.equal(res.body.report.reasonLabel, 'Spam or misleading');
  assert.equal(res.body.report.status, 'open');
  assert.equal(res.body.report.details, '');
  assert.equal('reporter' in res.body.report, false, 'the response never names reporters');

  // Stored as an open report, by this user, for this post.
  const stored = await PostReport.findOne({ post: postId }).lean();
  assert.equal(String(stored.reporter), reporter.user.id);
  assert.equal(stored.status, 'open');

  // ... which is exactly what the moderator queue (US-56) lists: the post, its reason and report count.
  const entry = await queueEntry(postId);
  assert.equal(entry.postId, postId);
  assert.equal(entry.reportCount, 1);
  assert.deepEqual(entry.reasons, [{ reason: 'spam', label: 'Spam or misleading', count: 1 }]);
  assert.ok(entry.firstReportedAt);
});

test('US-55 AC1: details are saved (trimmed); "Something else" needs details', async () => {
  const postId = await newPost();

  const missing = await report(reporter, postId, { reason: 'other', details: '   ' });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.body, { message: REPORT_DETAILS_REQUIRED_MESSAGE, field: 'details' });
  assert.equal(await storedReports(postId), 0, 'a refused report stores nothing');

  const res = await report(reporter, postId, { reason: 'other', details: '  Copies my project word for word.  ' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.report.details, 'Copies my project word for word.');
  assert.equal(res.body.report.reasonLabel, 'Something else');
});

test('US-55 AC2: reporting the same post again -> 409 "You have already reported this post." and nothing new is stored', async () => {
  const postId = await newPost();
  assert.equal((await report(reporter, postId, { reason: 'harassment' })).status, 201);

  // Even with a different reason, the second report is refused.
  const again = await report(reporter, postId, { reason: 'spam', details: 'trying again' });
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(again.body.message, REPORT_ALREADY_MESSAGE);
  assert.equal(again.body.code, 'already_reported');
  assert.equal(again.body.report.reason, 'harassment', 'the first report is kept unchanged');

  assert.equal(await storedReports(postId), 1);
  assert.equal((await queueEntry(postId)).reportCount, 1, 'the same user is counted once in the queue');
});

test('US-55 AC2: the same report sent many times at the same moment is stored once', async () => {
  const postId = await newPost();
  const results = await Promise.all(Array.from({ length: 8 }, () => report(racer, postId, { reason: 'violence' })));
  const codes = results.map((res) => res.status).sort();

  assert.deepEqual(codes, [201, 409, 409, 409, 409, 409, 409, 409], JSON.stringify(codes));
  for (const res of results.filter((item) => item.status === 409)) assert.equal(res.body.message, REPORT_ALREADY_MESSAGE);
  assert.equal(await storedReports(postId), 1);
});

test('GET tells the user whether they already reported the post (only their own report)', async () => {
  const postId = await newPost();

  const first = await status(reporter, postId);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { reported: false, report: null });

  await report(second, postId, { reason: 'hate' });
  assert.deepEqual((await status(reporter, postId)).body, { reported: false, report: null }, 'another user’s report is not mine');

  await report(reporter, postId, { reason: 'explicit' });
  const later = await status(reporter, postId);
  assert.equal(later.body.reported, true);
  assert.equal(later.body.report.reason, 'explicit');
  assert.equal('reporter' in later.body.report, false);
});

test('different users each add a report: the queue shows the report count and the reasons', async () => {
  const postId = await newPost();
  for (const [account, reason] of [
    [reporter, 'spam'],
    [second, 'spam'],
    [third, 'hate'],
  ]) {
    assert.equal((await report(account, postId, { reason })).status, 201);
  }

  const entry = await queueEntry(postId);
  assert.equal(entry.reportCount, 3);
  assert.deepEqual(entry.reasons, [
    { reason: 'spam', label: 'Spam or misleading', count: 2 },
    { reason: 'hate', label: 'Hate speech or symbols', count: 1 },
  ]);
  // The whole queue lists it too (oldest first), and only posts with open reports.
  const queue = await openReportQueue();
  assert.ok(queue.some((item) => item.postId === postId));
  for (const item of queue) assert.ok(item.reportCount >= 1);
});

test('a resolved report (US-56) leaves the queue; the user is still told they already reported it', async () => {
  const postId = await newPost();
  await report(reporter, postId, { reason: 'spam' });
  await PostReport.updateMany({ post: postId }, { status: REPORT_STATUS_RESOLVED });

  assert.equal(await queueEntry(postId), null);
  const again = await report(reporter, postId, { reason: 'spam' });
  assert.equal(again.status, 409);
  assert.equal(again.body.message, REPORT_ALREADY_MESSAGE);
});

test('NFR-21: bad input is refused with a reason, and nothing is stored', async () => {
  const postId = await newPost();
  const cases = [
    [{}, REPORT_REASON_MESSAGE, 'reason'],
    [{ reason: '' }, REPORT_REASON_MESSAGE, 'reason'],
    [{ reason: 'SPAM' }, REPORT_REASON_MESSAGE, 'reason'],
    [{ reason: 'not-a-reason' }, REPORT_REASON_MESSAGE, 'reason'],
    [{ reason: ['spam'] }, REPORT_REASON_MESSAGE, 'reason'],
    [{ reason: { $ne: null } }, REPORT_REASON_MESSAGE, 'reason'],
    [{ reason: 5 }, REPORT_REASON_MESSAGE, 'reason'],
    [{ reason: 'spam', details: 7 }, REPORT_DETAILS_TYPE_MESSAGE, 'details'],
    [{ reason: 'spam', details: { $gt: '' } }, REPORT_DETAILS_TYPE_MESSAGE, 'details'],
    [{ reason: 'spam', details: 'x'.repeat(301) }, REPORT_DETAILS_TOO_LONG_MESSAGE, 'details'],
  ];
  for (const [body, message, field] of cases) {
    const res = await report(reporter, postId, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(res.body, { message, field }, JSON.stringify(body));
  }
  assert.equal(await storedReports(postId), 0);

  // Exactly 300 characters is allowed.
  assert.equal((await report(reporter, postId, { reason: 'spam', details: 'x'.repeat(300) })).status, 201);
});

test('bad or unknown post IDs: 400 / 404', async () => {
  assert.equal((await report(reporter, 'not-an-id', { reason: 'spam' })).status, 400);
  assert.equal((await status(reporter, 'not-an-id')).status, 400);

  const unknown = new mongoose.Types.ObjectId().toString();
  const res = await report(reporter, unknown, { reason: 'spam' });
  assert.equal(res.status, 404);
  assert.equal(res.body.message, POST_NOT_FOUND_MESSAGE);
  assert.equal((await status(reporter, unknown)).status, 404);
  assert.equal(await storedReports(unknown), 0);
});

test('a user cannot report their own post', async () => {
  const postId = await newPost(author);
  const res = await report(author, postId, { reason: 'spam' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'own_post');
  assert.equal(res.body.message, REPORT_OWN_POST_MESSAGE);
  assert.equal(await storedReports(postId), 0);
});

test('when the author deletes a reported post, its open reports leave the queue; resolved ones stay as history', async () => {
  const postId = await newPost();
  await report(reporter, postId, { reason: 'spam' });
  await report(second, postId, { reason: 'hate' });
  await PostReport.updateOne({ post: postId, reporter: second.user.id }, { status: REPORT_STATUS_RESOLVED });

  const removed = await as(author).delete(`/api/posts/${postId}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  assert.equal(await queueEntry(postId), null);
  assert.equal(await PostReport.countDocuments({ post: postId, status: 'open' }), 0);
  assert.equal(await PostReport.countDocuments({ post: postId, status: REPORT_STATUS_RESOLVED }), 1);

  // Reporting the deleted post now: 404, nothing stored.
  const late = await report(third, postId, { reason: 'spam' });
  assert.equal(late.status, 404);
  assert.equal(await PostReport.countDocuments({ post: postId, reporter: third.user.id }), 0);
});

test('reporting does not change the post: text, votes, score and feed stay the same (US-50–US-53 unaffected)', async () => {
  const postId = await newPost(author, 'Still here after a report');
  assert.equal((await vote(second, postId, 1)).status, 200);
  const original = await Post.findById(postId).lean();

  assert.equal((await report(reporter, postId, { reason: 'spam' })).status, 201);

  const reported = await Post.findById(postId).lean();
  assert.equal(reported.text, original.text);
  assert.equal(reported.upvotes, 1);
  assert.equal(reported.score, 1);
  assert.equal(String(reported.updatedAt), String(original.updatedAt));

  // Still listed and readable for everyone (a report alone hides nothing; only a moderator's Remove does, US-56).
  const feed = await as(third).get('/api/posts?limit=50');
  assert.ok(feed.body.posts.some((post) => post._id === postId));
  assert.equal((await as(reporter).get(`/api/posts/${postId}`)).status, 200);
  // The voting and post routes still answer as before, next to the new report route.
  assert.equal((await vote(reporter, postId, -1)).status, 200);
  assert.equal((await as(author).patch(`/api/posts/${postId}`).send({ text: 'Edited after a report' })).status, 200);
});
