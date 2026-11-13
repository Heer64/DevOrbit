import mongoose from 'mongoose';
import { REPORT_DETAILS_MAX, REPORT_REASON_VALUES, REPORT_STATUSES, REPORT_STATUS_OPEN } from '../lib/reportRules.js';

/*
 * [Sprint 6 · M6] One user's report of one public post (US-55 Report a public post, FR-27).
 *
 * A new report is "open": that is what puts it in the moderator queue (US-56). The moderator's
 * Remove / Warn / Dismiss marks it "resolved" (US-56 adds who resolved it and how).
 *
 * The unique index on { post, reporter } is what makes "one report per user per post" true on the
 * server (US-55 AC2): even if the same user sends the report twice at the same moment, MongoDB can
 * only store one row, and the second request is told "You have already reported this post."
 */
const postReportSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      required: true,
      enum: REPORT_REASON_VALUES,
    },
    details: {
      type: String,
      trim: true,
      maxlength: REPORT_DETAILS_MAX,
      default: '',
    },
    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: REPORT_STATUS_OPEN,
    },
  },
  { timestamps: true }
);

// One report per user per post (US-55 AC2). Also serves "did I report this post?".
postReportSchema.index({ post: 1, reporter: 1 }, { unique: true });
// The moderator queue (US-56): open reports, oldest first.
postReportSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model('PostReport', postReportSchema);
