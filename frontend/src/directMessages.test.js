// [Sprint 6 · M2] US-19 direct message helpers (no React, no network).
import { describe, expect, it, vi } from 'vitest';
import {
  DM_UNREAD_EVENT,
  activityTime,
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
