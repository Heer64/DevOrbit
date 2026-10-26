// [Sprint 3] US-18: @mentions in channel messages and thread replies.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ChatPanel from './ChatPanel';

const members = [
  { userId: 'me', name: 'Id Three', username: 'id35113' },
  { userId: 'u2', name: 'sahil', username: 'sahilb68c' },
];
const at = (minute) => new Date(Date.UTC(2026, 9, 26, 10, minute)).toISOString();
const sahil = { _id: 'u2', name: 'sahil', username: 'sahilb68c' };

function fakeApi(messages = [{ _id: 'm1', body: '@sahilb68c hello', createdAt: at(1), author: { _id: 'me', name: 'Id Three' }, mentions: [sahil], replyCount: 0 }]) {
  return {
    list: vi.fn(() => Promise.resolve({ channels: [{ _id: 'c1', name: 'general', isDefault: true }] })),
    messages: vi.fn(() => Promise.resolve({ messages, nextBefore: null })),
    send: vi.fn((projectId, channelId, body) => Promise.resolve({ message: { _id: 'm-new', body, createdAt: at(5), author: { _id: 'me', name: 'Id Three' }, mentions: body.includes('@sahilb68c') ? [sahil] : [] } })),
    create: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    replies: vi.fn((projectId, channelId, id) => Promise.resolve({ parent: messages.find((m) => m._id === id) || { _id: id, body: 'Older message', createdAt: at(0), author: sahil }, replies: [], nextAfter: null })),
    reply: vi.fn((projectId, channelId, id, body) => Promise.resolve({ reply: { _id: 'r1', body, createdAt: at(6), author: { _id: 'me', name: 'Id Three' }, mentions: [sahil] }, parent: { _id: id, replyCount: 1 } })),
    onReply: vi.fn(() => () => {}),
  };
}

describe('Chat @mentions (US-18)', () => {
  it('highlights mentions in sent messages', async () => {
    render(<ChatPanel projectId="p1" myRole="Owner" api={fakeApi()} members={members} currentUserId="me" />);
    const mention = await screen.findByText('@sahilb68c');
    expect(mention.className).toContain('mention');
  });

  it('typing @ in the message box suggests project members (not yourself) and Enter picks one', async () => {
    const api = fakeApi([]);
    render(<ChatPanel projectId="p1" myRole="Owner" api={api} members={members} currentUserId="me" />);
    const box = await screen.findByLabelText('Message');
    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } });
    const list = await screen.findByRole('listbox', { name: 'Mention a project member' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Ssahil@sahilb68c']);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('@sahilb68c ');
    expect(api.send).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: '@sahilb68c standup?', selectionStart: 19 } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(api.send).toHaveBeenCalledWith('p1', 'c1', '@sahilb68c standup?');
  });

  it('the thread reply box suggests members too', async () => {
    render(<ChatPanel projectId="p1" myRole="Owner" api={fakeApi()} members={members} currentUserId="me" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reply in thread' }));
    const thread = await screen.findByRole('complementary', { name: 'Thread' });
    const box = within(thread).getByLabelText('Reply');
    fireEvent.change(box, { target: { value: '@sa', selectionStart: 3 } });
    expect(await within(thread).findByRole('listbox')).toBeTruthy();
  });

  it('a link with ?thread= opens that thread, even for a message not on the first page', async () => {
    const api = fakeApi();
    render(<ChatPanel projectId="p1" myRole="Owner" api={api} members={members} currentUserId="me" threadId="old1" />);
    const thread = await screen.findByRole('complementary', { name: 'Thread' });
    expect(await within(thread).findByText('Older message')).toBeTruthy();
    expect(api.replies).toHaveBeenCalledWith('p1', 'c1', 'old1');
  });
});
