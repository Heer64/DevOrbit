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
  messagePreview,
  messageView,
  otherParticipant,
  otherReadAtFor,
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
  // [Sprint 7 · M2] A message deleted before it was read no longer counts as unread.
  const filter = { conversation: conversation._id, sender: { $ne: objectId(userId) }, deletedAt: null };
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
 * [Sprint 7 · M2] `viewerId` = who is reading: their own messages get status 'sent' / 'seen', and the page
 * carries otherReadAt (when the other person last read) so the browser can keep the marks up to date.
 * -> { messages, nextBefore, otherReadAt } or null when `before` is not a message of this conversation.
 */
export async function messagePage(conversation, { limit, before, viewerId = null } = {}) {
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
  const otherReadAt = viewerId ? otherReadAtFor(conversation, viewerId) : null;
  return {
    messages: page.reverse().map((message) => messageView(message, { viewerId, otherReadAt })),
    nextBefore,
    otherReadAt,
  };
}

/*
 * Marks everything up to the newest message as read for this user. $max: a slow request can never move
 * the read time backwards. Tells the user's other tabs, so their badges drop too.
 * [Sprint 7 · M2] The read time is saved in the conversation (reads.<userId>), so "Seen" survives reloads.
 * The other person gets 'dm:seen' { conversationId, readAt } at once: their messages sent up to readAt
 * turn from "Sent" to "Seen".
 * -> { unreadCount: 0, unreadTotal }   (the same answer as in Sprint 6)
 */
export async function markRead(conversation, userId) {
  let readAt = readAtFor(conversation, userId);
  if (conversation.lastMessageAt) {
    const updated = await DirectConversation.findOneAndUpdate(
      { _id: conversation._id },
      { $max: { [`reads.${idOf(userId)}`]: new Date(conversation.lastMessageAt) } },
      { new: true }
    )
      .select('reads')
      .lean();
    readAt = readAtFor(updated, userId) || readAt;
  }
  const unreadTotal = await unreadTotalFor(userId);
  const conversationId = idOf(conversation);
  emitToUser(userId, 'dm:read', { conversationId, unreadTotal });
  const other = otherParticipant(conversation, userId);
  if (other && readAt) emitToUser(idOf(other), 'dm:seen', { conversationId, readAt });
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
  // [Sprint 7 · M2] The recipient sees a plain message; the sender sees it with status 'sent'.
  const message = messageView(populated);
  const senderMessage = messageView(populated, { viewerId: sender, otherReadAt: otherReadAtFor(updated, sender) });
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
  emitToUser(sender, 'dm:message', { conversationId, message: senderMessage, conversation: senderView, unreadTotal: senderTotal });

  return { message: senderMessage, conversation: senderView };
}

/*
 * [Sprint 7 · M2] Edit and delete your own direct messages.
 *
 * Both are single atomic updates that only match the sender's own, not-yet-deleted message, so an edit
 * racing a delete can never bring the text back. The routes check who may do it first (403 for the other
 * person); the filters here are a second guard.
 *
 * After a change both participants get 'dm:updated' { conversationId, message, conversation, unreadTotal }
 * in their own rooms (nobody else), so the message changes live on both sides and in every open tab.
 */

// The message with this ID in this conversation (any sender), or null.
export function findMessageIn(conversation, messageId) {
  return DirectMessage.findOne({ _id: messageId, conversation: conversation._id }).lean();
}

/*
 * When the changed message is the newest one, the inbox line follows it (new text, or "Message deleted").
 * The filter on lastMessageAt makes this a no-op if a newer message arrived in the meantime.
 */
async function refreshInboxPreview(conversation, messageId) {
  const newest = await DirectMessage.findOne({ conversation: conversation._id })
    .sort({ createdAt: -1, _id: -1 })
    .select('_id body deletedAt createdAt')
    .lean();
  if (!newest || idOf(newest) !== idOf(messageId)) return;
  await DirectConversation.updateOne(
    { _id: conversation._id, lastMessageAt: newest.createdAt },
    { $set: { lastMessagePreview: messagePreview(newest) } }
  );
}

// The message and conversation as they are now, as `viewerId` sees them (used when nothing changed).
async function currentView(conversation, messageId, viewerId) {
  const [populated, fresh] = await Promise.all([
    DirectMessage.findById(messageId).populate('sender', DM_USER_FIELDS).lean(),
    DirectConversation.findById(conversation._id).populate('participants', DM_USER_FIELDS).lean(),
  ]);
  const unread = await unreadCountFor(fresh, viewerId);
  return {
    message: messageView(populated, { viewerId, otherReadAt: otherReadAtFor(fresh, viewerId) }),
    conversation: conversationView(fresh, viewerId, unread),
  };
}

// Sends the changed message to both participants and returns what the person who changed it sees.
async function announceChange(conversation, messageId, actorId) {
  const actor = objectId(actorId);
  const other = otherParticipant(conversation, actor);
  const [updated, populated] = await Promise.all([
    DirectConversation.findById(conversation._id).populate('participants', DM_USER_FIELDS).lean(),
    DirectMessage.findById(messageId).populate('sender', DM_USER_FIELDS).lean(),
  ]);
  const conversationId = idOf(conversation);
  const people = [actor, ...(other ? [objectId(other)] : [])];
  const views = await Promise.all(
    people.map(async (person) => {
      const [unread, unreadTotal] = await Promise.all([unreadCountFor(updated, person), unreadTotalFor(person)]);
      return {
        person,
        payload: {
          conversationId,
          message: messageView(populated, { viewerId: person, otherReadAt: otherReadAtFor(updated, person) }),
          conversation: conversationView(updated, person, unread),
          unreadTotal,
        },
      };
    })
  );
  for (const { person, payload } of views) emitToUser(person, 'dm:updated', payload);
  const mine = views[0].payload;
  return { message: mine.message, conversation: mine.conversation };
}

/*
 * The sender changes the text. Saving the same text again is not an edit (no "edited" mark, no event).
 * -> { changed: true | false, message, conversation } or { changed: false, deleted: true } when the message
 *    was deleted in the meantime.
 */
export async function editMessage(conversation, message, editorId, body) {
  if (message.body === body && !message.deletedAt) return { changed: false, ...(await currentView(conversation, message._id, editorId)) };
  const result = await DirectMessage.updateOne(
    { _id: message._id, conversation: conversation._id, sender: objectId(editorId), deletedAt: null },
    { $set: { body, editedAt: new Date() } }
  );
  if (!result.matchedCount) return { changed: false, deleted: true };
  await refreshInboxPreview(conversation, message._id);
  return { changed: true, ...(await announceChange(conversation, message._id, editorId)) };
}

/*
 * The sender deletes the message. The row stays (so the conversation still reads in order and replies
 * keep their context) as "Message deleted"; its text is removed from the database. Deleting it again
 * changes nothing. -> { changed, message, conversation }
 */
export async function deleteMessage(conversation, message, senderId) {
  const result = await DirectMessage.updateOne(
    { _id: message._id, conversation: conversation._id, sender: objectId(senderId), deletedAt: null },
    { $set: { deletedAt: new Date(), body: '', editedAt: null } }
  );
  if (!result.matchedCount) return { changed: false, ...(await currentView(conversation, message._id, senderId)) };
  await refreshInboxPreview(conversation, message._id);
  return { changed: true, ...(await announceChange(conversation, message._id, senderId)) };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M2] What this file does
 * Direct messages (US-19) in the database: open or create the one conversation
 * between two users, list a user's inbox with unread counts, read pages of
 * messages, send a message (saved, then pushed live to the two participants
 * only) and mark a conversation read.
 * [Sprint 7 · M2] Edit and delete your own messages (pushed live as
 * 'dm:updated'), and tell the sender when their messages were seen ('dm:seen').
 * ---------------------------------------------------------------------------
 */
