// [Sprint 7 · M2] Messages page: edit and delete my own direct messages, and Sent / Seen.
// Same fake API style as MessagesPage.test.jsx, plus edit / remove and the live 'dm:updated' / 'dm:seen' events.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MessagesPage from './MessagesPage';

const ME = { id: 'me1', name: 'Alice Sender', username: 'alice' };
const meAsSender = { _id: 'me1', name: 'Alice Sender', username: 'alice', avatarUrl: '' };
const bob = { _id: 'bob1', name: 'Bob Receiver', username: 'bob', avatarUrl: '' };
const T = (minute) => `2026-11-20T10:${String(minute).padStart(2, '0')}:00.000Z`;

const withBob = (extra = {}) => ({
  _id: 'c-bob',
  otherUser: bob,
  lastMessage: { preview: 'See you Friday', at: T(5), fromMe: true },
  unreadCount: 0,
  otherReadAt: null,
  activityAt: T(5),
  ...extra,
});
const message = (id, sender, body, minute, extra = {}) => ({
  _id: id,
  conversation: 'c-bob',
  sender,
  body,
  createdAt: T(minute),
  edited: false,
  editedAt: null,
  deleted: false,
  deletedAt: null,
  status: null,
  ...extra,
});
const mine = (id, body, minute, extra = {}) => message(id, meAsSender, body, minute, { status: 'sent', ...extra });

function fakeApi(overrides = {}) {
  const listeners = { message: new Set(), read: new Set(), updated: new Set(), seen: new Set() };
  const subscribe = (name) =>
    vi.fn((handler) => {
      listeners[name].add(handler);
      return () => listeners[name].delete(handler);
    });
  const api = {
    inbox: vi.fn(() => Promise.resolve({ conversations: [withBob()], unreadTotal: 0 })),
    conversation: vi.fn(() => Promise.resolve({ conversation: withBob() })),
    messages: vi.fn(() =>
      Promise.resolve({
        messages: [message('m1', bob, 'Hi Alice, free on Friday?', 1), mine('m2', 'See you Fridya', 5)],
        nextBefore: null,
        otherReadAt: null,
      })
    ),
    send: vi.fn(),
    markRead: vi.fn(() => Promise.resolve({ unreadCount: 0, unreadTotal: 0 })),
    unreadCount: vi.fn(() => Promise.resolve({ unreadTotal: 0 })),
    edit: vi.fn((id, messageId, body) =>
      Promise.resolve({
        message: mine(messageId, body, 5, { edited: true, editedAt: T(9) }),
        conversation: withBob({ lastMessage: { preview: body, at: T(5), fromMe: true } }),
        changed: true,
      })
    ),
    remove: vi.fn((id, messageId) =>
      Promise.resolve({
        message: mine(messageId, '', 5, { deleted: true, deletedAt: T(9), status: null }),
        conversation: withBob({ lastMessage: { preview: 'Message deleted', at: T(5), fromMe: true } }),
        changed: true,
      })
    ),
    onMessage: subscribe('message'),
    onRead: subscribe('read'),
    onUpdated: subscribe('updated'),
    onSeen: subscribe('seen'),
    ...overrides,
  };
  const emit = (name) => (payload) =>
    act(() => {
      listeners[name].forEach((handler) => handler(payload));
    });
  api.liveUpdated = emit('updated');
  api.liveSeen = emit('seen');
  api.liveMessage = emit('message');
  return api;
}

function renderPage(api, path = '/messages/c-bob') {
  const page = <MessagesPage api={api} currentUser={ME} />;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/messages" element={page} />
        <Route path="/messages/:conversationId" element={page} />
      </Routes>
    </MemoryRouter>
  );
}

const room = () => screen.getByRole('region', { name: 'Conversation with Bob Receiver' });
const bubbleOf = (id) => document.querySelector(`[data-message-id="${id}"]`);
const statusOf = (id) =>
  bubbleOf(id)
    .querySelector('.dm-status')
    ?.textContent.replace(/[·\s]+/g, ' ')
    .trim() || '';

describe('[Sprint 7 · M2] Sent / Seen', () => {
  it('my own messages say "Sent"; the other person\'s say nothing', async () => {
    renderPage(fakeApi());
    await screen.findByText('See you Fridya');
    expect(statusOf('m2')).toBe('Sent');
    expect(bubbleOf('m1').querySelector('.dm-status')).toBeNull();
  });

  it('shows "Seen" when the API says the other person read after my message (after a reload)', async () => {
    const api = fakeApi({
      messages: vi.fn(() =>
        Promise.resolve({ messages: [mine('m2', 'See you Fridya', 5, { status: 'seen' })], nextBefore: null, otherReadAt: T(6) })
      ),
    });
    renderPage(api);
    await screen.findByText('See you Fridya');
    expect(statusOf('m2')).toBe('Seen');
  });

  it('turns "Sent" into "Seen" live when the other person opens the conversation (dm:seen)', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByText('See you Fridya');
    expect(statusOf('m2')).toBe('Sent');
    api.liveSeen({ conversationId: 'c-other', readAt: T(30) }); // another conversation: no change
    expect(statusOf('m2')).toBe('Sent');
    api.liveSeen({ conversationId: 'c-bob', readAt: T(4) }); // read before my message: still Sent
    expect(statusOf('m2')).toBe('Sent');
    api.liveSeen({ conversationId: 'c-bob', readAt: T(5) });
    await waitFor(() => expect(statusOf('m2')).toBe('Seen'));
  });

  it('a reply from the other person means they have seen my earlier messages', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByText('See you Fridya');
    api.liveMessage({
      conversationId: 'c-bob',
      message: message('m3', bob, 'Great!', 7),
      conversation: withBob({ otherReadAt: T(7), lastMessage: { preview: 'Great!', at: T(7), fromMe: false }, activityAt: T(7) }),
      unreadTotal: 1,
    });
    await screen.findByText('Great!', { selector: '.dm-bubble p' });
    await waitFor(() => expect(statusOf('m2')).toBe('Seen'));
  });
});

describe('[Sprint 7 · M2] edit my own message', () => {
  it('only my own messages have Edit and Delete', async () => {
    renderPage(fakeApi());
    await screen.findByText('See you Fridya');
    expect(within(bubbleOf('m2')).getByRole('button', { name: 'Edit message' })).toBeTruthy();
    expect(within(bubbleOf('m2')).getByRole('button', { name: 'Delete message' })).toBeTruthy();
    expect(within(bubbleOf('m1')).queryByRole('button', { name: 'Edit message' })).toBeNull();
    expect(within(bubbleOf('m1')).queryByRole('button', { name: 'Delete message' })).toBeNull();
  });

  it('saves the new text, shows "edited" and updates the inbox line', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByText('See you Fridya');
    fireEvent.click(within(bubbleOf('m2')).getByRole('button', { name: 'Edit message' }));
    const editor = within(room()).getByLabelText('Edit your message');
    expect(editor.value).toBe('See you Fridya');
    fireEvent.change(editor, { target: { value: '  See you Friday  ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith('c-bob', 'm2', 'See you Friday'));
    expect(await screen.findByText('See you Friday', { selector: '.dm-bubble p' })).toBeTruthy();
    expect(bubbleOf('m2').textContent).toContain('edited');
    expect(screen.queryByLabelText('Edit your message')).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Conversations' })).getByText('You: See you Friday')).toBeTruthy();
  });

  it('Escape cancels; the same text again sends nothing; an empty text is refused', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByText('See you Fridya');
    fireEvent.click(within(bubbleOf('m2')).getByRole('button', { name: 'Edit message' }));
    let editor = screen.getByLabelText('Edit your message');
    fireEvent.change(editor, { target: { value: 'changed my mind' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByLabelText('Edit your message')).toBeNull();
    expect(screen.getByText('See you Fridya')).toBeTruthy();

    fireEvent.click(within(bubbleOf('m2')).getByRole('button', { name: 'Edit message' }));
    editor = screen.getByLabelText('Edit your message');
    fireEvent.keyDown(editor, { key: 'Enter' }); // unchanged
    expect(screen.queryByLabelText('Edit your message')).toBeNull();

    fireEvent.click(within(bubbleOf('m2')).getByRole('button', { name: 'Edit message' }));
    editor = screen.getByLabelText('Edit your message');
    fireEvent.change(editor, { target: { value: '   ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('Message cannot be empty');
    expect(api.edit).not.toHaveBeenCalled();
  });

  it('a refused edit (e.g. 403) shows why and keeps the editor open', async () => {
    const edit = vi.fn(() => Promise.reject(Object.assign(new Error('You can only edit or delete your own messages.'), { status: 403 })));
    renderPage(fakeApi({ edit }));
    await screen.findByText('See you Fridya');
    fireEvent.click(within(bubbleOf('m2')).getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: 'new text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('only edit or delete your own messages');
    expect(screen.getByLabelText('Edit your message').value).toBe('new text');
  });

  it('a message deleted meanwhile (409) turns into "Message deleted"', async () => {
    const edit = vi.fn(() =>
      Promise.reject(Object.assign(new Error('This message was deleted, so it can no longer be edited.'), { status: 409 }))
    );
    renderPage(fakeApi({ edit }));
    await screen.findByText('See you Fridya');
    fireEvent.click(within(bubbleOf('m2')).getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: 'too late' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('can no longer be edited');
    await waitFor(() => expect(bubbleOf('m2').className).toContain('deleted'));
    expect(bubbleOf('m2').textContent).toContain('Message deleted');
  });
});

describe('[Sprint 7 · M2] delete my own message', () => {
  it('asks first; Cancel keeps it; Delete turns it into "Message deleted" in the same place', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByText('See you Fridya');
    fireEvent.click(within(bubbleOf('m2')).getByRole('button', { name: 'Delete message' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete this message?');
    expect(dialog.textContent).toContain('for both of you');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.remove).not.toHaveBeenCalled();

    fireEvent.click(within(bubbleOf('m2')).getByRole('button', { name: 'Delete message' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('c-bob', 'm2'));
    await waitFor(() => expect(bubbleOf('m2').className).toContain('deleted'));
    expect(bubbleOf('m2').textContent).toContain('Message deleted');
    expect(screen.queryByText('See you Fridya')).toBeNull();
    expect(within(bubbleOf('m2')).queryByRole('button', { name: 'Edit message' })).toBeNull();
    expect(bubbleOf('m2').querySelector('.dm-status')).toBeNull();
    const bodies = [...document.querySelectorAll('.dm-bubble p')].map((p) => p.textContent.trim());
    expect(bodies).toEqual(['Hi Alice, free on Friday?', 'Message deleted']);
    expect(within(screen.getByRole('navigation', { name: 'Conversations' })).getByText('You: Message deleted')).toBeTruthy();
  });

  it('a failed delete shows why in the dialog', async () => {
    const remove = vi.fn(() => Promise.reject(Object.assign(new Error('Network error'), { status: 0 })));
    renderPage(fakeApi({ remove }));
    await screen.findByText('See you Fridya');
    fireEvent.click(within(bubbleOf('m2')).getByRole('button', { name: 'Delete message' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete message' }));
    expect((await within(screen.getByRole('alertdialog')).findByRole('alert')).textContent).toContain('Network error');
    expect(screen.getByText('See you Fridya')).toBeTruthy();
  });
});

describe('[Sprint 7 · M2] live edits and deletes from the other person', () => {
  it('their edit and their delete appear at once, and the inbox line follows', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByText('Hi Alice, free on Friday?');
    api.liveUpdated({
      conversationId: 'c-bob',
      message: message('m1', bob, 'Hi Alice, free on Saturday?', 1, { edited: true, editedAt: T(8) }),
      conversation: withBob(),
      unreadTotal: 0,
    });
    expect(await screen.findByText('Hi Alice, free on Saturday?')).toBeTruthy();
    expect(bubbleOf('m1').textContent).toContain('edited');

    api.liveUpdated({
      conversationId: 'c-bob',
      message: message('m1', bob, '', 1, { deleted: true, deletedAt: T(9) }),
      conversation: withBob({ lastMessage: { preview: 'Message deleted', at: T(5), fromMe: false } }),
      unreadTotal: 0,
    });
    await waitFor(() => expect(bubbleOf('m1').textContent).toContain('Message deleted'));
    expect(screen.queryByText('Hi Alice, free on Saturday?')).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Conversations' })).getByText('Message deleted')).toBeTruthy();
  });

  it('an update for another conversation does not touch this one', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByText('Hi Alice, free on Friday?');
    api.liveUpdated({ conversationId: 'c-other', message: { ...message('m1', bob, 'hacked', 1), conversation: 'c-other' } });
    expect(screen.getByText('Hi Alice, free on Friday?')).toBeTruthy();
    expect(screen.queryByText('hacked')).toBeNull();
  });
});
