import mongoose from 'mongoose';
import { VOTE_DOWN, VOTE_UP } from '../lib/voteRules.js';

/*
 * [Sprint 5 · M7] One user's ACTIVE vote on one public post (US-52, FR-24, NFR-13).
 *
 * The unique index on { post, user } is what makes "one active vote per user per post" true on
 * the server: even if the same user sends two votes at the same moment, MongoDB can only store
 * one row. Retracting a vote deletes the row; there is no row with value 0.
 *
 * The post's upvotes / downvotes / score (on Post) are moved by the vote engine
 * (lib/postVotes.js) with an atomic $inc, only by the request that actually changed this row.
 */
const postVoteSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    value: {
      type: Number,
      required: true,
      enum: [VOTE_UP, VOTE_DOWN],
    },
  },
  { timestamps: true }
);

// One vote per user per post (NFR-13). Also serves "votes of this post" (delete, recount).
postVoteSchema.index({ post: 1, user: 1 }, { unique: true });
// "My votes on these posts" when a feed page is loaded.
postVoteSchema.index({ user: 1, post: 1 });

export default mongoose.model('PostVote', postVoteSchema);
