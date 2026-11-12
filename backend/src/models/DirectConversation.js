import mongoose from 'mongoose';

/*
 * [Sprint 6 · M2] US-19 Direct messages (FR-6): one private conversation between exactly two users.
 *
 * It has nothing to do with projects: no project field, no channel, no Activity Feed entry, so it is
 * separate from every project channel (US-19 AC1). Only the two `participants` can read it (AC2).
 *
 * - pairKey "<smaller user ID>:<larger user ID>" with a unique index: whoever presses "Message" first
 *   creates it and the other person's "Message" opens the same one, even if both press it at once.
 * - openedBy: who pressed "Message". A conversation with no messages yet is only in the inbox of the
 *   person who opened it; the other person sees it once the first message arrives.
 * - lastMessageAt / lastMessagePreview / lastMessageSender: the inbox row, kept in step with the newest
 *   message (routes never move it backwards, see lib/directMessages.js).
 * - reads: user ID -> the newest message time that user has read. Unread = messages from the other
 *   person after that time, counted from DirectMessage, so the number can never drift.
 */
const directConversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      validate: {
        validator: (list) => Array.isArray(list) && list.length === 2,
        message: 'A direct conversation has exactly two participants.',
      },
    },
    pairKey: { type: String, required: true, maxlength: 60 },
    openedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, maxlength: 160, default: '' },
    lastMessageSender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Inbox order: the newest message time, or when the conversation was opened if it has none yet.
    activityAt: { type: Date, default: Date.now },
    // { "<userId>": Date }. Written only with $max on 'reads.<userId>' (lib/directMessages.js), so a read time
    // never moves backwards. Missing until someone reads or sends.
    reads: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

directConversationSchema.index({ pairKey: 1 }, { unique: true }); // one conversation per pair
directConversationSchema.index({ participants: 1, activityAt: -1 }); // my inbox, newest first

export default mongoose.model('DirectConversation', directConversationSchema);
