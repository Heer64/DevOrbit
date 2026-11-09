import mongoose from 'mongoose';

/*
 * [Sprint 5 · M8] US-54 Follow users (FR-26): "follower follows following".
 *
 * One row per pair. The unique index on { follower, following } makes duplicates impossible on the
 * server, even when the same Follow request arrives twice at the same moment. Unfollow deletes the
 * row. A user can never follow themselves (checked in lib/follows.js before anything is written).
 *
 * The follower count of a user is the number of rows with following = that user
 * (index { following: 1 }), so it is always the real number, never a stored counter that can drift.
 * Who follows whom is never sent to the browser; only counts and "do I follow them".
 */
const followSchema = new mongoose.Schema(
  {
    follower: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    following: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

followSchema.index({ follower: 1, following: 1 }, { unique: true }); // no duplicates; "do I follow X"
followSchema.index({ following: 1 }); // follower counts

export default mongoose.model('Follow', followSchema);
