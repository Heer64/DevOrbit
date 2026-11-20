// [Sprint 7 · M3] Comments and replies on feed posts, against a real MongoDB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import User from '../src/models/User.js';
import Post from '../src/models/Post.js';
import PostComment from '../src/models/PostComment.js';
import PostCreateLog from '../src/models/PostCreateLog.js';
import Notification from '../src/models/Notification.js';
import {
  COMMENT_CREATED_MESSAGE,
  COMMENT_DELETED_MESSAGE,
  COMMENT_NOT_AUTHOR_MESSAGE,
  COMMENT_NOT_FOUND_MESSAGE,
  COMMENT_PARENT_NOT_FOUND_MESSAGE,
  COMMENT_REPLY_TO_REPLY_MESSAGE,
  COMMENT_TEXT_MAX,
  COMMENT_TEXT_REQUIRED_MESSAGE,
  COMMENT_TEXT_TOO_LONG_MESSAGE,
  COMMENT_UPDATED_MESSAGE,
  REPLY_CREATED_MESSAGE,
} from '../src/lib/commentRules.js';
import { POST_NOT_FOUND_MESSAGE } from '../src/lib/postRules.js';

let app;
let asha, ben, cara, moderator;

const as = (account) => authed(app, account.token);
const url = (postId, commentId = '') => `/api/posts/${postId}/comments${commentId ? `/${commentId}` : ''}`;
const comment = (account, postId, text, parentId) =>
  as(account).post(url(postId)).send(parentId === undefined ? { text } : { text, parentId });
const list = (account, postId, query = '') => as(account).get(`${url(postId)}${query}`);
const edit = (account, postId, commentId, text) => as(account).patch(url(postId, commentId)).send({ text });
const remove = (account, postId, commentId) => as(account).delete(url(postId, commentId));
const storedCount = async (postId) => (await Post.findById(postId).select('commentCount').lean())?.commentCount;

const newPost = async (account = asha, text = 'Our first release is out') => {
  await PostCreateLog.deleteMany({ user: account.user.id }); // the 10-posts-per-hour limit is tested elsewhere
  const res = await as(account).post('/api/posts').send({ text });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.post._id;
};
const added = async (account, postId, text, parentId) => {
  const res = await comment(account, postId, text, parentId);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.comment;
};

before(async () => {
  ({ app } = await setup());
  [asha, ben, cara, moderator] = await Promise.all(['Asha Author', 'Ben Other', 'Cara Third', 'Mo Moderator'].map((name) => signup(app, name)));
  await User.updateOne({ _id: moderator.user.id }, { $set: { platformRole: 'moderator' } });
});

after(teardown);

// --- Login (NFR-19) -----------------------------------------------------------------------------------

test('listing, commenting, editing and deleting comments need a login', async () => {
  const id = new mongoose.Types.ObjectId().toString();
  assert.equal((await request(app).get(url(id))).status, 401);
  assert.equal((await request(app).post(url(id)).send({ text: 'Hi' })).status, 401);
  assert.equal((await request(app).patch(url(id, id)).send({ text: 'Hi' })).status, 401);
  assert.equal((await request(app).delete(url(id, id))).status, 401);
});

// --- Comment on a post --------------------------------------------------------------------------------

test('comment on a post: saved with author and time, counted on the post card', async () => {
  const postId = await newPost();
  const res = await comment(ben, postId, '  Congrats on the launch!\r\nWell done.  ');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message, COMMENT_CREATED_MESSAGE);
  assert.equal(res.body.commentCount, 1);
  const saved = res.body.comment;
  assert.equal(saved.text, 'Congrats on the launch!\nWell done.');
  assert.equal(saved.post, postId);
  assert.equal(saved.parent, null);
  assert.equal(saved.author._id, ben.user.id);
  assert.equal(saved.author.name, 'Ben Other');
  assert.equal(saved.isMine, true);
  assert.equal(saved.edited, false);
  assert.equal(saved.deleted, false);
  assert.ok(saved.createdAt);
  assert.deepEqual(saved.replies, []);

  // The count is on the post everywhere posts are shown.
  assert.equal((await as(cara).get(`/api/posts/${postId}`)).body.post.commentCount, 1);
  const feed = await as(cara).get('/api/posts');
  assert.equal(feed.body.posts.find((post) => post._id === postId).commentCount, 1);
  const trending = await as(cara).get('/api/posts/trending');
  assert.equal(trending.body.posts.find((post) => post._id === postId).commentCount, 1);

  // Someone else sees it, but not as theirs.
  const seen = await list(cara, postId);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.commentCount, 1);
  assert.equal(seen.body.comments.length, 1);
  assert.equal(seen.body.comments[0].isMine, false);
});

test('a comment that fails validation is refused with a message and nothing is stored', async () => {
  const postId = await newPost();
  const cases = [
    [{}, COMMENT_TEXT_REQUIRED_MESSAGE],
    [{ text: '   ' }, COMMENT_TEXT_REQUIRED_MESSAGE],
    [{ text: 'a'.repeat(COMMENT_TEXT_MAX + 1) }, COMMENT_TEXT_TOO_LONG_MESSAGE],
    [{ text: 12 }, 'Comment text must be text.'],
  ];
  for (const [body, message] of cases) {
    const res = await as(ben).post(url(postId)).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.message, message);
  }
  assert.equal((await comment(ben, postId, 'a'.repeat(COMMENT_TEXT_MAX))).status, 201, 'exactly 500 characters is fine');
  assert.equal(await PostComment.countDocuments({ post: postId }), 1);
  assert.equal(await storedCount(postId), 1);
});

test('unknown, deleted or invalid posts: 404 / 400', async () => {
  const missing = new mongoose.Types.ObjectId().toString();
  assert.equal((await comment(ben, missing, 'Hello')).status, 404);
  assert.equal((await comment(ben, missing, 'Hello')).body.message, POST_NOT_FOUND_MESSAGE);
  assert.equal((await list(ben, missing)).status, 404);
  assert.equal((await comment(ben, 'not-an-id', 'Hello')).status, 400);
  assert.equal((await list(ben, 'not-an-id')).status, 400);
});

// --- Replies (one level deep) -------------------------------------------------------------------------

test('reply to a comment: shown under it, oldest first, counted on the post', async () => {
  const postId = await newPost();
  const first = await added(ben, postId, 'First comment');
  const second = await added(cara, postId, 'Second comment');
  const res = await comment(asha, postId, 'Thanks Ben!', first._id);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message, REPLY_CREATED_MESSAGE);
  assert.equal(res.body.comment.parent, first._id);
  assert.equal(res.body.commentCount, 3, 'comments and replies both count');
  await added(cara, postId, 'Agreed', first._id);

  const { body } = await list(ben, postId);
  assert.deepEqual(body.comments.map((c) => c._id), [first._id, second._id], 'oldest comment first');
  assert.equal(body.comments[0].replyCount, 2);
  assert.deepEqual(body.comments[0].replies.map((r) => r.text), ['Thanks Ben!', 'Agreed']);
  assert.equal(body.comments[1].replyCount, 0);
  assert.equal(body.commentCount, 4);
  assert.equal(await storedCount(postId), 4);
});

test('replies are one level deep: a reply to a reply is refused', async () => {
  const postId = await newPost();
  const top = await added(ben, postId, 'Top');
  const reply = await added(cara, postId, 'Reply', top._id);
  const res = await comment(asha, postId, 'Reply to reply', reply._id);
  assert.equal(res.status, 400);
  assert.equal(res.body.message, COMMENT_REPLY_TO_REPLY_MESSAGE);
  assert.equal(res.body.code, 'reply_to_reply');
  assert.equal(await storedCount(postId), 2);
});

test('a reply must point at a comment of the SAME post', async () => {
  const one = await newPost();
  const other = await newPost();
  const elsewhere = await added(ben, other, 'On the other post');
  const res = await comment(cara, one, 'Sneaky', elsewhere._id);
  assert.equal(res.status, 400);
  assert.equal(res.body.message, COMMENT_PARENT_NOT_FOUND_MESSAGE);
  assert.equal((await comment(cara, one, 'Bad', 'xyz')).status, 400);
  assert.equal((await comment(cara, one, 'Bad', { $ne: null })).status, 400, 'an object is not an ID');
  assert.equal(await PostComment.countDocuments({ post: one }), 0);
});

// --- Edit your own -------------------------------------------------------------------------------------

test('edit your own comment or reply: new text shows with "edited"; same text is not an edit', async () => {
  const postId = await newPost();
  const top = await added(ben, postId, 'Typo hree');
  const reply = await added(cara, postId, 'Reply', top._id);

  const same = await edit(ben, postId, top._id, 'Typo hree');
  assert.equal(same.status, 200);
  assert.equal(same.body.comment.edited, false);

  const res = await edit(ben, postId, top._id, 'Typo here');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.message, COMMENT_UPDATED_MESSAGE);
  assert.equal(res.body.comment.text, 'Typo here');
  assert.equal(res.body.comment.edited, true);
  assert.ok(res.body.comment.editedAt);

  const replyEdit = await edit(cara, postId, reply._id, 'Reply (fixed)');
  assert.equal(replyEdit.status, 200);
  assert.equal(replyEdit.body.comment.edited, true);

  const { body } = await list(asha, postId);
  assert.equal(body.comments[0].text, 'Typo here');
  assert.equal(body.comments[0].edited, true);
  assert.equal(body.comments[0].replies[0].text, 'Reply (fixed)');

  assert.equal((await edit(ben, postId, top._id, '')).status, 400);
  assert.equal((await edit(ben, postId, top._id, 'a'.repeat(COMMENT_TEXT_MAX + 1))).body.message, COMMENT_TEXT_TOO_LONG_MESSAGE);
});

test("nobody can edit or delete someone else's comment (403), not even the post's author", async () => {
  const postId = await newPost(asha);
  const theirs = await added(ben, postId, 'Ben wrote this');
  for (const account of [asha, cara]) {
    const editRes = await edit(account, postId, theirs._id, 'Hacked');
    assert.equal(editRes.status, 403);
    assert.equal(editRes.body.message, COMMENT_NOT_AUTHOR_MESSAGE);
    const delRes = await remove(account, postId, theirs._id);
    assert.equal(delRes.status, 403);
  }
  const stored = await PostComment.findById(theirs._id).lean();
  assert.equal(stored.text, 'Ben wrote this');
  assert.equal(stored.editedAt, null);
  assert.equal(await storedCount(postId), 1);
});

test('a comment is only found under its own post (404 elsewhere); bad IDs are 400', async () => {
  const one = await newPost();
  const other = await newPost();
  const mine = await added(ben, one, 'Mine');
  assert.equal((await edit(ben, other, mine._id, 'Moved?')).status, 404);
  assert.equal((await remove(ben, other, mine._id)).status, 404);
  assert.equal((await edit(ben, one, 'nope', 'x')).status, 400);
  assert.equal((await remove(ben, one, new mongoose.Types.ObjectId().toString())).body.message, COMMENT_NOT_FOUND_MESSAGE);
});

// --- Delete your own -----------------------------------------------------------------------------------

test('delete your own reply, or a comment without replies: it is removed and the count goes down', async () => {
  const postId = await newPost();
  const top = await added(ben, postId, 'Top');
  const reply = await added(cara, postId, 'Reply', top._id);
  const lonely = await added(ben, postId, 'No replies');
  assert.equal(await storedCount(postId), 3);

  const res = await remove(cara, postId, reply._id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.deleted, 'removed');
  assert.equal(res.body.message, COMMENT_DELETED_MESSAGE);
  assert.equal(res.body.commentCount, 2);

  const res2 = await remove(ben, postId, lonely._id);
  assert.equal(res2.body.deleted, 'removed');
  assert.equal(res2.body.commentCount, 1);
  assert.equal(await PostComment.exists({ _id: lonely._id }), null);

  // A second delete click finds nothing.
  assert.equal((await remove(ben, postId, lonely._id)).status, 404);
  assert.equal(await storedCount(postId), 1);
});

test('delete a comment that has replies: it shows as "Comment deleted" and the replies stay', async () => {
  const postId = await newPost();
  const top = await added(ben, postId, 'Something I regret');
  const r1 = await added(cara, postId, 'First reply', top._id);
  const r2 = await added(asha, postId, 'Second reply', top._id);

  const res = await remove(ben, postId, top._id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.deleted, 'placeholder');
  assert.equal(res.body.comment.deleted, true);
  assert.equal(res.body.commentCount, 2, 'only the two replies still count');

  const { body } = await list(cara, postId);
  assert.equal(body.comments.length, 1);
  const shown = body.comments[0];
  assert.equal(shown.deleted, true);
  assert.equal(shown.text, '', 'the deleted text is not sent');
  assert.equal(shown.author, null, 'nor who wrote it');
  assert.equal(shown.isMine, false);
  assert.deepEqual(shown.replies.map((r) => r.text), ['First reply', 'Second reply']);

  // The placeholder cannot be edited, deleted again, or replied to.
  assert.equal((await edit(ben, postId, top._id, 'Back')).status, 404);
  assert.equal((await remove(ben, postId, top._id)).status, 404);
  const late = await comment(asha, postId, 'Late reply', top._id);
  assert.equal(late.status, 400);
  assert.equal(late.body.code, 'parent_deleted');

  // When the last reply goes, the placeholder goes too.
  await remove(cara, postId, r1._id);
  assert.ok(await PostComment.exists({ _id: top._id }), 'one reply is left, so the placeholder stays');
  const last = await remove(asha, postId, r2._id);
  assert.equal(last.body.commentCount, 0);
  assert.equal(await PostComment.exists({ _id: top._id }), null);
  assert.deepEqual((await list(cara, postId)).body.comments, []);
});

test('deleting the post removes its comments and replies', async () => {
  const postId = await newPost(asha);
  const top = await added(ben, postId, 'Top');
  await added(cara, postId, 'Reply', top._id);
  assert.equal((await as(asha).delete(`/api/posts/${postId}`)).status, 200);
  assert.equal(await PostComment.countDocuments({ post: postId }), 0);
  assert.equal((await list(ben, postId)).status, 404);
  assert.equal((await comment(ben, postId, 'Too late')).status, 404);
});

test('a moderator removing a reported post removes its comments too', async () => {
  const postId = await newPost(asha, 'Buy cheap followers now');
  await added(ben, postId, 'This is spam');
  assert.equal((await as(cara).post(`/api/posts/${postId}/report`).send({ reason: 'spam' })).status, 201);
  const res = await as(moderator).post(`/api/moderation/reports/${postId}/remove`).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await Post.exists({ _id: postId }), null);
  assert.equal(await PostComment.countDocuments({ post: postId }), 0);
});

// --- List: pages -----------------------------------------------------------------------------------------

test('comments come in pages, oldest first, with nextAfter', async () => {
  const postId = await newPost();
  for (const text of ['c1', 'c2', 'c3']) await added(ben, postId, text);
  const page1 = await list(cara, postId, '?limit=2');
  assert.deepEqual(page1.body.comments.map((c) => c.text), ['c1', 'c2']);
  assert.ok(page1.body.nextAfter);
  const page2 = await list(cara, postId, `?limit=2&after=${page1.body.nextAfter}`);
  assert.deepEqual(page2.body.comments.map((c) => c.text), ['c3']);
  assert.equal(page2.body.nextAfter, null);
  assert.equal((await list(cara, postId, '?after=junk')).status, 400);
});

// --- Count stays right under load ---------------------------------------------------------------------

test('ten comments sent at the same moment are all counted', async () => {
  const postId = await newPost();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => comment(i % 2 ? ben : cara, postId, `Comment ${i}`)));
  assert.ok(results.every((res) => res.status === 201));
  assert.equal(await storedCount(postId), 10);
  assert.equal(await PostComment.countDocuments({ post: postId }), 10);
});

// --- Optional part: "someone replied" notification ------------------------------------------------------

test('the post author is told about a new comment, and a comment author about a reply', async () => {
  const postId = await newPost(asha, 'Looking for a designer');
  const top = await added(ben, postId, 'I can help with that');

  const forAsha = await Notification.find({ recipient: asha.user.id, type: 'post_reply', targetId: top._id }).lean();
  assert.equal(forAsha.length, 1);
  assert.equal(String(forAsha[0].actor), ben.user.id);
  assert.equal(forAsha[0].summary, 'commented on your post "Looking for a designer"');
  assert.equal(forAsha[0].project, null);
  assert.equal(forAsha[0].link, '/feed');
  assert.equal(String(forAsha[0].targetId), top._id);

  const reply = await added(cara, postId, 'Me too', top._id);
  const forBen = await Notification.find({ recipient: ben.user.id, type: 'post_reply', targetId: reply._id }).lean();
  assert.equal(forBen.length, 1);
  assert.equal(forBen[0].summary, 'replied to your comment "I can help with that"');

  // It shows in the bell (personal type, no project needed).
  const bell = await as(ben).get('/api/notifications');
  assert.equal(bell.status, 200);
  assert.ok(bell.body.notifications.some((n) => n.type === 'post_reply' && String(n.targetId) === reply._id));
  // The post author is not told about a reply between other people (only the comment's author is).
  assert.equal(await Notification.countDocuments({ recipient: asha.user.id, targetId: reply._id }), 0);
});

test('no notification for commenting on your own post or replying to yourself', async () => {
  const postId = await newPost(asha, 'My own post');
  const mine = await added(asha, postId, 'Adding a detail');
  await added(asha, postId, 'And another', mine._id);
  assert.equal(await Notification.countDocuments({ recipient: asha.user.id, type: 'post_reply', targetId: mine._id }), 0);
  assert.equal(await Notification.countDocuments({ actor: asha.user.id, recipient: asha.user.id }), 0);
});
