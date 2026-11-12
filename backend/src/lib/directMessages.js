import mongoose from 'mongoose';
import DirectConversation from '../models/DirectConversation.js';
import DirectMessage from '../models/DirectMessage.js';
import { emitToUser } from './realtime.js';
import {
  DM_INBOX_LIMIT,
  DM_USER_FIELDS,
  conversationView,
  idOf,
  mayHaveUnread,
  messageView,
  otherParticipant,
  pairKeyOf,
  previewOf,
  readAtFor,
} from './directMessageRules.js';

/*
 * [Sprint 6 · M2] US-19 Direct messages (FR-6, NFR-1b). Database work for routes/directMessages.js.
 *
 * Privacy (AC2): every read goes through loadConversationFor(), which only finds a conversation when
 * the caller is one of its two participants, and live events go only to the participants' own rooms.
 */

const objectId = (value) => new mongoose.Types.ObjectId(idOf(value));

// The conversation with this ID, with both participants' public fields, or null when the user is not in it.
export function loadConversationFor(conversationId, userId) {
  return DirectConversation.findOne({ _id: conversationId, participants: objectId(userId) })
    .populate('participants', DM_USER_FIELDS)
    .lean();
}

/*
 * AC1: "Message" on a profile opens the conversation with that user, creating it the first time.
 * Atomic upsert on the unique pairKey, so two "Message" clicks at the same moment still give one conversation.
 */
export async function openConversation(meId, otherId) {
  const me = objectId(meId);
  const other = objectId(otherId);
  const pairKey = pairKeyOf(me, other);
  let conversation;
  try {
    conversation = await DirectConversation.findOneAndUpdate(
      { pairKey },
      { $setOnInsert: { participants: [me, other], activityAt: new Date() }, $addToSet: { openedBy: me } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    // The other person created it a moment earlier: use theirs.
    conversation = await DirectConversation.findOneAndUpdate({ pairKey }, { $addToSet: { openedBy: me } }, { new: true });
  }
  return loadConversationFor(conversation._id, me);
}

// Unread messages for this user in one conversation: messages from the other person after their last read.
export async function unreadCountFor(conversation, userId) {
  if (!mayHaveUnread(conversation, userId)) return 0;
  const readAt = readAtFor(conversation, userId);
  const filter = { conversation: conversation._id, sender: { $ne: objectId(userId) } };
  if (readAt) filter.createdAt = { $gt: readAt };
  return DirectMessage.countDocuments(filter);
}

// All unread direct messages of this user (the badge on "Messages" in the sidebar).
export async function unreadTotalFor(userId) {
  const conversations = await DirectConversation.find({ participants: objectId(userId), lastMessageAt: { $ne: null } })
    .select('_id lastMessageAt reads')
    .lean();
  const counts = await Promise.all(conversations.filter((item) => mayHaveUnread(item, userId)).map((item) => unreadCountFor(item, userId)));
  return counts.reduce((sum, count) => sum + count, 0);
}

/*
 * The inbox: newest activity first. A conversation without messages only shows for the person who opened it.
 * -> { conversations: [conversationView], unreadTotal }
 */
export async function inboxFor(userId) {
  const me = objectId(userId);
  const rows = await DirectConversation.find({
    participants: me,
    $or: [{ lastMessageAt: { $ne: null } }, { openedBy: me }],
  })
    .sort({ activityAt: -1, _id: -1 })
    .limit(DM_INBOX_LIMIT)
    .populate('participants', DM_USER_FIELDS)
    .lean();
  const [counts, unreadTotal] = await Promise.all([Promise.all(rows.map((row) => unreadCountFor(row, me))), unreadTotalFor(me)]);
  return { conversations: rows.map((row, index) => conversationView(row, me, counts[index])), unreadTotal };
}

/*
 * One page of messages, oldest first, like project chat. `before` = the ID of the oldest message the
 * browser already has; ties on the same millisecond are broken by ID so no message is skipped or repeated.
 * -> { messages, nextBefore } or null when `before` is not a message of this conversation.
 */
export async function messagePage(conversation, { limit, before } = {}) {
  const filter = { conversation: conversation._id };
  if (before) {
    const anchor = await DirectMessage.findOne({ _id: before, conversation: conversation._id }).select('_id createdAt').lean();
    if (!anchor) return null;
    filter.$or = [{ createdAt: { $lt: anchor.createdAt } }, { createdAt: anchor.createdAt, _id: { $lt: anchor._id } }];
  }
  const rows = await DirectMessage.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate('sender', DM_USER_FIELDS)
    .lean();
  const page = rows.slice(0, limit);
  const nextBefore = rows.length > limit ? idOf(page[page.length - 1]) : null;
  return { messages: page.reverse().map(messageView), nextBefore };
}

/*
 * Marks everything up to the newest message as read for this user. $max: a slow request can never move
 * the read time backwards. Tells the user's other tabs, so their badges drop too.
 * -> { unreadCount: 0, unreadTotal }
 */
export async function markRead(conversation, userId) {
  if (conversation.lastMessageAt) {
    await DirectConversation.updateOne(
      { _id: conversation._id },
      { $max: { [`reads.${idOf(userId)}`]: new Date(conversation.lastMessageAt) } }
    );
  }
  const unreadTotal = await unreadTotalFor(userId);
  emitToUser(userId, 'dm:read', { conversationId: idOf(conversation), unreadTotal });
  return { unreadCount: 0, unreadTotal };
}

/*
 * AC2: saves the message, then pushes it at once to both participants' own rooms (the recipient sees it
 * live; the sender's other tabs too). Nobody else gets it. Sending also marks the conversation read for
 * the sender. -> { message, conversation } as seen by the sender.
 */
export async function sendMessage(conversation, senderId, body) {
  const sender = objectId(senderId);
  const recipient = objectId(otherParticipant(conversation, sender));

  const created = await DirectMessage.create({ conversation: conversation._id, sender, body });
  const at = created.createdAt;

  await Promise.all([
    // The sender has read everything up to their own message.
    DirectConversation.updateOne({ _id: conversation._id }, { $max: { [`reads.${idOf(sender)}`]: at, activityAt: at } }),
    // Inbox row: only if no newer message got there first (two messages sent at once).
    DirectConversation.updateOne(
      { _id: conversation._id, $or: [{ lastMessageAt: null }, { lastMessageAt: { $lte: at } }] },
      { $set: { lastMessageAt: at, lastMessagePreview: previewOf(body), lastMessageSender: sender } }
    ),
  ]);

  const [updated, populated] = await Promise.all([
    DirectConversation.findById(conversation._id).populate('participants', DM_USER_FIELDS).lean(),
    DirectMessage.findById(created._id).populate('sender', DM_USER_FIELDS).lean(),
  ]);
  const message = messageView(populated);
  const conversationId = idOf(conversation);

  const [recipientUnread, recipientTotal, senderTotal] = await Promise.all([
    unreadCountFor(updated, recipient),
    unreadTotalFor(recipient),
    unreadTotalFor(sender),
  ]);
  emitToUser(recipient, 'dm:message', {
    conversationId,
    message,
    conversation: conversationView(updated, recipient, recipientUnread),
    unreadTotal: recipientTotal,
  });
  const senderView = conversationView(updated, sender, 0);
  emitToUser(sender, 'dm:message', { conversationId, message, conversation: senderView, unreadTotal: senderTotal });

  return { message, conversation: senderView };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M2] What this file does
 * Direct messages (US-19) in the database: open or create the one conversation
 * between two users, list a user's inbox with unread counts, read pages of
 * messages, send a message (saved, then pushed live to the two participants
 * only) and mark a conversation read.
 * ---------------------------------------------------------------------------
 */
