import { Router } from 'express';

import Post from '../models/Post.js';
import PostComment from '../models/PostComment.js';
import { requireAuth } from '../middleware/auth.js';
import { validId } from '../lib/projectAccess.js';
import { POST_NOT_FOUND_MESSAGE } from '../lib/postRules.js';
import {
  COMMENT_CREATED_MESSAGE,
  COMMENT_DELETED_MESSAGE,
  COMMENT_NOT_AUTHOR_MESSAGE,
  COMMENT_NOT_FOUND_MESSAGE,
  COMMENT_PARENT_NOT_FOUND_MESSAGE,
  COMMENT_REPLY_TO_REPLY_MESSAGE,
  COMMENT_UPDATED_MESSAGE,
  REPLY_CREATED_MESSAGE,
  commentView,
  deleteMode,
  isCommentAuthor,
  readCommentLimit,
  readCommentText,
  threadComments,
} from '../lib/commentRules.js';
import { changeCommentCount, notifyCommentReply } from '../lib/postComments.js';

/*
 * [Sprint 7 · M3] Comments and replies on public posts. Mounted at /api/posts/:postId/comments (see app.js),
 * before the post routes, so only comment URLs reach it. Login needed for everything.
 *
 * GET    /                 ?limit=1..50 (default 20) &after=<commentId>
 *        -> { comments, nextAfter, commentCount }
 *           comments: the post's comments, OLDEST first (reading order), each with replyCount and
 *           replies: [...] (oldest first). nextAfter is null on the last page.
 * POST   /                 JSON { text, parentId? }
 *        parentId missing/null -> a comment on the post; parentId = a comment of this post -> a reply
 *        -> 201 { comment, commentCount, message }
 *        400 { message } text missing / too long / not text, invalid IDs, reply to a reply,
 *                        or replying to a comment that was deleted
 *        404 { message } unknown or deleted post
 * PATCH  /:commentId       author only, JSON { text }
 *        -> { comment, message }   the comment now has edited: true
 *        403 not the author    404 unknown, deleted or on another post
 * DELETE /:commentId       author only (the UI asks for confirmation first)
 *        -> { commentId, deleted: 'removed' | 'placeholder', comment | null, commentCount, message }
 *           'placeholder': it was a comment with replies, now shown as "Comment deleted" (comment = its view)
 *        403 not the author    404 unknown, already deleted or on another post
 *
 * Each comment: commentView() in lib/commentRules.js (isMine says whether the viewer may edit/delete it).
 * post.commentCount (comments + replies) is also returned in every post of GET /api/posts.
 */

const router = Router({ mergeParams: true });
const AUTHOR_FIELDS = 'name username avatarUrl';

router.use(requireAuth);

// Loads the post (only what is needed). Answers 400/404 and returns null otherwise.
async function findPost(req, res) {
  if (!validId(req.params.postId)) {
    res.status(400).json({ message: 'Invalid post ID.' });
    return null;
  }
  const post = await Post.findById(req.params.postId).select('author text commentCount').lean();
  if (!post) {
    res.status(404).json({ message: POST_NOT_FOUND_MESSAGE });
    return null;
  }
  return post;
}

// Loads a live comment of this post that the current user wrote. Answers 400/404/403 otherwise.
async function findOwnComment(req, res, post) {
  if (!validId(req.params.commentId)) {
    res.status(400).json({ message: 'Invalid comment ID.' });
    return null;
  }
  const comment = await PostComment.findOne({ _id: req.params.commentId, post: post._id, deletedAt: null });
  if (!comment) {
    res.status(404).json({ message: COMMENT_NOT_FOUND_MESSAGE });
    return null;
  }
  if (!isCommentAuthor(comment, req.user.id)) {
    res.status(403).json({ message: COMMENT_NOT_AUTHOR_MESSAGE });
    return null;
  }
  return comment;
}

async function viewOf(commentId, viewerId) {
  const saved = await PostComment.findById(commentId).populate('author', AUTHOR_FIELDS).lean();
  return saved ? commentView(saved, viewerId) : null;
}

// --- Read ---------------------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const post = await findPost(req, res);
    if (!post) return undefined;

    const limit = readCommentLimit(req.query.limit);
    const filter = { post: post._id, parent: null };
    if (req.query.after !== undefined) {
      if (!validId(req.query.after)) return res.status(400).json({ message: 'Invalid "after" comment ID.' });
      filter._id = { $gt: req.query.after };
    }

    // ObjectIds grow with creation time, so _id ascending is oldest first and a stable cursor.
    const rows = await PostComment.find(filter).sort({ _id: 1 }).limit(limit + 1).populate('author', AUTHOR_FIELDS).lean();
    const page = rows.slice(0, limit);
    const replies = page.length
      ? await PostComment.find({ post: post._id, parent: { $in: page.map((comment) => comment._id) } })
        .sort({ _id: 1 })
        .populate('author', AUTHOR_FIELDS)
        .lean()
      : [];

    res.set('Cache-Control', 'no-store');
    return res.json({
      comments: threadComments(page, replies, req.user.id),
      nextAfter: rows.length > limit ? String(page[page.length - 1]._id) : null,
      commentCount: Math.max(0, post.commentCount || 0),
    });
  } catch (error) {
    return next(error);
  }
});

// --- Create a comment or a reply ----------------------------------------------------------------

router.post('/', async (req, res, next) => {
  try {
    const post = await findPost(req, res);
    if (!post) return undefined;

    const text = readCommentText(req.body?.text);
    if (!text.ok) return res.status(400).json({ message: text.message });

    // A reply: the parent must be a live, top-level comment of THIS post (one level deep).
    let parent = null;
    const parentId = req.body?.parentId;
    if (parentId !== undefined && parentId !== null && parentId !== '') {
      if (typeof parentId !== 'string' || !validId(parentId)) return res.status(400).json({ message: 'Invalid comment ID to reply to.' });
      parent = await PostComment.findOne({ _id: parentId, post: post._id }).select('author text parent deletedAt').lean();
      if (!parent || parent.deletedAt) return res.status(400).json({ message: COMMENT_PARENT_NOT_FOUND_MESSAGE, code: 'parent_deleted' });
      if (parent.parent) return res.status(400).json({ message: COMMENT_REPLY_TO_REPLY_MESSAGE, code: 'reply_to_reply' });
    }

    const created = await PostComment.create({
      post: post._id,
      author: req.user.id,
      parent: parent ? parent._id : null,
      text: text.value,
    });

    // If the post (or the comment replied to) was deleted while this was being saved, do not leave an orphan.
    const [postStill, parentStill] = await Promise.all([
      Post.exists({ _id: post._id }),
      parent ? PostComment.exists({ _id: parent._id }) : Promise.resolve(true),
    ]);
    if (!postStill || !parentStill) {
      await PostComment.deleteOne({ _id: created._id });
      if (!postStill) return res.status(404).json({ message: POST_NOT_FOUND_MESSAGE });
      return res.status(400).json({ message: COMMENT_PARENT_NOT_FOUND_MESSAGE, code: 'parent_deleted' });
    }

    const commentCount = await changeCommentCount(post._id, 1);
    await notifyCommentReply({ comment: created, post, parent }); // optional part; never throws

    return res.status(201).json({
      comment: { ...(await viewOf(created._id, req.user.id)), ...(parent ? {} : { replyCount: 0, replies: [] }) },
      commentCount: commentCount ?? 0,
      message: parent ? REPLY_CREATED_MESSAGE : COMMENT_CREATED_MESSAGE,
    });
  } catch (error) {
    return next(error);
  }
});

// --- Edit and delete your own -------------------------------------------------------------------

router.patch('/:commentId', async (req, res, next) => {
  try {
    const post = await findPost(req, res);
    if (!post) return undefined;
    const comment = await findOwnComment(req, res, post);
    if (!comment) return undefined;

    const text = readCommentText(req.body?.text);
    if (!text.ok) return res.status(400).json({ message: text.message });

    // Saving the same text again is not an edit, so it does not get the "edited" mark.
    if (text.value !== comment.text) {
      comment.text = text.value;
      comment.editedAt = new Date();
      await comment.save();
    }

    return res.json({ comment: await viewOf(comment._id, req.user.id), message: COMMENT_UPDATED_MESSAGE });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:commentId', async (req, res, next) => {
  try {
    const post = await findPost(req, res);
    if (!post) return undefined;
    const comment = await findOwnComment(req, res, post);
    if (!comment) return undefined;

    const replyCount = comment.parent ? 0 : await PostComment.countDocuments({ parent: comment._id });
    const mode = deleteMode(comment, replyCount);
    let view = null;

    if (mode === 'placeholder') {
      // Only the first of two delete clicks changes anything (the second finds deletedAt already set).
      const marked = await PostComment.findOneAndUpdate(
        { _id: comment._id, author: req.user.id, deletedAt: null },
        { $set: { deletedAt: new Date(), text: '', editedAt: null } },
        { new: true }
      ).lean();
      if (!marked) return res.status(404).json({ message: COMMENT_NOT_FOUND_MESSAGE });
      view = commentView(marked, req.user.id);
    } else {
      const removed = await PostComment.findOneAndDelete({ _id: comment._id, author: req.user.id, deletedAt: null });
      if (!removed) return res.status(404).json({ message: COMMENT_NOT_FOUND_MESSAGE });
      // A reply arrived between counting and deleting: keep that reply, as a reply to a placeholder.
      if (!removed.parent && (await PostComment.exists({ parent: removed._id }))) {
        await PostComment.create({
          _id: removed._id,
          post: removed.post,
          author: removed.author,
          parent: null,
          text: '',
          deletedAt: new Date(),
          createdAt: removed.createdAt,
        });
      }
    }

    let commentCount = await changeCommentCount(post._id, -1);

    // The last reply under a "Comment deleted" placeholder is gone: the placeholder has nothing left to explain.
    if (comment.parent) {
      const placeholder = await PostComment.findOne({ _id: comment.parent, deletedAt: { $ne: null } }).select('_id').lean();
      if (placeholder && !(await PostComment.exists({ parent: placeholder._id }))) {
        await PostComment.deleteOne({ _id: placeholder._id, deletedAt: { $ne: null } });
      }
    }

    if (commentCount === null) commentCount = 0;
    return res.json({ commentId: String(comment._id), deleted: mode === 'placeholder' ? 'placeholder' : 'removed', comment: view, commentCount, message: COMMENT_DELETED_MESSAGE });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M3] What this file does
 * REST API for comments on public posts: list a post's comments with their replies,
 * add a comment or a reply (one level deep), and let ONLY the author edit
 * ("edited") or delete their own. A deleted comment that still has replies stays as
 * "Comment deleted". Every change keeps the post's commentCount right.
 * ---------------------------------------------------------------------------
 */
