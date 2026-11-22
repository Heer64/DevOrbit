// [Sprint 7 · M1] Browser helpers for editing / deleting channel messages.
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_DELETED_TEXT,
  canDeleteMessage,
  canEditMessage,
  checkEdit,
  isOwnMessage,
  mergeChannelMessages,
  newerMessageCopy,
  replaceChannelMessage,
} from './channelMessages';

const at = (minute) => new Date(Date.UTC(2026, 10, 22, 10, minute)).toISOString();
const msg = (id, body, minute, extra = {}) => ({ _id: id, body, createdAt: at(minute), author: { _id: 'me', name: 'Me' }, ...extra });

describe('who may edit or delete', () => {
  it('only the author, and Edit only with a role that can post', () => {
    const mine = msg('m1', 'Hi', 1);
    const theirs = msg('m2', 'Hi', 1, { author: { _id: 'u2' } });
    expect(isOwnMessage(mine, 'me')).toBe(true);
    expect(isOwnMessage(theirs, 'me')).toBe(false);
    expect(isOwnMessage(mine, '')).toBe(false);
    expect(isOwnMessage({ ...mine, author: null }, 'me')).toBe(false);
    expect(canEditMessage(mine, 'me', true)).toBe(true);
    expect(canEditMessage(mine, 'me', false)).toBe(false); // Viewer
    expect(canDeleteMessage(mine, 'me')).toBe(true);
    expect(canEditMessage(theirs, 'me', true)).toBe(false);
    expect(canDeleteMessage(theirs, 'me')).toBe(false);
  });

  it('nothing can be done to a deleted message', () => {
    const gone = msg('m1', '', 1, { deleted: true });
    expect(canEditMessage(gone, 'me', true)).toBe(false);
    expect(canDeleteMessage(gone, 'me')).toBe(false);
  });
});

describe('checkEdit', () => {
  it('trims, refuses empty or too long text, and spots "nothing changed"', () => {
    expect(checkEdit(msg('m1', 'Old', 1), '  New  ')).toEqual({ ok: true, body: 'New' });
    expect(checkEdit(msg('m1', 'Old', 1), '   ').ok).toBe(false);
    expect(checkEdit(msg('m1', 'Old', 1), 'x'.repeat(4001)).ok).toBe(false);
    expect(checkEdit(msg('m1', 'Old', 1), ' Old ')).toEqual({ ok: true, unchanged: true, body: 'Old' });
  });
});

describe('merging copies of a message', () => {
  it('a deleted copy is never replaced by an older live copy', () => {
    const deleted = msg('m1', '', 1, { deleted: true });
    expect(newerMessageCopy(deleted, msg('m1', 'Back?', 1)).deleted).toBe(true);
    expect(newerMessageCopy(msg('m1', 'Hi', 1), deleted).deleted).toBe(true);
  });

  it('the later edit wins', () => {
    const early = msg('m1', 'First edit', 1, { edited: true, editedAt: at(5) });
    const late = msg('m1', 'Second edit', 1, { edited: true, editedAt: at(6) });
    expect(newerMessageCopy(late, early).body).toBe('Second edit');
    expect(newerMessageCopy(early, late).body).toBe('Second edit');
  });

  it('keeps the higher reply count', () => {
    const counted = msg('m1', 'Hi', 1, { replyCount: 3, lastReplyAt: at(9) });
    const edited = msg('m1', 'Hi!', 1, { replyCount: 2, edited: true, editedAt: at(7) });
    const kept = newerMessageCopy(counted, edited);
    expect(kept.body).toBe('Hi!');
    expect(kept.replyCount).toBe(3);
    expect(kept.lastReplyAt).toBe(at(9));
  });

  it('mergeChannelMessages adds once and keeps the oldest first', () => {
    const merged = mergeChannelMessages([msg('b', 'two', 2)], [msg('a', 'one', 1), msg('b', 'two (edited)', 2, { editedAt: at(3) })]);
    expect(merged.map((m) => m._id)).toEqual(['a', 'b']);
    expect(merged[1].body).toBe('two (edited)');
  });

  it('replaceChannelMessage only updates a message that is already shown', () => {
    const list = [msg('a', 'one', 1)];
    expect(replaceChannelMessage(list, msg('zzz', 'not loaded', 0))).toBe(list);
    expect(replaceChannelMessage(list, msg('a', '', 1, { deleted: true }))[0].deleted).toBe(true);
    expect(replaceChannelMessage(null, msg('a', 'x', 1))).toBeNull();
  });

  it('uses the same deleted text as the server', () => {
    expect(CHANNEL_DELETED_TEXT).toBe('Message deleted');
  });
});
