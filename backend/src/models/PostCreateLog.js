import mongoose from 'mongoose';
import { POST_WINDOW_MS } from '../lib/postRules.js';

/*
 * [Sprint 5 · M6] One row per post a user created (US-50 AC2 "10 posts in the last hour", NFR-16).
 *
 * Kept apart from Post on purpose: deleting a post must not give the slot back, otherwise a
 * script could delete and re-post forever. MongoDB removes rows by itself one hour after
 * they were written (TTL index), so this collection stays small. The route still filters by
 * time, because the TTL clean-up runs about once a minute, not exactly on time.
 */
const postCreateLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: Math.round(POST_WINDOW_MS / 1000), // 3600 s
  },
});

postCreateLogSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('PostCreateLog', postCreateLogSchema);
