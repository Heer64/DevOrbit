/*
 * [Sprint 7 · M1] Edit and delete your own channel messages and thread replies: browser-side helpers.
 * Server rules: backend/src/lib/channelMessageRules.js. Used by components/ChatPanel.jsx and
 * components/ThreadPanel.jsx (tested in channelMessages.test.js).
 */

// What a deleted message shows (same words as the server and as deleted direct messages).
export const CHANNEL_DELETED_TEXT = 'Message deleted';
export const CHANNEL_MESSAGE_MAX = 4000;

export const idOf = (value) => String(value?._id || value?.id || value || '');

const timeOf = (value) => {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
};

/*
 * Which of two copies of the same message to keep. A deleted copy always wins (a message never comes
 * back after being deleted), then the later edit, so a slow page answer cannot undo a live edit or delete
 * that arrived first. The reply count only ever goes up, like applyReplyCount in ChatPanel.
 */
export function newerMessageCopy(old, incoming) {
  if (!old) return incoming;
  if (!incoming) return old;
  let kept = incoming;
  if (old.deleted && !incoming.deleted) kept = old;
  else if (!incoming.deleted && !old.deleted && timeOf(old.editedAt) > timeOf(incoming.editedAt)) kept = old;
  const replyCount = Math.max(old.replyCount || 0, incoming.replyCount || 0);
  const lastReplyAt = timeOf(old.lastReplyAt) > timeOf(incoming.lastReplyAt) ? old.lastReplyAt : incoming.lastReplyAt;
  if (replyCount === (kept.replyCount || 0) && lastReplyAt === kept.lastReplyAt) return kept;
  return { ...kept, replyCount, ...(lastReplyAt !== undefined ? { lastReplyAt } : {}) };
}

// Adds or replaces messages by ID and keeps them oldest first (same order as the API).
export function mergeChannelMessages(list, incoming) {
  const byId = new Map((list || []).map((message) => [idOf(message), message]));
  for (const message of incoming || []) {
    if (message && idOf(message)) byId.set(idOf(message), newerMessageCopy(byId.get(idOf(message)), message));
  }
  return [...byId.values()].sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt) || idOf(a).localeCompare(idOf(b)));
}

/*
 * Updates a message only if it is already in the list. Used for live edits / deletes: a change to a
 * message on an older page that is not loaded must not be pushed into the middle of the list.
 */
export function replaceChannelMessage(list, message) {
  if (!list || !message) return list;
  const id = idOf(message);
  if (!list.some((item) => idOf(item) === id)) return list;
  return list.map((item) => (idOf(item) === id ? newerMessageCopy(item, message) : item));
}

// true when the signed-in user wrote this message.
export function isOwnMessage(message, meId) {
  return Boolean(meId) && Boolean(idOf(message?.author)) && idOf(message.author) === String(meId);
}

// Edit: my own message, not deleted, and my role may post (Owner, Admin, Contributor).
export function canEditMessage(message, meId, canPost) {
  return Boolean(canPost) && isOwnMessage(message, meId) && !message.deleted;
}

// Delete: my own message, not deleted yet. Any role (a Viewer can take back what they wrote earlier).
export function canDeleteMessage(message, meId) {
  return isOwnMessage(message, meId) && !message.deleted;
}

/*
 * Checks the new text before saving an edit (the server checks again).
 * -> { ok: true, body } | { ok: false, message } | { ok: true, unchanged: true } when nothing changed
 */
export function checkEdit(original, draft) {
  const body = String(draft ?? '').trim();
  if (!body) return { ok: false, message: 'Message cannot be empty. To remove it, use Delete.' };
  if (body.length > CHANNEL_MESSAGE_MAX) {
    return { ok: false, message: `Message must be ${CHANNEL_MESSAGE_MAX.toLocaleString('en-US')} characters or fewer.` };
  }
  if (body === String(original?.body ?? '')) return { ok: true, unchanged: true, body };
  return { ok: true, body };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M1] What this file does
 * Helpers for editing / deleting channel messages in the browser: who sees
 * Edit and Delete, the text check before saving, and merging copies of a
 * message so a deleted or newer edited copy is never replaced by an older one.
 * ---------------------------------------------------------------------------
 */
