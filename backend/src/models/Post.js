import mongoose from 'mongoose';
import { MAX_POST_IMAGE_BYTES, POST_TEXT_MAX } from '../lib/postRules.js';

/*
 * [Sprint 5 · M6] A public post (US-50 Create a public post, US-51 Edit or delete my post, FR-23).
 *
 * A post belongs to its author, not to any project. Text is required (up to 500 characters);
 * one optional image is kept in MongoDB GridFS (bucket "postImages") and image.storageId points at it.
 *
 * Deleting a post removes this document and its image, so it disappears from every feed and
 * its votes no longer count (US-51 AC2).
 *
 * upvotes / downvotes / score are created here with 0 so Sprint 5 M7 (US-52 voting) and
 * M8 (US-53 trending, US-54 total vote score) can build on one shared shape.
 * score = upvotes - downvotes (FR-24). Always "score", never "likes" (NFR-27).
 */
const postImageSchema = new mongoose.Schema(
  {
    storageId: { type: mongoose.Schema.Types.ObjectId, required: true },
    contentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
    size: { type: Number, required: true, min: 1, max: MAX_POST_IMAGE_BYTES },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: [true, 'Write something before posting.'],
      trim: true,
      maxlength: [POST_TEXT_MAX, `Posts must be ${POST_TEXT_MAX} characters or fewer.`],
    },
    image: {
      type: postImageSchema,
      default: null,
    },
    // Set when the author edits the text; the post then shows "edited" (US-51 AC1).
    editedAt: {
      type: Date,
      default: null,
    },
    // [Sprint 5 · M7] US-52: moved only by lib/postVotes.js with one atomic $inc per vote change.
    // The votes themselves are PostVote rows (one per user per post).
    upvotes: { type: Number, default: 0, min: 0 },
    downvotes: { type: Number, default: 0, min: 0 },
    score: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Newest-first feed, and "posts by this user" (portfolio/profile, M8's total vote score).
postSchema.index({ createdAt: -1, _id: -1 });
postSchema.index({ author: 1, createdAt: -1 });

export default mongoose.model('Post', postSchema);
