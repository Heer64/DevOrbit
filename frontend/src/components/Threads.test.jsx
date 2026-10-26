// [Sprint 3] US-17: thread replies with reply count in the Chat tab.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ChatPanel, { applyReplyCount } from './ChatPanel';
import { mergeReplies, replyCountLabel } from './ThreadPanel';

const general = { _id: 'c1', name: 'general', isDefault: true };
const at = (minute) => new Date(Date.UTC(2026, 9, 20, 10, minute)).toISOString();
const riya = { _id: 'u1', name: 'Riya Kapoor' };
const msg = (id, body, minute, extra = {}) => ({ _id: id, body, createdAt: at(minute), author: riya, channel: 'c1', project: 'p1', replyCount: 0, ...extra });

const room = () => screen.getByRole('region', { name: '#general' });

function fakeApi({ messages = [msg('m1', 'Vite or Next?', 1, { replyCount: 2, lastReplyAt: at(3) }), msg('m2', 'Lunch?', 2)] } = {}) {
  const liveReplies = new Set();
  let replies = [msg('r1', 'Vite', 2, { parentMessage: 'm1' }), msg('r2', 'Agreed', 3, { parentMessage: 'm1' })];
  return {
    list: vi.fn(() => Promise.resolve({ channels: [general] })),
    messages: vi.fn(() => Promise.resolve({ messages, nextBefore: null })),
    send: vi.fn(),
    create: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    replies: vi.fn((projectId, channelId, messageId) => Promise.resolve({
      parent: messages.find((m) => m._id === messageId),
      replies: messageId === 'm1' ? replies : [],
      nextAfter: null,
    })),
    reply: vi.fn((projectId, channelId, messageId, body) => {
      const reply = msg('r-new', body, 9, { parentMessage: messageId, author: { _id: 'me', name: 'Me' } });
      replies = [...replies, reply];
      const count = messageId === 'm1' ? replies.length : 1;
      return Promise.resolve({ reply, parent: { _id: messageId, replyCount: count, lastReplyAt: at(9) } });
    }),
    onReply: vi.fn((projectId, handler) => { liveReplies.add(handler); return () => liveReplies.delete(handler); }),
    pushReply: (payload) => liveReplies.forEach((handler) => handler(payload)),
  };
}

describe('thread helpers', () => {
  it('labels counts', () => {
    expect(replyCountLabel(1)).toBe('1 reply');
    expect(replyCountLabel(3)).toBe('3 replies');
  });

  it('applyReplyCount only moves a count up', () => {
    const list = [msg('a', 'x', 1, { replyCount: 3 })];
    expect(applyReplyCount(list, { _id: 'a', replyCount: 4 })[0].replyCount).toBe(4);
    expect(applyReplyCount(list, { _id: 'a', replyCount: 2 })[0].replyCount).toBe(3);
    expect(applyReplyCount(list, { _id: 'other', replyCount: 9 })[0].replyCount).toBe(3);
  });

  it('mergeReplies adds once, oldest first', () => {
    const merged = mergeReplies([msg('b', 'two', 2)], [msg('a', 'one', 1), msg('b', 'two', 2)]);
    expect(merged.map((r) => r._id)).toEqual(['a', 'b']);
  });
});

describe('ChatPanel threads (US-17)', () => {
  it('shows the reply count on a message that has replies', async () => {
    render(<ChatPanel projectId="p1" myRole="Contributor" api={fakeApi()} />);
    expect(await screen.findByText('2 replies')).toBeTruthy();
  });

  it('opens the thread, shows its replies and updates the count after replying', async () => {
    const api = fakeApi();
    render(<ChatPanel projectId="p1" myRole="Contributor" api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '2 replies, open thread' }));

    const thread = await screen.findByRole('complementary', { name: 'Thread' });
    expect(await within(thread).findByText('Agreed')).toBeTruthy();
    expect(api.replies).toHaveBeenCalledWith('p1', 'c1', 'm1');

    const box = within(thread).getByLabelText('Reply');
    fireEvent.change(box, { target: { value: 'Ship it' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await within(thread).findByText('Ship it')).toBeTruthy();
    expect(api.reply).toHaveBeenCalledWith('p1', 'c1', 'm1', 'Ship it');
    expect(await within(room()).findByText('3 replies')).toBeTruthy();
  });

  it('a first reply turns "Reply" into "1 reply"', async () => {
    const api = fakeApi();
    render(<ChatPanel projectId="p1" myRole="Owner" api={api} />);
    await screen.findByText('Lunch?');
    const replyButtons = screen.getAllByRole('button', { name: 'Reply in thread' });
    expect(replyButtons).toHaveLength(1);
    fireEvent.click(replyButtons[0]);
    const thread = await screen.findByRole('complementary', { name: 'Thread' });
    await within(thread).findByText(/No replies yet/);
    fireEvent.change(within(thread).getByLabelText('Reply'), { target: { value: 'Pizza' } });
    fireEvent.click(within(thread).getByLabelText('Send reply'));
    expect(await within(room()).findByText('1 reply')).toBeTruthy();
  });

  it('live replies update the count in the channel and appear in the open thread once', async () => {
    const api = fakeApi();
    render(<ChatPanel projectId="p1" myRole="Contributor" api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '2 replies, open thread' }));
    const thread = await screen.findByRole('complementary', { name: 'Thread' });
    await within(thread).findByText('Agreed');

    const reply = msg('r9', 'From a teammate', 8, { parentMessage: 'm1' });
    act(() => api.pushReply({ projectId: 'p1', channelId: 'c1', parentId: 'm1', reply, replyCount: 3, lastReplyAt: at(8) }));
    act(() => api.pushReply({ projectId: 'p1', channelId: 'c1', parentId: 'm1', reply, replyCount: 3, lastReplyAt: at(8) }));

    expect(within(thread).getAllByText('From a teammate')).toHaveLength(1);
    expect(within(room()).getByText('3 replies')).toBeTruthy();
  });

  it('Viewers can open a thread with replies but cannot reply', async () => {
    render(<ChatPanel projectId="p1" myRole="Viewer" api={fakeApi()} />);
    fireEvent.click(await screen.findByRole('button', { name: '2 replies, open thread' }));
    const thread = await screen.findByRole('complementary', { name: 'Thread' });
    await within(thread).findByText('Agreed');
    expect(within(thread).queryByLabelText('Reply')).toBeNull();
    expect(within(thread).getByText(/can read threads but not reply/)).toBeTruthy();
    // No "Reply" button on messages without replies for Viewers.
    expect(screen.queryByRole('button', { name: 'Reply in thread' })).toBeNull();
  });

  it('closing the thread hides it', async () => {
    render(<ChatPanel projectId="p1" myRole="Owner" api={fakeApi()} />);
    fireEvent.click(await screen.findByRole('button', { name: '2 replies, open thread' }));
    await screen.findByRole('complementary', { name: 'Thread' });
    fireEvent.click(screen.getByLabelText('Close thread'));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Thread' })).toBeNull());
  });

  it('an api without threads shows no reply buttons (older fakes keep working)', async () => {
    const { replies, reply, onReply, ...plain } = fakeApi(); // eslint-disable-line no-unused-vars
    render(<ChatPanel projectId="p1" myRole="Owner" api={plain} />);
    await screen.findByText('Lunch?');
    expect(screen.queryByRole('button', { name: /Reply in thread|open thread/ })).toBeNull();
  });
});
