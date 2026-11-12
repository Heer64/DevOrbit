// [Sprint 6 · M2] US-19 Messages page: inbox, one private conversation, sending, and live messages (AC2).
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MessagesPage from './MessagesPage';
import { DM_NOT_FOUND } from '../components/DmConversation';

const ME = { id: 'me1', name: 'Alice Sender', username: 'alice' };
const bob = { _id: 'bob1', name: 'Bob Receiver', username: 'bob', avatarUrl: '' };
const carol = { _id: 'carol1', name: 'Carol Coder', username: 'carol', avatarUrl: '' };
const T = (minute) => `2026-11-11T10:${String(minute).padStart(2, '0')}:00.000Z`;

const withBob = (extra = {}) => ({
  _id: 'c-bob',
  otherUser: bob,
  lastMessage: { preview: 'See you Friday', at: T(5), fromMe: true },
  unreadCount: 0,
  activityAt: T(5),
  ...extra,
});
const withCarol = (extra = {}) => ({
  _id: 'c-carol',
  otherUser: carol,
  lastMessage: { preview: 'Can you review my PR?', at: T(3), fromMe: false },
  unreadCount: 2,
  activityAt: T(3),
  ...extra,
});
const message = (id, sender, body, minute) => ({ _id: id, conversation: 'c-bob', sender, body, createdAt: T(minute) });
const meAsSender = { _id: 'me1', name: 'Alice Sender', username: 'alice', avatarUrl: '' };

function fakeApi(overrides = {}) {
  const listeners = { message: new Set(), read: new Set() };
  const api = {
    inbox: vi.fn(() => Promise.resolve({ conversations: [withBob(), withCarol()], unreadTotal: 2 })),
    conversation: vi.fn((id) => Promise.resolve({ conversation: id === 'c-carol' ? withCarol() : withBob() })),
    messages: vi.fn(() =>
      Promise.resolve({
        messages: [message('m1', bob, 'Hi Alice, free on Friday?', 1), message('m2', meAsSender, 'See you Friday', 5)],
        nextBefore: null,
      })
    ),
    send: vi.fn((id, body) =>
      Promise.resolve({
        message: message('m-new', meAsSender, body, 7),
        conversation: withBob({ lastMessage: { preview: body, at: T(7), fromMe: true }, activityAt: T(7) }),
      })
    ),
    markRead: vi.fn(() => Promise.resolve({ unreadCount: 0, unreadTotal: 0 })),
    unreadCount: vi.fn(() => Promise.resolve({ unreadTotal: 0 })),
    onMessage: vi.fn((handler) => {
      listeners.message.add(handler);
      return () => listeners.message.delete(handler);
    }),
    onRead: vi.fn((handler) => {
      listeners.read.add(handler);
      return () => listeners.read.delete(handler);
    }),
    ...overrides,
  };
  api.live = (payload) =>
    act(() => {
      listeners.message.forEach((handler) => handler(payload));
    });
  api.liveRead = (payload) =>
    act(() => {
      listeners.read.forEach((handler) => handler(payload));
    });
  return api;
}

function renderPage(api, path = '/messages', user = ME) {
  const page = <MessagesPage api={api} currentUser={user} />;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/messages" element={page} />
        <Route path="/messages/:conversationId" element={page} />
        <Route path="/people/:username" element={<p>Profile page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const inboxNav = () => screen.getByRole('navigation', { name: 'Conversations' });
const rowNames = () =>
  within(inboxNav())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('b').textContent);

describe('MessagesPage inbox', () => {
  it('lists my conversations newest first, with "You:" previews and unread counts', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByText('Bob Receiver');
    expect(rowNames()).toEqual(['Bob Receiver', 'Carol Coder']);
    expect(screen.getByText('You: See you Friday')).toBeTruthy();
    expect(screen.getByText('Can you review my PR?')).toBeTruthy();
    expect(screen.getByText('2 unread')).toBeTruthy();
    expect(
      within(inboxNav())
        .getByRole('link', { name: /Bob Receiver/ })
        .getAttribute('href')
    ).toBe('/messages/c-bob');
    // Nothing is open yet: a short explanation instead.
    expect(screen.getByRole('heading', { name: 'Your direct messages' })).toBeTruthy();
    expect(api.messages).not.toHaveBeenCalled();
  });

  it('with no conversations it explains how to start one', async () => {
    renderPage(fakeApi({ inbox: () => Promise.resolve({ conversations: [], unreadTotal: 0 }) }));
    expect(await screen.findByText('No conversations yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Find people' }).getAttribute('href')).toBe('/discover');
  });

  it('a failed load can be retried', async () => {
    const inbox = vi
      .fn()
      .mockRejectedValueOnce(new Error('Server is down'))
      .mockResolvedValueOnce({ conversations: [withBob()], unreadTotal: 0 });
    renderPage(fakeApi({ inbox }));
    expect((await screen.findByRole('alert')).textContent).toContain('Server is down');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('Bob Receiver')).toBeTruthy();
    expect(inbox).toHaveBeenCalledTimes(2);
  });

  it('demo users get a note instead of calling the API', () => {
    const api = fakeApi();
    renderPage(api, '/messages', { id: 'demo-user', name: 'Demo', isDemo: true });
    expect(screen.getByRole('heading', { name: /Direct messages need a real account/ })).toBeTruthy();
    expect(api.inbox).not.toHaveBeenCalled();
  });
});

describe('MessagesPage conversation', () => {
  it('AC1: shows the private conversation with the other person, separate from any project', async () => {
    const api = fakeApi();
    renderPage(api, '/messages/c-bob');
    const room = await screen.findByRole('region', { name: 'Conversation with Bob Receiver' });
    expect(await within(room).findByText('Hi Alice, free on Friday?')).toBeTruthy();
    expect(within(room).getByRole('link', { name: 'Bob Receiver' }).getAttribute('href')).toBe('/people/bob');
    expect(room.textContent).toContain('only you and Bob Receiver can read it');
    expect(room.textContent).toContain('not part of any project channel');
    // Mine on one side, theirs on the other.
    expect(room.querySelector('[data-message-id="m1"]').className).toContain('theirs');
    expect(room.querySelector('[data-message-id="m2"]').className).toContain('mine');
    expect(api.conversation).toHaveBeenCalledWith('c-bob');
    expect(api.messages).toHaveBeenCalledWith('c-bob');
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith('c-bob'));
  });

  it('opening a conversation marks it read in the inbox', async () => {
    const api = fakeApi();
    renderPage(api, '/messages/c-carol');
    await screen.findByRole('region', { name: 'Conversation with Carol Coder' });
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith('c-carol'));
    await waitFor(() => expect(screen.queryByText('2 unread')).toBeNull());
  });

  it('sending: the message appears, the box empties and the inbox shows "You: …"', async () => {
    const api = fakeApi();
    renderPage(api, '/messages/c-bob');
    const box = await screen.findByLabelText('Write a direct message');
    await screen.findByText('Hi Alice, free on Friday?');
    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(sendButton.disabled).toBe(true); // empty box
    fireEvent.change(box, { target: { value: '  Yes, 4pm works  ' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('c-bob', 'Yes, 4pm works'));
    expect(await screen.findByText('Yes, 4pm works', { selector: '.dm-bubble p' })).toBeTruthy();
    await waitFor(() => expect(box.value).toBe(''));
    expect(within(inboxNav()).getByText('You: Yes, 4pm works')).toBeTruthy();
  });

  it('Enter sends, Shift+Enter does not', async () => {
    const api = fakeApi();
    renderPage(api, '/messages/c-bob');
    const box = await screen.findByLabelText('Write a direct message');
    await screen.findByText('Hi Alice, free on Friday?');
    fireEvent.change(box, { target: { value: 'line one' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(api.send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('c-bob', 'line one'));
  });

  it('a refused message shows why and keeps the text (e.g. sending too fast)', async () => {
    const send = vi.fn(() =>
      Promise.reject(Object.assign(new Error('You are sending messages too quickly. Wait a moment and try again.'), { status: 429 }))
    );
    renderPage(fakeApi({ send }), '/messages/c-bob');
    const box = await screen.findByLabelText('Write a direct message');
    await screen.findByText('Hi Alice, free on Friday?');
    fireEvent.change(box, { target: { value: 'hello again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect((await screen.findByRole('alert')).textContent).toContain('sending messages too quickly');
    expect(box.value).toBe('hello again');
  });

  it('AC2: a live message from the other person appears at once and is marked read', async () => {
    const api = fakeApi();
    renderPage(api, '/messages/c-bob');
    await screen.findByText('Hi Alice, free on Friday?');
    await waitFor(() => expect(api.markRead).toHaveBeenCalledTimes(1));

    api.live({
      conversationId: 'c-bob',
      message: message('m-live', bob, 'Just saw your message!', 8),
      conversation: withBob({
        lastMessage: { preview: 'Just saw your message!', at: T(8), fromMe: false },
        unreadCount: 1,
        activityAt: T(8),
      }),
      unreadTotal: 3,
    });
    expect(await screen.findByText('Just saw your message!', { selector: '.dm-bubble p' })).toBeTruthy();
    await waitFor(() => expect(api.markRead).toHaveBeenCalledTimes(2));
  });

  it('AC2: a live message in another conversation moves it to the top of the inbox, unread, without showing it here', async () => {
    const api = fakeApi();
    renderPage(api, '/messages/c-bob');
    await screen.findByText('Hi Alice, free on Friday?');
    api.live({
      conversationId: 'c-carol',
      message: { ...message('m-c', carol, 'Ping from Carol', 9), conversation: 'c-carol' },
      conversation: withCarol({ lastMessage: { preview: 'Ping from Carol', at: T(9), fromMe: false }, unreadCount: 3, activityAt: T(9) }),
      unreadTotal: 3,
    });
    await waitFor(() => expect(rowNames()).toEqual(['Carol Coder', 'Bob Receiver']));
    expect(within(inboxNav()).getByText('Ping from Carol')).toBeTruthy();
    expect(screen.getByText('3 unread')).toBeTruthy();
    expect(screen.queryByText('Ping from Carol', { selector: '.dm-bubble p' })).toBeNull();
  });

  it('reading in another tab clears the unread count here too', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByText('2 unread');
    api.liveRead({ conversationId: 'c-carol', unreadTotal: 0 });
    await waitFor(() => expect(screen.queryByText('2 unread')).toBeNull());
  });

  it('AC2: a conversation I am not part of shows "not found", not its messages', async () => {
    const notMine = Object.assign(new Error('Conversation not found.'), { status: 404 });
    const api = fakeApi({ conversation: () => Promise.reject(notMine), messages: () => Promise.reject(notMine) });
    renderPage(api, '/messages/someone-elses');
    expect((await screen.findByRole('alert')).textContent).toContain(DM_NOT_FOUND);
    expect(screen.getByRole('link', { name: 'Back to all messages' })).toBeTruthy();
    expect(api.markRead).not.toHaveBeenCalled();
  });

  it('"Show older messages" loads the page before the oldest one shown', async () => {
    const messages = vi
      .fn()
      .mockResolvedValueOnce({ messages: [message('m5', bob, 'newer', 5)], nextBefore: 'm5' })
      .mockResolvedValueOnce({ messages: [message('m1', bob, 'older', 1)], nextBefore: null });
    renderPage(fakeApi({ messages }), '/messages/c-bob');
    await screen.findByText('newer');
    fireEvent.click(screen.getByRole('button', { name: 'Show older messages' }));
    expect(await screen.findByText('older')).toBeTruthy();
    expect(messages).toHaveBeenLastCalledWith('c-bob', { before: 'm5' });
    const bodies = [...document.querySelectorAll('.dm-bubble p')].map((p) => p.textContent);
    expect(bodies).toEqual(['older', 'newer']);
    expect(screen.queryByRole('button', { name: 'Show older messages' })).toBeNull();
  });
});
