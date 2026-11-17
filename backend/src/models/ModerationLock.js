import mongoose from 'mongoose';
import { MODERATION_LOCK_SECONDS } from '../lib/moderationRules.js';

/*
 * [Sprint 6 · M7] US-56: "one moderator at a time per post".
 *
 * Resolving a post's reports touches several report rows, and MongoDB does not update several rows as one step.
 * So before Remove / Warn / Dismiss, the route creates this row; the unique index lets only ONE request hold it.
 * A second moderator acting on the same post at the same moment gets 409 "This report was already handled."
 * The row is deleted as soon as the action finishes; if the server stopped mid-action, MongoDB's TTL clean-up
 * removes it after about a minute, so a post can never stay locked.
 */
const moderationLockSchema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  moderator: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now, expires: MODERATION_LOCK_SECONDS },
});

export default mongoose.model('ModerationLock', moderationLockSchema);
