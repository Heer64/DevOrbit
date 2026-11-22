/*
 * [Sprint 7 · M1] Edit and delete your own channel messages and thread replies.
 *
 * Small pure helpers (no database, no Express), so they are easy to unit test
 * (test/channelMessageRules.test.js). The routes are in routes/channels.js and the
 * database work is in lib/channelMessageEdits.js.
 *
 * Rules
 * - Only the author may edit or delete a message (a thread reply is a message too). Everyone else,
 *   the project Owner included, gets 403.
 * - Editing needs a role that may post (Owner, Admin, Contributor). Deleting your own message is
 *   allowed in any role, so someone who was later made a Viewer can still take back what they wrote.
 * - An edited message shows "edited". A deleted message keeps its place (and its thread) and shows
 *   "Message deleted"; its text and mentions are removed from the database.
 */

export const CHANNEL_MESSAGE_MAX = 4000; // same limit as models/Message.js MESSAGE_MAX

// What a deleted message shows instead of its text (same words as direct messages, Sprint 7 · M2).
export const CHANNEL_DELETED_TEXT = 'Message deleted';

export const CHANNEL_EDIT_MESSAGES = {
  invalidMessage: 'Invalid message ID.',
  messageNotFound: 'Message not found.',
  notAuthor: 'You can only edit or delete your own messages.',
  viewerEdit: 'Viewers cannot edit messages.',
  empty: 'Message cannot be empty. To remove it, use Delete.',
  tooLong: `Message must be ${CHANNEL_MESSAGE_MAX.toLocaleString('en-US')} characters or fewer.`,
  editDeleted: 'This message was deleted, so it can no longer be edited.',
  edited: 'Message updated.',
  unchanged: 'Nothing changed.',
  deleted: 'Message deleted.',
  alreadyDeleted: 'This message was already deleted.',
};

const idOf = (value) => (value === null || value === undefined ? '' : String(value?._id || value));

// true when `userId` wrote the message. Works for a populated author ({ _id, name }) or a raw ID.
export function isMessageAuthor(message, userId) {
  const author = idOf(message?.author);
  return Boolean(author) && Boolean(idOf(userId)) && author === idOf(userId);
}

/*
 * Checks the new text of an edit (same rules as sending: trimmed, not empty, at most 4,000 characters).
 * -> { ok: true, body } or { ok: false, message }
 */
export function readEditedBody(raw) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { ok: false, message: CHANNEL_EDIT_MESSAGES.empty };
  const body = String(raw ?? '').trim();
  if (!body) return { ok: false, message: CHANNEL_EDIT_MESSAGES.empty };
  if (body.length > CHANNEL_MESSAGE_MAX) return { ok: false, message: CHANNEL_EDIT_MESSAGES.tooLong };
  return { ok: true, body };
}

/*
 * One channel message (or thread reply) as the browser sees it. Every field the API sent before
 * Sprint 7 is kept as it was; these are added:
 *   edited, editedAt     the author changed the text ("edited"). A deleted message is never "edited".
 *   deleted, deletedAt   the author deleted it: body is '' and mentions [] (the text is never sent again),
 *                        and the browser shows "Message deleted" in its place.
 * Messages saved before Sprint 7 have neither field and come out as not edited and not deleted.
 */
export function channelMessageView(message) {
  if (!message) return message;
  const deleted = Boolean(message.deletedAt);
  return {
    ...message,
    body: deleted ? '' : message.body,
    mentions: deleted ? [] : message.mentions || [],
    edited: !deleted && Boolean(message.editedAt),
    editedAt: deleted ? null : message.editedAt || null,
    deleted,
    deletedAt: message.deletedAt || null,
  };
}

/*
 * The Activity Feed line of a channel message or thread reply. Same words as when it was posted
 * (routes/channels.js and routes/threads.js), so an edit only swaps the quoted text, and a delete
 * replaces it, so the deleted text cannot still be read in the feed or in Catch Me Up.
 *   quotedText: the new text already quoted with lib/activity.js quote(), or null when deleted.
 */
export function messageActivitySummary({ channelName, isReply = false, quotedText = null }) {
  const where = isReply ? `replied in a thread in #${channelName}` : `posted in #${channelName}`;
  return `${where}: ${quotedText ?? `(${CHANNEL_DELETED_TEXT.toLowerCase()})`}`;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M1] What this file does
 * Pure rules for editing and deleting your own channel messages and thread
 * replies: who may do it, the text checks, how an edited / deleted message is
 * shown ("edited", "Message deleted") and the matching Activity Feed line.
 * ---------------------------------------------------------------------------
 */
