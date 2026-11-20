// [Sprint 7 · M3] Comment rules and list helpers (no rendering).
import { describe, expect, it } from 'vitest';
import {
  COMMENT_TEXT_MAX,
  COMMENT_TEXT_REQUIRED_MESSAGE,
  COMMENT_TEXT_TOO_LONG_MESSAGE,
  addComment,
  checkCommentText,
  commentCountLabel,
  commentErrorMessage,
  removeComment,
  replaceComment,
} from './comments';

const c = (id, extra = {}) => ({ _id: id, parent: null, text: id, deleted: false, isMine: true, author: { name: 'A' }, replies: [], replyCount: 0, ...extra });
const r = (id, parent, extra = {}) => ({ _id: id, parent, text: id, deleted: false, isMine: true, author: { name: 'B' }, ...extra });

describe('comment rules', () => {
  it('checks the text like the server', () => {
    expect(checkCommentText('')).toBe(COMMENT_TEXT_REQUIRED_MESSAGE);
    expect(checkCommentText('   \r\n ')).toBe(COMMENT_TEXT_REQUIRED_MESSAGE);
    expect(checkCommentText('Hi')).toBe('');
    expect(checkCommentText('a'.repeat(COMMENT_TEXT_MAX))).toBe('');
    expect(checkCommentText('a'.repeat(COMMENT_TEXT_MAX + 1))).toBe(COMMENT_TEXT_TOO_LONG_MESSAGE);
  });

  it('labels the count', () => {
    expect(commentCountLabel(0)).toBe('No comments');
    expect(commentCountLabel(undefined)).toBe('No comments');
    expect(commentCountLabel(1)).toBe('1 comment');
    expect(commentCountLabel(12)).toBe('12 comments');
  });

  it('turns failures into readable messages', () => {
    expect(commentErrorMessage({ status: 403 })).toBe('You can only edit or delete your own comments.');
    expect(commentErrorMessage({ status: 404, message: 'Gone.' })).toBe('Gone.');
    expect(commentErrorMessage(null, 'Fallback')).toBe('Fallback');
  });
});

describe('comment list helpers', () => {
  it('adds a comment at the end and a reply under its comment, once', () => {
    let list = [c('c1')];
    list = addComment(list, c('c2'));
    list = addComment(list, r('r1', 'c1'));
    list = addComment(list, r('r1', 'c1'));
    expect(list.map((item) => item._id)).toEqual(['c1', 'c2']);
    expect(list[0].replies.map((item) => item._id)).toEqual(['r1']);
    expect(list[0].replyCount).toBe(1);
    expect(addComment(list, c('c2'))).toBe(list);
  });

  it('replaces an edited comment or reply and keeps the replies', () => {
    const list = [c('c1', { replies: [r('r1', 'c1')], replyCount: 1 })];
    const edited = replaceComment(list, { _id: 'c1', text: 'new', edited: true });
    expect(edited[0].text).toBe('new');
    expect(edited[0].replies).toHaveLength(1);
    const reply = replaceComment(list, { _id: 'r1', text: 'fixed', edited: true });
    expect(reply[0].replies[0].text).toBe('fixed');
    expect(list[0].replies[0].text).toBe('r1');
  });

  it('removes a reply, a comment, or keeps a "Comment deleted" placeholder', () => {
    const list = [c('c1', { replies: [r('r1', 'c1'), r('r2', 'c1')], replyCount: 2 }), c('c2')];
    const noReply = removeComment(list, { commentId: 'r1', deleted: 'removed' });
    expect(noReply[0].replies.map((item) => item._id)).toEqual(['r2']);
    expect(noReply[0].replyCount).toBe(1);

    const noComment = removeComment(list, { commentId: 'c2', deleted: 'removed' });
    expect(noComment.map((item) => item._id)).toEqual(['c1']);

    const placeholder = removeComment(list, { commentId: 'c1', deleted: 'placeholder', comment: { _id: 'c1', deleted: true } });
    expect(placeholder[0]).toMatchObject({ deleted: true, text: '', author: null, isMine: false });
    expect(placeholder[0].replies).toHaveLength(2);

    // The last reply under a placeholder goes: the placeholder goes too.
    const lone = [c('c1', { deleted: true, text: '', author: null, replies: [r('r1', 'c1')], replyCount: 1 })];
    expect(removeComment(lone, { commentId: 'r1', deleted: 'removed' })).toEqual([]);
  });
});
