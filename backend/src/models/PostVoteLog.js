import mongoose from 'mongoose';
import { VOTE_WINDOW_MS } from '../lib/voteRules.js';

/*
 * [Sprint 5 · M7] One row per vote request a user made (NFR-16 "30 votes per minute per user").
 *
 * Same idea as PostCreateLog (Sprint 5 · M6): the limit is kept in MongoDB, not in server memory,
 * so it still holds after a restart and if the API ever runs on more than one server.
 * MongoDB removes rows by itself one minute after they were written (TTL index), so this
 * collection stays tiny. The route still filters by time, because the TTL clean-up runs about
 * once a minute, not exactly on time.
 */
const postVoteLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: Math.round(VOTE_WINDOW_MS / 1000), // 60 s
  },
});

postVoteLogSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('PostVoteLog', postVoteLogSchema);
