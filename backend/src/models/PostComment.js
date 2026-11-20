import mongoose from 'mongoose';
import { COMMENT_TEXT_MAX } from '../lib/commentRules.js';

/*
 * [Sprint 7 · M3] A comment on a public post, or a reply to such a comment (one level deep).
 *
 *   parent: null      -> a comment on the post
 *   parent: <comment> -> a reply to that comment (the parent is always a comment, never a reply)
 *
 * deletedAt is only set on a comment that still had replies when its author deleted it: it then shows
 * as "Comment deleted" so the replies keep their context (lib/commentRules.js deleteMode()).
 * Everything else that is deleted is removed from the collection.
 *
 * The post's commentCount (models/Post.js) counts the rows here whose deletedAt is null.
 * Rules: lib/commentRules.js. API: routes/postComments.js.
 */
const postCommentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'PostComment', default: null },
    text: {
      type: String,
      trim: true,
      maxlength: [COMMENT_TEXT_MAX, `Comments must be ${COMMENT_TEXT_MAX} characters or fewer.`],
      // A deleted placeholder keeps no text; every live comment has some.
      required: [function textRequired() { return !this.deletedAt; }, 'Write a comment first.'],
      default: '',
    },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The comments of one post in reading order (oldest first), and the replies of one comment.
postCommentSchema.index({ post: 1, parent: 1, _id: 1 });
postCommentSchema.index({ parent: 1, _id: 1 });
// Seed --reset and account clean-up find everything one user wrote.
postCommentSchema.index({ author: 1 });

export default mongoose.model('PostComment', postCommentSchema);
