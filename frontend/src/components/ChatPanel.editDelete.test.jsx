// [Sprint 7 · M1] Edit and delete your own channel messages and thread replies in the Chat tab.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ChatPanel from './ChatPanel';

const general = { _id: 'c1', name: 'general', isDefault: true };
const at = (minute) => new Date(Date.UTC(2026, 10, 22, 10, minute)).toISOString();
const me = { _id: 'me', name: 'Sahil Abbas' };
const riya = { _id: 'u1', name: 'Riya Kapoor' };
const msg = (id, body, minute, author = me, extra = {}) => ({
  _id: id, body, createdAt: at(minute), author, channel: 'c1', project: 'p1', replyCount: 0, mentions: [], edited: false, deleted: false, ...extra,
});

const room = () => screen.getByRole('region', { name: '#general' });
const article = (text) => within(room()).getByText(text).closest('article');

function fakeApi({
  messages = [msg('m1', 'Standup at 10', 1), msg('m2', 'Lunch at 1?', 2, riya)],
  replies = [msg('r1', 'Count me in', 3, me, { parentMessage: 'm3' })],
  editError = null,
} = {}) {
  const live = new Set();
  const all = [...messages, msg('m3', 'Pizza or tacos?', 0, riya, { replyCount: replies.length, lastReplyAt: at(3) })];
  return {
    list: vi.fn(() => Promise.resolve({ channels: [general] })),
    messages: vi.fn(() => Promise.resolve({ messages: all, nextBefore: null })),
    send: vi.fn(),
    create: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    replies: vi.fn((projectId, channelId, messageId) => Promise.resolve({
      parent: all.find((m) => m._id === messageId),
      replies: messageId === 'm3' ? replies : [],
      nextAfter: null,
    })),
    reply: vi.fn(),
    onReply: vi.fn(() => () => {}),
    edit: vi.fn((projectId, channelId, messageId, body) => {
      if (editError) return Promise.reject(editError);
      const old = [...all, ...replies].find((m) => m._id === messageId);
      return Promise.resolve({ message: { ...old, body, edited: true, editedAt: at(30) }, changed: true, notice: 'Message updated.' });
    }),
    remove: vi.fn((projectId, channelId, messageId) => {
      const old = [...all, ...replies].find((m) => m._id === messageId);
      return Promise.resolve({ message: { ...old, body: '', mentions: [], edited: false, deleted: true, deletedAt: at(31) }, changed: true });
    }),
    onUpdated: vi.fn((projectId, handler) => { live.add(handler); return () => live.delete(handler); }),
    pushUpdate: (payload) => live.forEach((handler) => handler(payload)),
  };
}

const renderChat = (api, props = {}) => render(<ChatPanel projectId="p1" myRole="Contributor" currentUserId="me" api={api} {...props} />);

describe('ChatPanel edit / delete (Sprint 7 · M1)', () => {
  it('shows Edit and Delete only on my own messages', async () => {
    renderChat(fakeApi());
    await screen.findByText('Standup at 10');
    expect(within(article('Standup at 10')).getByRole('button', { name: 'Edit message' })).toBeTruthy();
    expect(within(article('Standup at 10')).getByRole('button', { name: 'Delete message' })).toBeTruthy();
    expect(within(article('Lunch at 1?')).queryByRole('button', { name: 'Edit message' })).toBeNull();
    expect(within(article('Lunch at 1?')).queryByRole('button', { name: 'Delete message' })).toBeNull();
  });

  it('edits a message in place: Enter saves, and it shows "(edited)"', async () => {
    const api = fakeApi();
    renderChat(api);
    await screen.findByText('Standup at 10');
    fireEvent.click(within(article('Standup at 10')).getByRole('button', { name: 'Edit message' }));

    const box = screen.getByLabelText('Edit your message');
    expect(box.value).toBe('Standup at 10');
    fireEvent.change(box, { target: { value: 'Standup at 11' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await within(room()).findByText('Standup at 11')).toBeTruthy();
    expect(api.edit).toHaveBeenCalledWith('p1', 'c1', 'm1', 'Standup at 11');
    expect(within(article('Standup at 11')).getByText('(edited)')).toBeTruthy();
    expect(screen.queryByLabelText('Edit your message')).toBeNull();
  });

  it('Escape cancels an edit and saving the same text calls nothing', async () => {
    const api = fakeApi();
    renderChat(api);
    await screen.findByText('Standup at 10');
    fireEvent.click(within(article('Standup at 10')).getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: 'Something else' } });
    fireEvent.keyDown(screen.getByLabelText('Edit your message'), { key: 'Escape' });
    expect(screen.queryByLabelText('Edit your message')).toBeNull();
    expect(within(room()).getByText('Standup at 10')).toBeTruthy();

    fireEvent.click(within(article('Standup at 10')).getByRole('button', { name: 'Edit message' }));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByLabelText('Edit your message')).toBeNull());
    expect(api.edit).not.toHaveBeenCalled();
    expect(within(room()).queryByText('(edited)')).toBeNull();
  });

  it('an empty edit is refused before calling the server', async () => {
    const api = fakeApi();
    renderChat(api);
    await screen.findByText('Standup at 10');
    fireEvent.click(within(article('Standup at 10')).getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByLabelText('Edit your message'), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot be empty/);
    expect(api.edit).not.toHaveBeenCalled();
  });

  it('shows the server error when an edit is refused', async () => {
    const error = Object.assign(new Error('You can only edit or delete your own messages.'), { status: 403 });
    renderChat(fakeApi({ editError: error }));
    await screen.findByText('Standup at 10');
    fireEvent.click(within(article('Standup at 10')).getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: 'Changed' } });
    fireEvent.keyDown(screen.getByLabelText('Edit your message'), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/only edit or delete your own/);
    expect(screen.getByLabelText('Edit your message')).toBeTruthy();
  });

  it('deletes after confirming: the message stays in place as "Message deleted"', async () => {
    const api = fakeApi();
    renderChat(api);
    await screen.findByText('Standup at 10');
    fireEvent.click(within(article('Standup at 10')).getByRole('button', { name: 'Delete message' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this message?' });
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete message' }));

    expect(await within(room()).findByText('Message deleted')).toBeTruthy();
    expect(api.remove).toHaveBeenCalledWith('p1', 'c1', 'm1');
    expect(within(room()).queryByText('Standup at 10')).toBeNull();
    expect(within(article('Message deleted')).queryByRole('button', { name: /Edit message|Delete message/ })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it("cancelling the confirmation keeps the message", async () => {
    const api = fakeApi();
    renderChat(api);
    await screen.findByText('Standup at 10');
    fireEvent.click(within(article('Standup at 10')).getByRole('button', { name: 'Delete message' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.remove).not.toHaveBeenCalled();
    expect(within(room()).getByText('Standup at 10')).toBeTruthy();
  });

  it("teammates' edits and deletes appear live", async () => {
    const api = fakeApi();
    renderChat(api);
    await screen.findByText('Lunch at 1?');
    act(() => api.pushUpdate({ projectId: 'p1', channelId: 'c1', parentId: null, message: msg('m2', 'Lunch at 2?', 2, riya, { edited: true, editedAt: at(20) }) }));
    expect(within(room()).getByText('Lunch at 2?')).toBeTruthy();
    expect(within(article('Lunch at 2?')).getByText('(edited)')).toBeTruthy();

    act(() => api.pushUpdate({ projectId: 'p1', channelId: 'c1', parentId: null, message: msg('m2', '', 2, riya, { deleted: true }) }));
    expect(within(room()).queryByText('Lunch at 2?')).toBeNull();
    expect(within(room()).getByText('Message deleted')).toBeTruthy();

    // An older copy arriving late cannot bring the text back.
    act(() => api.pushUpdate({ projectId: 'p1', channelId: 'c1', parentId: null, message: msg('m2', 'Lunch at 2?', 2, riya, { edited: true, editedAt: at(20) }) }));
    expect(within(room()).queryByText('Lunch at 2?')).toBeNull();
  });

  it('a deleted message keeps its thread link, but no new thread can start on it', async () => {
    const api = fakeApi();
    renderChat(api);
    await screen.findByText('Pizza or tacos?');
    act(() => api.pushUpdate({ projectId: 'p1', channelId: 'c1', parentId: null, message: msg('m3', '', 0, riya, { deleted: true, replyCount: 1 }) }));
    act(() => api.pushUpdate({ projectId: 'p1', channelId: 'c1', parentId: null, message: msg('m2', '', 2, riya, { deleted: true }) }));
    expect(screen.getByRole('button', { name: '1 reply, open thread' })).toBeTruthy();
    const deletedArticles = within(room()).getAllByText('Message deleted').map((node) => node.closest('article'));
    const noReplies = deletedArticles.find((node) => node.getAttribute('data-message-id') === 'm2');
    expect(within(noReplies).queryByRole('button', { name: 'Reply in thread' })).toBeNull();
  });

  it('a Viewer can delete their own old message but not edit it', async () => {
    renderChat(fakeApi(), { myRole: 'Viewer' });
    await screen.findByText('Standup at 10');
    expect(within(article('Standup at 10')).queryByRole('button', { name: 'Edit message' })).toBeNull();
    expect(within(article('Standup at 10')).getByRole('button', { name: 'Delete message' })).toBeTruthy();
  });

  it('an api without edit / delete shows no buttons (older fakes keep working)', async () => {
    const { edit, remove, onUpdated, ...plain } = fakeApi(); // eslint-disable-line no-unused-vars
    renderChat(plain);
    await screen.findByText('Standup at 10');
    expect(screen.queryByRole('button', { name: /Edit message|Delete message/ })).toBeNull();
  });
});

describe('ThreadPanel edit / delete (Sprint 7 · M1)', () => {
  const openThread = async (api) => {
    renderChat(api);
    fireEvent.click(await screen.findByRole('button', { name: '1 reply, open thread' }));
    const thread = await screen.findByRole('complementary', { name: 'Thread' });
    await within(thread).findByText('Count me in');
    return thread;
  };

  it('edits my reply in the thread', async () => {
    const api = fakeApi();
    const thread = await openThread(api);
    // The first message is Riya's: only my reply has buttons.
    expect(within(thread).getAllByRole('button', { name: 'Edit message' })).toHaveLength(1);
    fireEvent.click(within(thread).getByRole('button', { name: 'Edit message' }));
    const box = within(thread).getByLabelText('Edit your message');
    fireEvent.change(box, { target: { value: 'Count me in, tacos please' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await within(thread).findByText('Count me in, tacos please')).toBeTruthy();
    expect(api.edit).toHaveBeenCalledWith('p1', 'c1', 'r1', 'Count me in, tacos please');
    expect(within(thread).getByText('(edited)')).toBeTruthy();
  });

  it('deletes my reply: it stays in the thread as "Message deleted" and the count is kept', async () => {
    const api = fakeApi();
    const thread = await openThread(api);
    fireEvent.click(within(thread).getByRole('button', { name: 'Delete message' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this reply?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete reply' }));
    expect(await within(thread).findByText('Message deleted')).toBeTruthy();
    expect(api.remove).toHaveBeenCalledWith('p1', 'c1', 'r1');
    expect(within(thread).getByText('1 reply')).toBeTruthy();
    expect(within(room()).getByText('1 reply')).toBeTruthy();
  });

  it('live changes to the first message and to replies show in the open thread', async () => {
    const api = fakeApi();
    const thread = await openThread(api);
    act(() => api.pushUpdate({ projectId: 'p1', channelId: 'c1', parentId: 'm3', message: msg('r1', 'Count me in!', 3, me, { parentMessage: 'm3', edited: true, editedAt: at(25) }) }));
    expect(within(thread).getByText('Count me in!')).toBeTruthy();
    act(() => api.pushUpdate({ projectId: 'p1', channelId: 'c1', parentId: null, message: msg('m3', '', 0, riya, { deleted: true, replyCount: 1 }) }));
    expect(within(thread).getByText('Message deleted')).toBeTruthy();
    expect(within(thread).getByText('Count me in!')).toBeTruthy();
  });
});
