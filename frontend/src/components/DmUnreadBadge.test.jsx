// [Sprint 6 · M2] US-19: the unread direct-message badge next to "Messages" in the sidebar.
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import DmUnreadBadge from './DmUnreadBadge';
import { announceUnreadTotal } from '../directMessages';

function fakeApi(total) {
  const listeners = { message: new Set(), read: new Set() };
  return {
    unreadCount: vi.fn(() => Promise.resolve({ unreadTotal: total })),
    onMessage: (handler) => {
      listeners.message.add(handler);
      return () => listeners.message.delete(handler);
    },
    onRead: (handler) => {
      listeners.read.add(handler);
      return () => listeners.read.delete(handler);
    },
    emit: (kind, payload) =>
      act(() => {
        listeners[kind].forEach((handler) => handler(payload));
      }),
    listeners,
  };
}

const badge = () => screen.queryByTestId('dm-unread-badge');

describe('DmUnreadBadge', () => {
  it('shows the unread total from the server, with a sentence for screen readers', async () => {
    render(<DmUnreadBadge api={fakeApi(2)} />);
    await waitFor(() => expect(badge()).not.toBeNull());
    expect(badge().textContent).toContain('2');
    expect(screen.getByText('2 unread direct messages')).toBeTruthy();
  });

  it('shows nothing at 0', async () => {
    const api = fakeApi(0);
    render(<DmUnreadBadge api={api} />);
    await waitFor(() => expect(api.unreadCount).toHaveBeenCalled());
    expect(badge()).toBeNull();
  });

  it('AC2: a live message raises it at once; reading in any tab lowers it', async () => {
    const api = fakeApi(0);
    render(<DmUnreadBadge api={api} />);
    await waitFor(() => expect(api.unreadCount).toHaveBeenCalled());

    api.emit('message', { conversationId: 'c1', unreadTotal: 1 });
    expect(badge().textContent).toContain('1');
    expect(screen.getByText('1 unread direct message')).toBeTruthy();

    api.emit('read', { conversationId: 'c1', unreadTotal: 0 });
    expect(badge()).toBeNull();

    act(() => announceUnreadTotal(4)); // the Messages page in this tab learned a new total from the API
    expect(badge().textContent).toContain('4');
  });

  it('stops listening when it is removed', async () => {
    const api = fakeApi(1);
    const { unmount } = render(<DmUnreadBadge api={api} />);
    await waitFor(() => expect(badge()).not.toBeNull());
    unmount();
    expect(api.listeners.message.size).toBe(0);
    expect(api.listeners.read.size).toBe(0);
  });
});
