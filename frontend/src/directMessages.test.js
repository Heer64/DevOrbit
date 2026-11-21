// [Sprint 6 · M2] US-19 direct message helpers (no React, no network).
import { describe, expect, it, vi } from 'vitest';
import {
  DM_DELETED_TEXT,
  DM_UNREAD_EVENT,
  activityTime,
  deliveryLabel,
  laterTime,
  announceUnreadTotal,
  badgeText,
  idOf,
  mergeDirectMessages,
  previewLine,
  setUnread,
  unreadLabel,
  upsertConversation,
} from './directMessages';

const msg = (id, at, body = id) => ({ _id: id, body, createdAt: at, sender: { _id: 'u1' } });
const conv = (id, at, extra = {}) => ({
  _id: id,
  otherUser: { name: id },
  lastMessage: { preview: 'x', at, fromMe: false },
  unreadCount: 0,
  ...extra,
});

describe('idOf', () => {
  it('reads _id or id, and never turns an object into "[object Object]"', () => {
    expect(idOf({ _id: 'a' })).toBe('a');
    expect(idOf({ id: 'b' })).toBe('b');
    expect(idOf('c')).toBe('c');
    expect(idOf({ _id: null, name: 'Deleted user' })).toBe('');
    expect(idOf(null)).toBe('');
  });
});

describe('mergeDirectMessages', () => {
  it('adds new messages, replaces repeats and keeps oldest first', () => {
    const list = [msg('m2', '2026-11-11T10:02:00Z'), msg('m1', '2026-11-11T10:01:00Z')];
    const merged = mergeDirectMessages(list, [msg('m3', '2026-11-11T10:03:00Z'), msg('m1', '2026-11-11T10:01:00Z', 'edited copy')]);
    expect(merged.map((m) => m._id)).toEqual(['m1', 'm2', 'm3']);
    expect(merged[0].body).toBe('edited copy');
    expect(merged).toHaveLength(3);
  });

  it('a live message that is also in the API answer shows once', () => {
    const live = msg('m9', '2026-11-11T10:09:00Z');
    expect(mergeDirectMessages([live], [live])).toHaveLength(1);
    expect(mergeDirectMessages(null, [live])).toEqual([live]);
  });
});

describe('upsertConversation', () => {
  it('puts the newest activity first and replaces the old copy', () => {
    const list = [conv('a', '2026-11-11T10:00:00Z'), conv('b', '2026-11-11T09:00:00Z')];
    const next = upsertConversation(list, conv('b', '2026-11-11T11:00:00Z', { unreadCount: 2 }));
    expect(next.map((c) => c._id)).toEqual(['b', 'a']);
    expect(next[0].unreadCount).toBe(2);
    expect(next).toHaveLength(2);
  });

  it('adds a conversation that was not in the list yet', () => {
    expect(upsertConversation([], conv('new', '2026-11-11T10:00:00Z')).map((c) => c._id)).toEqual(['new']);
    expect(upsertConversation(null, conv('new', '2026-11-11T10:00:00Z'))).toHaveLength(1);
  });

  it('an older copy (a slow answer) never replaces a newer live one', () => {
    const list = [conv('a', '2026-11-11T10:05:00Z', { lastMessage: { preview: 'newer', at: '2026-11-11T10:05:00Z' } })];
    const next = upsertConversation(
      list,
      conv('a', '2026-11-11T10:00:00Z', { lastMessage: { preview: 'older', at: '2026-11-11T10:00:00Z' } })
    );
    expect(next[0].lastMessage.preview).toBe('newer');
  });

  it('a conversation without messages is ordered by when it was opened', () => {
    const empty = { _id: 'e', lastMessage: null, activityAt: '2026-11-11T12:00:00Z' };
    expect(activityTime(empty)).toBe(new Date('2026-11-11T12:00:00Z').getTime());
    expect(upsertConversation([conv('a', '2026-11-11T10:00:00Z')], empty).map((c) => c._id)).toEqual(['e', 'a']);
  });
});

describe('small helpers', () => {
  it('setUnread changes only that conversation', () => {
    const next = setUnread([conv('a', 1, { unreadCount: 3 }), conv('b', 2, { unreadCount: 1 })], 'a', 0);
    expect(next.map((c) => c.unreadCount)).toEqual([0, 1]);
    expect(setUnread(null, 'a', 0)).toBeNull();
  });

  it('previewLine says "You:" for my own last message', () => {
    expect(previewLine({ lastMessage: { preview: 'See you', fromMe: true } })).toBe('You: See you');
    expect(previewLine({ lastMessage: { preview: 'See you', fromMe: false } })).toBe('See you');
    expect(previewLine({ lastMessage: null })).toBe('No messages yet');
  });

  it('badgeText and unreadLabel', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(3)).toBe('3');
    expect(badgeText(250)).toBe('99+');
    expect(badgeText(NaN)).toBe('');
    expect(unreadLabel(1)).toBe('1 unread direct message');
    expect(unreadLabel(4)).toBe('4 unread direct messages');
  });

  it('announceUnreadTotal tells the sidebar badge in this tab', () => {
    const handler = vi.fn();
    window.addEventListener(DM_UNREAD_EVENT, handler);
    announceUnreadTotal(5);
    announceUnreadTotal(undefined); // ignored
    window.removeEventListener(DM_UNREAD_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ unreadTotal: 5 });
  });
});

// [Sprint 7 · M2] Edit / delete my own messages, and Sent / Seen.
describe('[Sprint 7 · M2] deliveryLabel (Sent / Seen under my own messages)', () => {
  const mine = { _id: 'm1', sender: { _id: 'me' }, createdAt: '2026-11-20T10:00:00.000Z', body: 'hi' };
  it('is "Sent" until the other person has read at or after the message time, then "Seen"', () => {
    expect(deliveryLabel(mine, 'me', null)).toBe('Sent');
    expect(deliveryLabel(mine, 'me', '2026-11-20T09:59:59.999Z')).toBe('Sent');
    expect(deliveryLabel(mine, 'me', '2026-11-20T10:00:00.000Z')).toBe('Seen');
    expect(deliveryLabel(mine, 'me', '2026-11-20T11:00:00.000Z')).toBe('Seen');
  });
  it('trusts a "seen" status from the server', () => {
    expect(deliveryLabel({ ...mine, status: 'seen' }, 'me', null)).toBe('Seen');
  });
  it("shows nothing on the other person's messages, on deleted ones, or without a signed-in user", () => {
    expect(deliveryLabel({ ...mine, sender: { _id: 'them' } }, 'me', '2026-11-21T00:00:00Z')).toBe('');
    expect(deliveryLabel({ ...mine, deleted: true }, 'me', '2026-11-21T00:00:00Z')).toBe('');
    expect(deliveryLabel(mine, '', null)).toBe('');
    expect(deliveryLabel(null, 'me', null)).toBe('');
  });
});

describe('[Sprint 7 · M2] laterTime (read times only move forward)', () => {
  it('keeps the later of two times, and ignores a missing one', () => {
    expect(laterTime(null, '2026-11-20T10:00:00Z')).toBe('2026-11-20T10:00:00Z');
    expect(laterTime('2026-11-20T10:00:00Z', null)).toBe('2026-11-20T10:00:00Z');
    expect(laterTime('2026-11-20T10:00:00Z', '2026-11-20T09:00:00Z')).toBe('2026-11-20T10:00:00Z');
    expect(laterTime('2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z')).toBe('2026-11-20T10:00:00Z');
    expect(laterTime(null, null)).toBe(null);
  });
});

describe('[Sprint 7 · M2] mergeDirectMessages with edited and deleted copies', () => {
  const base = { _id: 'm1', sender: { _id: 'me' }, createdAt: '2026-11-20T10:00:00Z', body: 'v1', edited: false, deleted: false };
  it('an edited copy replaces the old one in place', () => {
    const list = mergeDirectMessages([base], [{ ...base, body: 'v2', edited: true, editedAt: '2026-11-20T10:05:00Z' }]);
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('v2');
    expect(list[0].edited).toBe(true);
  });
  it('a deleted message never comes back, even if an older copy arrives later (slow page answer)', () => {
    const deleted = { ...base, body: '', deleted: true, deletedAt: '2026-11-20T10:06:00Z' };
    expect(mergeDirectMessages([deleted], [base])[0].deleted).toBe(true);
    expect(mergeDirectMessages([base], [deleted])[0].deleted).toBe(true);
  });
  it('an older edit does not overwrite a newer one', () => {
    const newer = { ...base, body: 'v3', edited: true, editedAt: '2026-11-20T10:09:00Z' };
    const older = { ...base, body: 'v2', edited: true, editedAt: '2026-11-20T10:05:00Z' };
    expect(mergeDirectMessages([newer], [older])[0].body).toBe('v3');
  });
  it('a known "seen" status is kept when a copy without it arrives', () => {
    const list = mergeDirectMessages(
      [{ ...base, status: 'seen' }],
      [{ ...base, body: 'v2', edited: true, editedAt: '2026-11-20T10:05:00Z', status: null }]
    );
    expect(list[0].body).toBe('v2');
    expect(list[0].status).toBe('seen');
  });
  it('DM_DELETED_TEXT matches the server text', () => {
    expect(DM_DELETED_TEXT).toBe('Message deleted');
  });
});
