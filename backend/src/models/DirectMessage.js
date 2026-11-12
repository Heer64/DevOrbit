import mongoose from 'mongoose';
import { DM_BODY_MAX } from '../lib/directMessageRules.js';

/*
 * [Sprint 6 · M2] US-19 One message in a direct conversation (models/DirectConversation.js).
 * Kept apart from project channel messages (models/Message.js): a different collection with no project
 * or channel, so no project query (chat, Activity Feed, Copilot) can ever pick it up.
 */
const directMessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'DirectConversation', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: DM_BODY_MAX },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A conversation is read newest page first; unread counts look at messages after a time.
directMessageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });

export default mongoose.model('DirectMessage', directMessageSchema);
