import { normalizePostText } from './postRules.js';

/*
 * [Sprint 7 · M3] Comments and replies on feed posts (Sprint 7 "Miscellaneous", M3).
 *
 * No database imports, so these rules are tested on their own (backend/test/commentRules.test.js)
 * and the route, the tests, the README and the frontend (frontend/src/comments.js) use the same numbers.
 *
 * A comment is
 *   text     required, 1 to 500 characters after trimming (same cleaning as a post: line breaks kept,
 *            invisible control characters removed)
 *   parent   null for a comment on the post, or the ID of a comment on the SAME post for a reply.
 *            Replies are one level deep: you can reply to a comment, not to a reply.
 *
 * Who may do what
 *   Any logged-in user can comment on any post and reply to any comment.
 *   Only the author can edit or delete their own comment or reply (anyone else gets 403).
 *
 * Deleting
 *   A reply, or a comment without replies, is removed completely.
 *   A comment that still has replies becomes a "Comment deleted" placeholder (text and author hidden),
 *   so the replies under it still make sense. When its last reply is deleted the placeholder goes too.
 *
 * Counting
 *   post.commentCount = comments + replies that are not deleted. It is moved with one atomic $inc per
 *   change (create +1, delete -1), so two people commenting at the same moment both count.
 */

export const COMMENT_TEXT_MAX = 500;
export const COMMENTS_PAGE_DEFAULT = 20;
export const COMMENTS_PAGE_MAX = 50;

export const COMMENT_TEXT_REQUIRED_MESSAGE = 'Write a comment first.';
export const COMMENT_TEXT_TOO_LONG_MESSAGE = `Comments must be ${COMMENT_TEXT_MAX} characters or fewer.`;
export const COMMENT_TEXT_TYPE_MESSAGE = 'Comment text must be text.';
export const COMMENT_NOT_FOUND_MESSAGE = 'Comment not found. It may have been deleted.';
export const COMMENT_NOT_AUTHOR_MESSAGE = 'You can only edit or delete your own comments.';
export const COMMENT_REPLY_TO_REPLY_MESSAGE = 'You can reply to a comment, but not to a reply.';
export const COMMENT_PARENT_NOT_FOUND_MESSAGE = 'The comment you are replying to was deleted.';
export const COMMENT_CREATED_MESSAGE = 'Your comment was added.';
export const REPLY_CREATED_MESSAGE = 'Your reply was added.';
export const COMMENT_UPDATED_MESSAGE = 'Your comment was updated.';
export const COMMENT_DELETED_MESSAGE = 'Your comment was deleted.';
export const COMMENT_DELETED_PLACEHOLDER = 'Comment deleted';

// The comment text sent by the client. Returns { ok: true, value } or { ok: false, message }.
export function readCommentText(raw) {
  if (raw === undefined || raw === null) return { ok: false, message: COMMENT_TEXT_REQUIRED_MESSAGE };
  if (typeof raw !== 'string') return { ok: false, message: COMMENT_TEXT_TYPE_MESSAGE };
  const value = normalizePostText(raw);
  if (!value) return { ok: false, message: COMMENT_TEXT_REQUIRED_MESSAGE };
  if (value.length > COMMENT_TEXT_MAX) return { ok: false, message: COMMENT_TEXT_TOO_LONG_MESSAGE };
  return { ok: true, value };
}

// Page size for the list of comments: a whole number from 1 to COMMENTS_PAGE_MAX (default COMMENTS_PAGE_DEFAULT).
export function readCommentLimit(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return COMMENTS_PAGE_DEFAULT;
  return Math.min(value, COMMENTS_PAGE_MAX);
}

const idOf = (value) => {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

// True when userId wrote the comment (comment.author may be an id or a populated user).
export function isCommentAuthor(comment, userId) {
  if (!comment || !userId) return false;
  const author = idOf(comment.author);
  return Boolean(author) && author === String(userId);
}

/*
 * What happens when the author deletes a comment:
 *   'remove'       it is a reply, or a comment with no replies left -> delete the row
 *   'placeholder'  it is a comment that still has replies -> keep it as "Comment deleted"
 */
export function deleteMode(comment, replyCount) {
  if (comment?.parent) return 'remove';
  return replyCount > 0 ? 'placeholder' : 'remove';
}

/*
 * API shape of one comment or reply:
 *   { _id, post, parent | null, author { _id, name, username, avatarUrl } | null, text,
 *     edited, editedAt, deleted, createdAt, updatedAt, isMine }
 * A deleted placeholder has text '', author null and isMine false: nothing about it is shown or editable.
 * Top-level comments also get replies: [...] and replyCount from the route.
 */
export function commentView(comment, viewerId = null) {
  const deleted = Boolean(comment.deletedAt);
  const author = !deleted && comment.author && typeof comment.author === 'object' && comment.author.name !== undefined
    ? {
      _id: String(comment.author._id),
      name: comment.author.name,
      username: comment.author.username,
      avatarUrl: comment.author.avatarUrl || '',
    }
    : null;
  return {
    _id: String(comment._id),
    post: idOf(comment.post),
    parent: comment.parent ? idOf(comment.parent) : null,
    author,
    text: deleted ? '' : comment.text,
    edited: !deleted && Boolean(comment.editedAt),
    editedAt: deleted ? null : comment.editedAt || null,
    deleted,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    isMine: !deleted && isCommentAuthor(comment, viewerId),
  };
}

/*
 * Builds the list the client shows: top-level comments (oldest first, in the order given), each with
 * its replies (oldest first) and replyCount. Replies whose comment is not on this page are left out.
 */
export function threadComments(topLevel, replies, viewerId = null) {
  const byParent = new Map();
  for (const reply of replies) {
    const key = idOf(reply.parent);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(reply);
  }
  return topLevel.map((comment) => {
    const own = (byParent.get(String(comment._id)) || [])
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a._id).localeCompare(String(b._id)));
    return {
      ...commentView(comment, viewerId),
      replyCount: own.length,
      replies: own.map((reply) => commentView(reply, viewerId)),
    };
  });
}

/*
 * [Sprint 7 · M3] Optional part: the notification text when someone comments on your post or replies
 * to your comment. Short excerpts only, so a long post or comment does not fill the notification list.
 */
export const COMMENT_EXCERPT_MAX = 60;

export function commentExcerpt(text, max = COMMENT_EXCERPT_MAX) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

// The UI shows "<actor name> <summary>" (like every notification with an actor), so no name here.
export function replyNotificationSummary({ isReply, targetText }) {
  const what = isReply ? 'replied to your comment' : 'commented on your post';
  const excerpt = commentExcerpt(targetText);
  return excerpt ? `${what} "${excerpt}"` : what;
}

// One notification per comment or reply, even if the same request is retried.
export const replyDedupeKey = (commentId) => `post_reply:${commentId}`;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M3] What this file does
 * The rules for comments on public posts: text up to 500 characters, replies only
 * one level deep, only the author edits or deletes, a deleted comment with replies
 * stays as "Comment deleted". Also turns comments into their API shape and builds
 * the text of the "someone replied" notification.
 * ---------------------------------------------------------------------------
 */
