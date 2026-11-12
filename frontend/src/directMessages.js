/*
 * [Sprint 6 · M2] Direct message helpers for the browser (US-19 Send direct messages; FR-6, NFR-1b).
 * Same limits as backend/src/lib/directMessageRules.js. The server decides what is saved; these only
 * keep the lists on screen in order when messages arrive from the API and live over Socket.IO.
 */

export const DM_MAX = 4000;
export const DM_COUNTER_FROM = 3500; // show "3,612 / 4,000" once a message gets this long

// '' for a missing value, and for a person or message object without an ID (e.g. "Deleted user").
export const idOf = (value) => {
  if (value && typeof value === 'object') return String(value._id || value.id || '');
  return String(value || '');
};

const timeOf = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
};

// Adds or replaces messages by ID and keeps them oldest first (same order as the API).
export function mergeDirectMessages(list, incoming) {
  const byId = new Map((list || []).map((message) => [idOf(message), message]));
  for (const message of incoming || []) if (idOf(message)) byId.set(idOf(message), message);
  return [...byId.values()].sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt) || idOf(a).localeCompare(idOf(b)));
}

// When the conversation last had something happen, for the inbox order (newest first).
export function activityTime(conversation) {
  return Math.max(timeOf(conversation?.lastMessage?.at), timeOf(conversation?.activityAt), timeOf(conversation?.createdAt));
}

const byActivity = (a, b) => activityTime(b) - activityTime(a) || idOf(b).localeCompare(idOf(a));

// Puts a conversation from the API or a live event into the inbox (replacing the old copy) and re-sorts.
// An older copy never replaces a newer one, so a slow answer cannot undo a live update.
export function upsertConversation(list, conversation) {
  if (!idOf(conversation)) return list;
  const current = list || [];
  const old = current.find((item) => idOf(item) === idOf(conversation));
  if (old && activityTime(old) > activityTime(conversation)) return current;
  return [conversation, ...current.filter((item) => idOf(item) !== idOf(conversation))].sort(byActivity);
}

export function setUnread(list, conversationId, unreadCount) {
  if (!list) return list;
  return list.map((item) => (idOf(item) === String(conversationId) ? { ...item, unreadCount } : item));
}

// Inbox line under the name: "You: see you then" / "see you then" / "No messages yet".
export function previewLine(conversation) {
  const last = conversation?.lastMessage;
  if (!last) return 'No messages yet';
  return last.fromMe ? `You: ${last.preview}` : last.preview;
}

export function badgeText(count) {
  if (!Number.isFinite(count) || count < 1) return '';
  return count > 99 ? '99+' : String(count);
}

export function unreadLabel(count) {
  return `${count} unread direct message${count === 1 ? '' : 's'}`;
}

// Tells the sidebar badge about a new total when this tab learns it from the REST API.
export const DM_UNREAD_EVENT = 'devorbit:dm-unread';
export function announceUnreadTotal(unreadTotal) {
  if (typeof window === 'undefined' || !Number.isFinite(unreadTotal)) return;
  window.dispatchEvent(new CustomEvent(DM_UNREAD_EVENT, { detail: { unreadTotal } }));
}
