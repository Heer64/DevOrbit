import mongoose from 'mongoose';
import { DM_BODY_MAX } from '../lib/directMessageRules.js';

// [Sprint 7 · M2] A deleted message keeps its row (so the conversation still reads in order) but not its text.
function bodyRequired() {
  return !this.deletedAt;
}

/*
 * [Sprint 6 · M2] US-19 One message in a direct conversation (models/DirectConversation.js).
 * Kept apart from project channel messages (models/Message.js): a different collection with no project
 * or channel, so no project query (chat, Activity Feed, Copilot) can ever pick it up.
 */
const directMessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'DirectConversation', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: bodyRequired, trim: true, maxlength: DM_BODY_MAX, default: '' },
    // [Sprint 7 · M2] Edit and delete your own messages. Messages saved before Sprint 7 have neither field,
    // which reads as "not edited, not deleted" (a missing field matches `null` in MongoDB queries).
    editedAt: { type: Date, default: null }, // set when the sender changes the text ("edited")
    deletedAt: { type: Date, default: null }, // set when the sender deletes it; body is emptied ("Message deleted")
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A conversation is read newest page first; unread counts look at messages after a time.
directMessageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });

export default mongoose.model('DirectMessage', directMessageSchema);
