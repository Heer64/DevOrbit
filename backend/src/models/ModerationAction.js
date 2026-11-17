import mongoose from 'mongoose';
import { MODERATION_ACTIONS } from '../lib/moderationRules.js';
import { REPORT_REASON_VALUES } from '../lib/reportRules.js';

/*
 * [Sprint 6 · M7] The moderation log (US-56; plan task "log moderation outcomes without exposing secrets").
 *
 * One row per Remove / Warn / Dismiss. It keeps who decided, what, about which post and author, how many reports
 * there were and why, plus a short quote of the post (public text) so the log still makes sense after a removal.
 * It never stores reporter identities, emails, tokens, image storage ids or request bodies.
 * Read by GET /api/moderation/actions (Content Moderators and Platform Admins only).
 */
const moderationActionSchema = new mongoose.Schema(
  {
    moderator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: MODERATION_ACTIONS, required: true },
    post: { type: mongoose.Schema.Types.ObjectId, required: true }, // the post may no longer exist (Remove)
    postAuthor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    postExcerpt: { type: String, trim: true, maxlength: 80, default: '' },
    reportCount: { type: Number, min: 0, default: 0 },
    reasons: [
      {
        _id: false,
        reason: { type: String, enum: REPORT_REASON_VALUES, required: true },
        count: { type: Number, min: 1, required: true },
      },
    ],
    // Warn only: whether the author was notified (false when a moderator warned about their own post).
    notified: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Newest first for the log; per post for "what happened to this post?".
moderationActionSchema.index({ createdAt: -1, _id: -1 });
moderationActionSchema.index({ post: 1, createdAt: -1 });

export default mongoose.model('ModerationAction', moderationActionSchema);
