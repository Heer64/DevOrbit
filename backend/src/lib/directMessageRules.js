/*
 * [Sprint 6 · M2] US-19 Direct messages: rules that need no database (tested in test/directMessageRules.test.js).
 * lib/directMessages.js and routes/directMessages.js use them.
 */

export const DM_BODY_MAX = 4000; // same limit as a project channel message (models/Message.js)
export const DM_PREVIEW_MAX = 120; // last-message preview shown in the inbox
export const DM_PAGE_DEFAULT = 50;
export const DM_PAGE_MAX = 100;
export const DM_INBOX_LIMIT = 50; // newest conversations shown in the inbox
export const DM_SEND_LIMIT = 30; // messages per user ...
export const DM_SEND_WINDOW_MS = 60_000; // ... per minute (spam guard, like NFR-16 for posts)

// Only these User fields are ever sent for the other person: never email, password or login counters.
export const DM_USER_FIELDS = 'name username avatarUrl';

export const DM_MESSAGES = {
  self: 'You cannot send a direct message to yourself.',
  usernameRequired: 'Choose who to message (a username is required).',
  conversationNotFound: 'Conversation not found.',
  invalidConversation: 'Invalid conversation ID.',
  invalidBefore: 'Invalid "before" message ID.',
  notText: 'Message must be text.',
  empty: 'Message cannot be empty.',
  tooLong: `Message must be ${DM_BODY_MAX.toLocaleString('en-US')} characters or fewer.`,
  tooFast: 'You are sending messages too quickly. Wait a moment and try again.',
  // [Sprint 7 · M2] Edit and delete your own direct messages
  invalidMessage: 'Invalid message ID.',
  messageNotFound: 'Message not found.',
  notSender: 'You can only edit or delete your own messages.',
  editDeleted: 'This message was deleted, so it can no longer be edited.',
  edited: 'Message updated.',
  unchanged: 'Nothing changed.',
  deleted: 'Message deleted.',
  alreadyDeleted: 'This message was already deleted.',
};

// [Sprint 7 · M2] What a deleted message shows instead of its text (in the conversation and the inbox).
export const DM_DELETED_TEXT = 'Message deleted';

// [Sprint 7 · M2] Delivery status of my own messages: 'sent' until the other person has opened the
// conversation after it arrived, then 'seen'.
export const DM_STATUS = Object.freeze({ sent: 'sent', seen: 'seen' });

export const idOf = (value) => String(value?._id || value || '');

// One conversation per pair of users, whoever opens it first: "a:b" with the smaller ID first.
export function pairKeyOf(userA, userB) {
  const [first, second] = [idOf(userA), idOf(userB)].sort();
  return `${first}:${second}`;
}

/*
 * NFR-21: checks a message body sent by the browser.
 * Returns { ok: true, body } with surrounding spaces removed (line breaks inside are kept),
 * or { ok: false, message } explaining what is wrong.
 */
export function readBody(raw) {
  if (raw === undefined || raw === null) return { ok: false, message: DM_MESSAGES.empty };
  if (typeof raw !== 'string') return { ok: false, message: DM_MESSAGES.notText };
  const body = raw.replace(/\r\n?/g, '\n').trim();
  if (!body) return { ok: false, message: DM_MESSAGES.empty };
  if (body.length > DM_BODY_MAX) return { ok: false, message: DM_MESSAGES.tooLong };
  return { ok: true, body };
}

// "Hello\n\n  there" -> "Hello there", cut to 120 characters with "…".
export function previewOf(body) {
  const flat = String(body || '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > DM_PREVIEW_MAX ? `${flat.slice(0, DM_PREVIEW_MAX - 1)}…` : flat;
}

export function readLimit(raw, fallback = DM_PAGE_DEFAULT, max = DM_PAGE_MAX) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

// The other person in a two-person conversation (populated user or plain ID), or null.
export function otherParticipant(conversation, meId) {
  const me = idOf(meId);
  return (conversation?.participants || []).find((person) => idOf(person) !== me) || null;
}

export function isParticipant(conversation, userId) {
  const id = idOf(userId);
  return Boolean(id) && (conversation?.participants || []).some((person) => idOf(person) === id);
}

// When this user last read the conversation. `reads` is a Map on a document and a plain object after .lean().
export function readAtFor(conversation, userId) {
  const reads = conversation?.reads;
  if (!reads) return null;
  const value = reads instanceof Map ? reads.get(idOf(userId)) : reads[idOf(userId)];
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// True when the conversation has a message newer than this user's last read (so it is worth counting).
export function mayHaveUnread(conversation, userId) {
  if (!conversation?.lastMessageAt) return false;
  const readAt = readAtFor(conversation, userId);
  return !readAt || new Date(conversation.lastMessageAt) > readAt;
}

// A person as the browser sees them. A user who no longer exists shows as "Deleted user".
export function userView(user) {
  if (!user || typeof user !== 'object' || !user.name) {
    return { _id: null, name: 'Deleted user', username: '', avatarUrl: '' };
  }
  return { _id: idOf(user), name: user.name, username: user.username || '', avatarUrl: user.avatarUrl || '' };
}

/*
 * [Sprint 7 · M2] true when the message was sent before (or at) the moment the other person last read the
 * conversation, i.e. they have seen it. `readAt` comes from conversation.reads (readAtFor), which only moves
 * forward, so once a message is seen it stays seen.
 */
export function isSeenAt(message, readAt) {
  if (!message?.createdAt || !readAt) return false;
  const sent = new Date(message.createdAt).getTime();
  const read = new Date(readAt).getTime();
  return Number.isFinite(sent) && Number.isFinite(read) && sent <= read;
}

export function isMessageSender(message, userId) {
  const sender = idOf(message?.sender);
  return Boolean(sender) && sender === idOf(userId);
}

/*
 * One message as the browser sees it:
 *   { _id, conversation, sender, body, createdAt, edited, editedAt, deleted, deletedAt, status }
 * [Sprint 7 · M2]
 * - deleted: the text is never sent again (body ''); the browser shows "Message deleted" in its place.
 * - edited / editedAt: the sender changed the text; shown as "edited". A deleted message is not "edited".
 * - status: only on the viewer's own messages: 'sent' or 'seen' (otherReadAt = when the other person last
 *   read the conversation). null on the other person's messages, and when no viewer is given.
 * Messages saved before Sprint 7 (no editedAt / deletedAt) come out as not edited and not deleted.
 */
export function messageView(message, { viewerId = null, otherReadAt = null } = {}) {
  const deleted = Boolean(message.deletedAt);
  const mine = Boolean(viewerId) && isMessageSender(message, viewerId);
  let status = null;
  if (mine) status = isSeenAt(message, otherReadAt) ? DM_STATUS.seen : DM_STATUS.sent;
  return {
    _id: idOf(message),
    conversation: idOf(message.conversation),
    sender: userView(message.sender),
    body: deleted ? '' : message.body,
    createdAt: message.createdAt,
    edited: !deleted && Boolean(message.editedAt),
    editedAt: deleted ? null : message.editedAt || null,
    deleted,
    deletedAt: message.deletedAt || null,
    status,
  };
}

// [Sprint 7 · M2] The inbox line for a message: its text, or "Message deleted".
export function messagePreview(message) {
  return message?.deletedAt ? DM_DELETED_TEXT : previewOf(message?.body);
}

// [Sprint 7 · M2] When the other person (not `meId`) last read the conversation, or null.
export function otherReadAtFor(conversation, meId) {
  const other = otherParticipant(conversation, meId);
  return other ? readAtFor(conversation, other) : null;
}

/*
 * One inbox row / conversation header, as seen by `meId`:
 *   { _id, otherUser, lastMessage: { preview, at, fromMe } | null, unreadCount, otherReadAt, activityAt, createdAt }
 * The two participants each get their own view (different otherUser and unreadCount).
 */
export function conversationView(conversation, meId, unreadCount = 0) {
  const count = Number(unreadCount);
  return {
    _id: idOf(conversation),
    otherUser: userView(otherParticipant(conversation, meId)),
    lastMessage: conversation.lastMessageAt
      ? {
          preview: conversation.lastMessagePreview || '',
          at: conversation.lastMessageAt,
          fromMe: idOf(conversation.lastMessageSender) === idOf(meId),
        }
      : null,
    unreadCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    // [Sprint 7 · M2] When the other person last read it: my messages up to this time show "Seen".
    otherReadAt: otherReadAtFor(conversation, meId),
    activityAt: conversation.activityAt || conversation.createdAt || null,
    createdAt: conversation.createdAt || null,
  };
}

/*
 * Spam guard: at most `limit` messages per user in any `windowMs` (sliding window, kept in memory).
 * take(userId) -> { ok: true } or { ok: false, retryAfterSeconds }
 * One server instance (Render free plan), so memory is enough; old entries are dropped as they expire.
 */
export function createSendLimiter({ limit = DM_SEND_LIMIT, windowMs = DM_SEND_WINDOW_MS, now = () => Date.now() } = {}) {
  const sent = new Map(); // userId -> send times (ms), oldest first

  return {
    take(userId) {
      const key = idOf(userId);
      const time = now();
      const recent = (sent.get(key) || []).filter((at) => time - at < windowMs);
      if (recent.length >= limit) {
        sent.set(key, recent);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - time) / 1000)) };
      }
      recent.push(time);
      sent.set(key, recent);
      return { ok: true };
    },
    reset() {
      sent.clear();
    },
    get size() {
      return sent.size;
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M2] What this file does
 * Small pure helpers for direct messages (US-19): one key per pair of users,
 * message checks (text, not empty, at most 4,000 characters), inbox previews,
 * the safe views sent to the browser and the per-user send limit.
 * [Sprint 7 · M2] Also: edited / deleted messages ("edited", "Message deleted")
 * and the Sent / Seen status of the viewer's own messages.
 * ---------------------------------------------------------------------------
 */
