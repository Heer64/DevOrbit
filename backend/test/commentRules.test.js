// [Sprint 7 · M3] Rules for comments and replies on feed posts (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMENT_TEXT_MAX,
  COMMENT_TEXT_REQUIRED_MESSAGE,
  COMMENT_TEXT_TOO_LONG_MESSAGE,
  COMMENT_TEXT_TYPE_MESSAGE,
  COMMENTS_PAGE_DEFAULT,
  COMMENTS_PAGE_MAX,
  commentExcerpt,
  commentView,
  deleteMode,
  isCommentAuthor,
  readCommentLimit,
  readCommentText,
  replyDedupeKey,
  replyNotificationSummary,
  threadComments,
} from '../src/lib/commentRules.js';

const author = { _id: 'u1', name: 'Asha', username: 'asha', avatarUrl: '' };
const at = (minute) => new Date(Date.UTC(2026, 10, 20, 10, minute));
const row = (extra = {}) => ({
  _id: 'c1',
  post: 'p1',
  parent: null,
  author,
  text: 'Nice work',
  editedAt: null,
  deletedAt: null,
  createdAt: at(0),
  updatedAt: at(0),
  ...extra,
});

test('comment text: required, trimmed, line breaks kept, at most 500 characters', () => {
  assert.deepEqual(readCommentText('  Hello\r\nthere  '), { ok: true, value: 'Hello\nthere' });
  assert.deepEqual(readCommentText(undefined), { ok: false, message: COMMENT_TEXT_REQUIRED_MESSAGE });
  assert.deepEqual(readCommentText('   \n  '), { ok: false, message: COMMENT_TEXT_REQUIRED_MESSAGE });
  assert.deepEqual(readCommentText(42), { ok: false, message: COMMENT_TEXT_TYPE_MESSAGE });
  assert.deepEqual(readCommentText({ text: 'x' }), { ok: false, message: COMMENT_TEXT_TYPE_MESSAGE });
  assert.equal(readCommentText('a'.repeat(COMMENT_TEXT_MAX)).ok, true);
  assert.deepEqual(readCommentText('a'.repeat(COMMENT_TEXT_MAX + 1)), { ok: false, message: COMMENT_TEXT_TOO_LONG_MESSAGE });
  // Invisible control characters do not count and are removed.
  assert.deepEqual(readCommentText('\u0007Hi\u0000'), { ok: true, value: 'Hi' });
});

test('page size: default 20, at most 50, junk falls back to the default', () => {
  assert.equal(readCommentLimit(undefined), COMMENTS_PAGE_DEFAULT);
  assert.equal(readCommentLimit('0'), COMMENTS_PAGE_DEFAULT);
  assert.equal(readCommentLimit('abc'), COMMENTS_PAGE_DEFAULT);
  assert.equal(readCommentLimit('5'), 5);
  assert.equal(readCommentLimit('500'), COMMENTS_PAGE_MAX);
});

test('only the author owns a comment (id or populated author)', () => {
  assert.equal(isCommentAuthor(row(), 'u1'), true);
  assert.equal(isCommentAuthor(row({ author: 'u1' }), 'u1'), true);
  assert.equal(isCommentAuthor(row(), 'u2'), false);
  assert.equal(isCommentAuthor(row(), null), false);
  assert.equal(isCommentAuthor(null, 'u1'), false);
});

test('delete: a reply or a comment without replies is removed; a comment with replies becomes a placeholder', () => {
  assert.equal(deleteMode(row({ parent: 'c0' }), 0), 'remove');
  assert.equal(deleteMode(row({ parent: 'c0' }), 3), 'remove');
  assert.equal(deleteMode(row(), 0), 'remove');
  assert.equal(deleteMode(row(), 2), 'placeholder');
});

test('API shape of a comment, an edited comment and a deleted placeholder', () => {
  const view = commentView(row(), 'u1');
  assert.deepEqual(view, {
    _id: 'c1',
    post: 'p1',
    parent: null,
    author: { _id: 'u1', name: 'Asha', username: 'asha', avatarUrl: '' },
    text: 'Nice work',
    edited: false,
    editedAt: null,
    deleted: false,
    createdAt: at(0),
    updatedAt: at(0),
    isMine: true,
  });
  assert.equal(commentView(row(), 'u2').isMine, false);
  assert.equal(commentView(row({ editedAt: at(5) }), 'u1').edited, true);
  assert.equal(commentView(row({ parent: 'c0' })).parent, 'c0');

  const placeholder = commentView(row({ deletedAt: at(9), text: '' }), 'u1');
  assert.equal(placeholder.deleted, true);
  assert.equal(placeholder.text, '');
  assert.equal(placeholder.author, null, 'nothing about the deleted comment is shown');
  assert.equal(placeholder.isMine, false, 'a placeholder cannot be edited or deleted again');

  // A removed account: no author, the comment itself still reads fine.
  assert.equal(commentView(row({ author: null })).author, null);
});

test('threadComments puts each reply under its comment, oldest first, with replyCount', () => {
  const comments = [row({ _id: 'c1' }), row({ _id: 'c2', createdAt: at(1) })];
  const replies = [
    row({ _id: 'r2', parent: 'c1', createdAt: at(4) }),
    row({ _id: 'r1', parent: 'c1', createdAt: at(2) }),
    row({ _id: 'r9', parent: 'elsewhere', createdAt: at(3) }),
  ];
  const thread = threadComments(comments, replies, 'u1');
  assert.deepEqual(thread.map((c) => c._id), ['c1', 'c2']);
  assert.deepEqual(thread[0].replies.map((r) => r._id), ['r1', 'r2']);
  assert.equal(thread[0].replyCount, 2);
  assert.deepEqual(thread[1].replies, []);
  assert.equal(thread[1].replyCount, 0);
});

test('reply notification text (optional part)', () => {
  assert.equal(replyNotificationSummary({ isReply: false, targetText: 'Our new release' }), 'commented on your post "Our new release"');
  assert.equal(replyNotificationSummary({ isReply: true, targetText: 'Great idea' }), 'replied to your comment "Great idea"');
  assert.equal(replyNotificationSummary({ isReply: true, targetText: '' }), 'replied to your comment');
  const long = commentExcerpt('word '.repeat(40));
  assert.ok(long.length <= 60);
  assert.ok(long.endsWith('…'));
  assert.equal(replyDedupeKey('abc'), 'post_reply:abc');
});
