import mongoose from 'mongoose';

import Post from '../models/Post.js';
import PostReport from '../models/PostReport.js';
import ModerationAction from '../models/ModerationAction.js';
import ModerationLock from '../models/ModerationLock.js';
import { validId } from './projectAccess.js';
import { openReportQueue } from './postReports.js';
import { deletePostImage } from './postImages.js';
import { deleteVotesForPost } from './postVotes.js';
import { deleteCommentsForPost } from './postComments.js'; // [Sprint 7 · M3]
import { createPersonalNotification } from './notifications.js';
import { postView } from './postRules.js';
import { REPORT_STATUS_OPEN, REPORT_STATUS_RESOLVED, reportReasonLabel, summarizeReasons } from './reportRules.js';
import {
  ACTION_RESOLUTIONS,
  ACTIONS_DEFAULT,
  ACTIONS_MAX,
  MODERATION_ACTION_REMOVE,
  MODERATION_ACTION_WARN,
  MODERATION_MESSAGES,
  NOTES_PER_POST,
  QUEUE_DEFAULT,
  QUEUE_MAX,
  WARNING_LINK,
  isModerationAction,
  moderationLogLine,
  postExcerpt,
  readListLimit,
  warningDedupeKey,
  warningSummary,
} from './moderationRules.js';

/*
 * [Sprint 6 · M7] US-56 Moderate reported posts: the database side of the moderator queue.
 * Used only by routes/moderation.js, which already refuses anyone who is not a Content Moderator (403).
 *
 *   moderationQueue({ limit })        -> the queue: each reported post with its reasons and report count
 *   moderatePost({ postId, action, moderatorId })
 *                                     -> { status, body }: Remove / Warn / Dismiss, then every open report of the
 *                                        post is marked resolved (resolvedBy, resolvedAt, resolution)
 *   recentModerationActions({ limit }) -> the moderation log, newest first
 *
 * Privacy (NFR-22): the queue never says WHO reported a post (no reporter IDs, names or emails), never shows image
 * storage IDs, and the server log line has IDs and the action only.
 */

const USER_FIELDS = 'name username avatarUrl';
const objectId = (id) => new mongoose.Types.ObjectId(String(id));
const idText = (value) => (value && value._id ? String(value._id) : value ? String(value) : '');

// The post as a moderator sees it: the public post fields, nothing more (no storage id; imageUrl is the normal
// post image URL every logged-in user can open).
function queuePost(post) {
  const view = postView(post);
  return {
    _id: view._id,
    author: view.author,
    text: view.text,
    hasImage: Boolean(view.imageUrl),
    imageUrl: view.imageUrl,
    edited: view.edited,
    createdAt: view.createdAt,
  };
}

/*
 * GET /api/moderation/reports
 * [{ post, ownPost, reportCount, reasons: [{ reason, label, count }], notes: [{ reason, label, details, reportedAt }],
 *    firstReportedAt, lastReportedAt }]  — the post that waited longest first.
 * notes = what reporters wrote in "details" (needed for "Something else"), newest first, without who wrote it.
 */
export async function moderationQueue({ limit, viewerId } = {}) {
  const size = readListLimit(limit, QUEUE_DEFAULT, QUEUE_MAX);
  const groups = await openReportQueue({ limit: size });
  if (groups.length === 0) return [];

  const ids = groups.map((group) => objectId(group.postId));
  const [posts, detailRows] = await Promise.all([
    Post.find({ _id: { $in: ids } }).populate('author', USER_FIELDS).lean(),
    PostReport.find({ post: { $in: ids }, status: REPORT_STATUS_OPEN, details: { $nin: ['', null] } })
      .select('post reason details createdAt -_id')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const postsById = new Map(posts.map((post) => [String(post._id), post]));
  const notesByPost = new Map();
  for (const row of detailRows) {
    const key = String(row.post);
    const list = notesByPost.get(key) || [];
    if (list.length < NOTES_PER_POST) list.push({ reason: row.reason, label: reportReasonLabel(row.reason), details: row.details, reportedAt: row.createdAt });
    notesByPost.set(key, list);
  }

  return groups
    .filter((group) => postsById.has(group.postId)) // a post deleted meanwhile has nothing left to review
    .map((group) => {
      const post = postsById.get(group.postId);
      return {
        post: queuePost(post),
        ownPost: Boolean(viewerId) && idText(post.author) === String(viewerId),
        reportCount: group.reportCount,
        reasons: group.reasons,
        notes: notesByPost.get(group.postId) || [],
        firstReportedAt: group.firstReportedAt,
        lastReportedAt: group.lastReportedAt,
      };
    });
}

function actionView(row) {
  if (!row) return null;
  const person = (user) => (user && typeof user === 'object' && user.name !== undefined
    ? { _id: String(user._id), name: user.name, username: user.username }
    : null);
  return {
    _id: String(row._id),
    action: row.action,
    resolution: ACTION_RESOLUTIONS[row.action],
    postId: String(row.post),
    postExcerpt: row.postExcerpt || '',
    postAuthor: person(row.postAuthor),
    moderator: person(row.moderator),
    reportCount: row.reportCount,
    reasons: (row.reasons || []).map(({ reason, count }) => ({ reason, label: reportReasonLabel(reason), count })),
    notified: Boolean(row.notified),
    createdAt: row.createdAt,
  };
}

// GET /api/moderation/actions: the moderation log, newest first.
export async function recentModerationActions({ limit } = {}) {
  const size = readListLimit(limit, ACTIONS_DEFAULT, ACTIONS_MAX);
  const rows = await ModerationAction.find({})
    .sort({ createdAt: -1, _id: -1 })
    .limit(size)
    .populate('moderator', 'name username')
    .populate('postAuthor', 'name username')
    .lean();
  return rows.map(actionView);
}

const result = (status, body) => ({ status, body });

/*
 * POST /api/moderation/reports/:postId/(remove|warn|dismiss)
 *   200 { action, postId, resolution, resolvedReports, notified, message, moderationAction }
 *   400 bad post id or action   404 no open reports for this post   409 another moderator handled it first
 *
 * Steps: (1) the post must have open reports, (2) take the post's moderation lock (only one request can hold it),
 * (3) read the open reports again under the lock, (4) do the action, (5) mark all of them resolved,
 * (6) write the moderation log row and the server log line, (7) release the lock.
 */
export async function moderatePost({ postId, action, moderatorId }) {
  if (!isModerationAction(action)) return result(400, { message: MODERATION_MESSAGES.unknownAction });
  if (!validId(postId)) return result(400, { message: MODERATION_MESSAGES.invalidId });

  const post = objectId(postId);
  const hasOpen = await PostReport.exists({ post, status: REPORT_STATUS_OPEN });
  if (!hasOpen) {
    // Reports exist but all are resolved: another moderator (or a double click) got there first -> 409.
    // No reports at all (or the author deleted the post and with it its open reports) -> 404.
    const handledBefore = await PostReport.exists({ post });
    return handledBefore
      ? result(409, { message: MODERATION_MESSAGES.alreadyHandled })
      : result(404, { message: MODERATION_MESSAGES.noOpenReports });
  }

  try {
    // The unique index is what makes the lock work; init() waits for it once (Mongoose remembers the result).
    await ModerationLock.init();
    await ModerationLock.create({ post, moderator: moderatorId });
  } catch (error) {
    if (error?.code === 11000) return result(409, { message: MODERATION_MESSAGES.alreadyHandled });
    throw error;
  }

  try {
    const open = await PostReport.find({ post, status: REPORT_STATUS_OPEN }).sort({ createdAt: 1, _id: 1 }).select('reason createdAt').lean();
    if (open.length === 0) return result(409, { message: MODERATION_MESSAGES.alreadyHandled });

    const reasons = summarizeReasons(open.map((report) => report.reason));
    const target = await Post.findById(post).select('author text image').lean();
    const authorId = target ? idText(target.author) : '';
    const ownPost = Boolean(authorId) && authorId === String(moderatorId);
    let notified = false;
    let message = MODERATION_MESSAGES.dismissed;

    if (action === MODERATION_ACTION_REMOVE) {
      // Same clean-up as the author's own delete (routes/posts.js DELETE): the post, its image, its votes and comments.
      const removed = await Post.findOneAndDelete({ _id: post });
      if (removed) {
        await deletePostImage(removed.image?.storageId);
        await deleteVotesForPost(removed._id);
        await deleteCommentsForPost(removed._id); // [Sprint 7 · M3] its comments and replies go with it
      }
      message = MODERATION_MESSAGES.removed;
    } else if (action === MODERATION_ACTION_WARN) {
      if (target && !ownPost) {
        const sent = await createPersonalNotification({
          recipient: authorId,
          type: 'moderation_warning',
          project: null,
          actor: null, // the author is told "a Content Moderator", not which one
          summary: warningSummary(target.text, reasons),
          targetType: 'post',
          targetId: post,
          targetLabel: postExcerpt(target.text),
          link: WARNING_LINK,
          dedupeKey: warningDedupeKey(String(post), String(open[0]._id)),
        });
        notified = Boolean(sent);
      }
      message = ownPost ? MODERATION_MESSAGES.warnedSelf : MODERATION_MESSAGES.warned;
    }

    const resolution = ACTION_RESOLUTIONS[action];
    const resolved = await PostReport.updateMany(
      { post, status: REPORT_STATUS_OPEN },
      { $set: { status: REPORT_STATUS_RESOLVED, resolvedBy: moderatorId, resolvedAt: new Date(), resolution } }
    );

    const logged = await ModerationAction.create({
      moderator: moderatorId,
      action,
      post,
      postAuthor: authorId || null,
      postExcerpt: postExcerpt(target?.text || ''),
      reportCount: open.length,
      reasons: reasons.map(({ reason, count }) => ({ reason, count })),
      notified,
    });

    if (process.env.NODE_ENV !== 'test') {
      console.info(moderationLogLine({ action, postId: String(post), moderatorId: String(moderatorId), authorId, reportCount: open.length }));
    }

    const populated = await ModerationAction.findById(logged._id)
      .populate('moderator', 'name username')
      .populate('postAuthor', 'name username')
      .lean();

    return result(200, {
      action,
      postId: String(post),
      resolution,
      resolvedReports: resolved.modifiedCount,
      notified,
      message,
      moderationAction: actionView(populated),
    });
  } finally {
    await ModerationLock.deleteOne({ post }).catch(() => {});
  }
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M7] What this file does
 * The moderator queue (each reported post with its reasons and report count, without saying who reported it),
 * the three actions Remove / Warn / Dismiss with one moderator at a time per post, marking the reports resolved,
 * and the moderation log.
 * ---------------------------------------------------------------------------
 */
