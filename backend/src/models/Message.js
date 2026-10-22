import mongoose from 'mongoose';

export const MESSAGE_MAX = 4000;

const messageSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Channel',
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
      maxlength: MESSAGE_MAX,
    },
  },
  { timestamps: true }
);

// Channel history is read newest-first, one page at a time.
messageSchema.index({ channel: 1, createdAt: -1, _id: -1 });
messageSchema.index({ project: 1, createdAt: -1 });

export default mongoose.model('Message', messageSchema);

/*
 * ---------------------------------------------------------------------------
 * [Sprint 2 final] What this file does
 * One chat message in a project channel (US-16). Messages are kept when their
 * author leaves or is removed from the project (US-13/US-14 "history remains").
 * ---------------------------------------------------------------------------
 */
