import Post from '../models/Post.js';
import PostComment from '../models/PostComment.js';
import { createPersonalNotification } from './notifications.js';
import { commentExcerpt, isCommentAuthor, replyDedupeKey, replyNotificationSummary } from './commentRules.js';

/*
 * [Sprint 7 · M3] Database helpers for comments on public posts. Used by routes/postComments.js and by the
 * places that delete a post (routes/posts.js DELETE, lib/moderation.js "remove", seed --reset).
 *
 *   changeCommentCount(postId, by)   one atomic $inc of post.commentCount (never below 0); returns the new
 *                                    count, or null when the post is gone
 *   recountPostComments(postId)      sets post.commentCount from the comment rows (repair / seed reset)
 *   deleteCommentsForPost(postId)    removes every comment and reply of a deleted post
 *   notifyCommentReply(...)          optional part: tells the post author / comment author (never throws)
 */

export const COMMENT_LINK = '/feed';

export async function changeCommentCount(postId, by) {
  if (by >= 0) {
    const post = await Post.findOneAndUpdate({ _id: postId }, { $inc: { commentCount: by } }, { new: true })
      .select('commentCount')
      .lean();
    return post ? post.commentCount : null;
  }
  // Only lower the count while it is high enough, so it can never go below 0.
  const post = await Post.findOneAndUpdate(
    { _id: postId, commentCount: { $gte: -by } },
    { $inc: { commentCount: by } },
    { new: true }
  )
    .select('commentCount')
    .lean();
  if (post) return post.commentCount;
  // The stored count was already too low (e.g. an old post): repair it from the rows instead.
  return recountPostComments(postId);
}

export async function recountPostComments(postId) {
  const count = await PostComment.countDocuments({ post: postId, deletedAt: null });
  const post = await Post.findOneAndUpdate({ _id: postId }, { $set: { commentCount: count } }, { new: true })
    .select('commentCount')
    .lean();
  return post ? post.commentCount : null;
}

export async function deleteCommentsForPost(postId) {
  if (!postId) return 0;
  const result = await PostComment.deleteMany({ post: postId });
  return result.deletedCount || 0;
}

/*
 * Optional part of M3: a "Reply" notification (type post_reply, no project).
 *   a comment on a post     -> the post's author
 *   a reply to a comment    -> that comment's author (if the comment is not a deleted placeholder)
 * Never to the person who wrote the new comment. One per new comment (dedupeKey), pushed live.
 */
export async function notifyCommentReply({ comment, post, parent = null }) {
  try {
    const isReply = Boolean(parent);
    const target = isReply ? parent : post;
    if (!target || (isReply && target.deletedAt)) return null;
    const recipient = target.author && typeof target.author === 'object' && target.author._id ? target.author._id : target.author;
    if (!recipient || isCommentAuthor({ author: recipient }, comment.author)) return null;

    return await createPersonalNotification({
      recipient,
      type: 'post_reply',
      project: null,
      actor: comment.author,
      summary: replyNotificationSummary({ isReply, targetText: target.text }),
      targetType: 'comment',
      targetId: comment._id,
      targetLabel: commentExcerpt(comment.text),
      link: COMMENT_LINK,
      dedupeKey: replyDedupeKey(String(comment._id)),
    });
  } catch {
    return null; // a notification must never make the comment itself fail
  }
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M3] What this file does
 * Keeps each post's comment count right (atomic +1 / -1), removes the comments of a
 * deleted post, and sends the optional "someone replied" notification.
 * ---------------------------------------------------------------------------
 */
