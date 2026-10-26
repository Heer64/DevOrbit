import mongoose from 'mongoose';

export const COMMENT_MAX = 2000;

/*
 * [Sprint 3 · US-20] One comment on a task. Comments are kept when their author
 * leaves or is removed from the project, like chat messages (the UI shows "Former member").
 */
const taskCommentSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: COMMENT_MAX,
    },
    // Project members mentioned with @username when the comment was posted (lib/mentions.js).
    // The UI uses it to highlight the mentions; each one also got a Mention notification.
    mentions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true }
);

// A task's comments are read oldest-first.
taskCommentSchema.index({ task: 1, createdAt: 1, _id: 1 });

export default mongoose.model('TaskComment', taskCommentSchema);

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · US-20] What this file does
 * Comments on a task, with author, time (createdAt) and the members @mentioned.
 * Read and written through routes/taskComments.js.
 * ---------------------------------------------------------------------------
 */
