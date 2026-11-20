/*
 * [Sprint 7 · M3] Comments and replies on feed posts: the same rules and messages as the server
 * (backend/src/lib/commentRules.js), so the form can refuse bad input before sending it.
 */
import { postTextLength } from './posts';

export const COMMENT_TEXT_MAX = 500;
export const COMMENTS_PAGE_SIZE = 20;

export const COMMENT_TEXT_REQUIRED_MESSAGE = 'Write a comment first.';
export const COMMENT_TEXT_TOO_LONG_MESSAGE = `Comments must be ${COMMENT_TEXT_MAX} characters or fewer.`;
export const COMMENT_DELETED_PLACEHOLDER = 'Comment deleted';

// Counted like the server counts (line endings as one character, ends trimmed).
export const commentTextLength = postTextLength;

// Returns an error message, or '' when the text can be sent.
export function checkCommentText(text) {
  const length = commentTextLength(text);
  if (length === 0) return COMMENT_TEXT_REQUIRED_MESSAGE;
  if (length > COMMENT_TEXT_MAX) return COMMENT_TEXT_TOO_LONG_MESSAGE;
  return '';
}

// "No comments", "1 comment", "12 comments".
export function commentCountLabel(count) {
  const n = Math.max(0, Number(count) || 0);
  if (n === 0) return 'No comments';
  return n === 1 ? '1 comment' : `${n} comments`;
}

// A readable message for a failed comment request.
export function commentErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (error.status === 403) return error.message || 'You can only edit or delete your own comments.';
  if (error.status === 404) return error.message || 'Comment not found. It may have been deleted.';
  return error.message || fallback;
}

/*
 * List helpers. `comments` is the shape GET /comments returns: top-level comments, each with replies.
 * Each helper returns a new list and never changes the one it was given.
 */
export function addComment(comments, comment) {
  if (!comment?._id) return comments;
  if (!comment.parent) {
    if (comments.some((item) => item._id === comment._id)) return comments;
    return [...comments, { replyCount: 0, replies: [], ...comment }];
  }
  return comments.map((item) => {
    if (item._id !== comment.parent || item.replies?.some((reply) => reply._id === comment._id)) return item;
    const replies = [...(item.replies || []), comment];
    return { ...item, replies, replyCount: replies.length };
  });
}

export function replaceComment(comments, comment) {
  if (!comment?._id) return comments;
  return comments.map((item) => {
    if (item._id === comment._id) return { ...item, ...comment, replies: item.replies, replyCount: item.replyCount };
    if (!item.replies?.some((reply) => reply._id === comment._id)) return item;
    return { ...item, replies: item.replies.map((reply) => (reply._id === comment._id ? { ...reply, ...comment } : reply)) };
  });
}

/*
 * After a delete. `result` is the server answer ({ commentId, deleted, comment }).
 *   'placeholder' -> the comment stays as "Comment deleted" with its replies
 *   'removed'     -> it leaves the list; a reply leaves its comment, and a "Comment deleted"
 *                    placeholder left with no replies leaves too (as on the server)
 */
export function removeComment(comments, result) {
  const id = result?.commentId;
  if (!id) return comments;
  if (result.deleted === 'placeholder') {
    return comments.map((item) => (item._id === id
      ? { ...item, ...(result.comment || {}), deleted: true, text: '', author: null, isMine: false, edited: false, replies: item.replies, replyCount: item.replyCount }
      : item));
  }
  return comments
    .filter((item) => item._id !== id)
    .map((item) => {
      if (!item.replies?.some((reply) => reply._id === id)) return item;
      const replies = item.replies.filter((reply) => reply._id !== id);
      return { ...item, replies, replyCount: replies.length };
    })
    .filter((item) => !(item.deleted && (item.replies || []).length === 0));
}
