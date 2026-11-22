import mongoose from 'mongoose';

export const MESSAGE_MAX = 4000;

// [Sprint 7 · M1] A deleted message keeps its row (so the channel and its thread still read in order)
// but not its text.
function bodyRequired() {
  return !this.deletedAt;
}

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
      required: bodyRequired, // [Sprint 7 · M1] was `true`; still required unless the message was deleted
      trim: true,
      maxlength: MESSAGE_MAX,
      default: '',
    },
    // [Sprint 3 · US-17] Thread replies. null (or missing, for messages saved before threads
    // existed) = a normal channel message. Set = a reply inside that message's thread.
    // Threads are one level deep: a reply always points at a top-level message.
    parentMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    // [US-17] Kept on the top-level message so the channel can show "3 replies" without counting.
    // Only changed with $inc in routes/threads.js, so two replies at once cannot lose a count.
    replyCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastReplyAt: {
      type: Date,
      default: null,
    },
    // [Sprint 3 · US-18] Project members @mentioned in this message (lib/mentions.js).
    // The chat highlights them; each one also got a Mention notification.
    mentions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // [Sprint 7 · M1] Edit and delete your own messages and thread replies (lib/channelMessageEdits.js).
    // Messages saved before Sprint 7 have neither field, which reads as "not edited, not deleted"
    // (a missing field matches `null` in MongoDB queries).
    editedAt: { type: Date, default: null }, // set when the author changes the text ("edited")
    deletedAt: { type: Date, default: null }, // set when the author deletes it; body and mentions are emptied
  },
  { timestamps: true }
);

// Channel history is read newest-first, one page at a time.
messageSchema.index({ channel: 1, createdAt: -1, _id: -1 });
messageSchema.index({ project: 1, createdAt: -1 });
// [US-17] A thread is read oldest-first.
messageSchema.index({ parentMessage: 1, createdAt: 1, _id: 1 });

export default mongoose.model('Message', messageSchema);

/*
 * ---------------------------------------------------------------------------
 * [Sprint 2 final] What this file does
 * One chat message in a project channel (US-16). Messages are kept when their
 * author leaves or is removed from the project (US-13/US-14 "history remains").
 * ---------------------------------------------------------------------------
 */
