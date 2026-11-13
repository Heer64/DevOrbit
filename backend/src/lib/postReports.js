import mongoose from 'mongoose';
import PostReport from '../models/PostReport.js';
import { REPORT_STATUS_OPEN, reportView, summarizeReasons } from './reportRules.js';

/*
 * [Sprint 6 · M6] US-55 Report a public post: the database side. Routes and later sprints import from here:
 *
 *   createReport({ postId, reporterId, reason, details })
 *        -> { outcome: 'created', report }            a new open report (it is now in the moderator queue)
 *        -> { outcome: 'already_reported', report }   this user already reported this post (AC2)
 *   findMyReport(postId, userId)      -> report view | null
 *   deleteOpenReportsForPost(postId)  -> removes the post's open reports (used when the author deletes the post)
 *   openReportQueue({ limit })        -> the moderator queue data for US-56 (see below)
 *
 * "One report per user per post" is decided by the unique index on PostReport { post, reporter },
 * not by a read-then-write check, so two identical reports sent at the same moment store one row.
 */

export async function findMyReport(postId, userId) {
  const report = await PostReport.findOne({ post: postId, reporter: userId }).lean();
  return reportView(report);
}

export async function createReport({ postId, reporterId, reason, details = '' }) {
  try {
    const created = await PostReport.create({ post: postId, reporter: reporterId, reason, details });
    return { outcome: 'created', report: reportView(created) };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    // The unique index refused a second report by the same user (AC2). Show them their first one.
    return { outcome: 'already_reported', report: await findMyReport(postId, reporterId) };
  }
}

// The author deleted the post (US-51): there is nothing left to review, so its open reports leave
// the queue. Reports a moderator already resolved stay as history.
export async function deleteOpenReportsForPost(postId) {
  const result = await PostReport.deleteMany({ post: postId, status: REPORT_STATUS_OPEN });
  return result.deletedCount || 0;
}

/*
 * The moderator queue data (US-56 builds the page, the moderator check and the actions on top of this).
 * One entry per reported post with open reports, the post that waited longest first:
 *   [{ postId, reportCount, reasons: [{ reason, label, count }], firstReportedAt, lastReportedAt }]
 * reportCount = number of open reports (= number of different users who reported it).
 */
export const REPORT_QUEUE_DEFAULT = 50;
export const REPORT_QUEUE_MAX = 100;

export async function openReportQueue({ limit = REPORT_QUEUE_DEFAULT, postId = null } = {}) {
  const size = Math.min(Math.max(Number.parseInt(limit, 10) || REPORT_QUEUE_DEFAULT, 1), REPORT_QUEUE_MAX);
  const match = { status: REPORT_STATUS_OPEN };
  if (postId) match.post = new mongoose.Types.ObjectId(String(postId));

  const groups = await PostReport.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$post',
        reportCount: { $sum: 1 },
        reasons: { $push: '$reason' },
        firstReportedAt: { $min: '$createdAt' },
        lastReportedAt: { $max: '$createdAt' },
      },
    },
    { $sort: { firstReportedAt: 1, _id: 1 } },
    { $limit: size },
  ]);

  return groups.map((group) => ({
    postId: String(group._id),
    reportCount: group.reportCount,
    reasons: summarizeReasons(group.reasons),
    firstReportedAt: group.firstReportedAt,
    lastReportedAt: group.lastReportedAt,
  }));
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M6] What this file does
 * Saves a user's report of a public post (one per user per post, enforced by MongoDB),
 * tells whether the user already reported a post, removes open reports of a deleted post,
 * and gives the moderator queue its data: each reported post with its reasons and report count.
 * ---------------------------------------------------------------------------
 */
