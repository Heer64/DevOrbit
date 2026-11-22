// [Sprint 7 · M6] The bell's popup for new live notifications, and reloading after the connection comes back.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import NotificationBell from './NotificationBell';

const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const note = (id, overrides = {}) => ({
  _id: id,
  type: 'assignment',
  summary: `assigned you to "Task ${id}"`,
  actor: { _id: 'u1', name: 'Nia Owner' },
  project: { _id: 'p1', name: 'Open Garden', color: 'violet' },
  link: `/project/p1?tab=tasks&task=${id}`,
  read: false,
  createdAt: at(5),
  ...overrides,
});

function fakeApi({ notifications = [note('old', { read: true })], unreadCount = 0 } = {}) {
  const live = { created: null, read: null, reconnect: null };
  return {
    list: vi.fn(() => Promise.resolve({ notifications, unreadCount, nextBefore: null })),
    markRead: vi.fn((id) => Promise.resolve({ notification: { _id: id, read: true }, unreadCount: 0 })),
    onCreated: vi.fn((handler) => {
      live.created = handler;
      return () => {
        live.created = null;
      };
    }),
    onRead: vi.fn((handler) => {
      live.read = handler;
      return () => {
        live.read = null;
      };
    }),
    onReconnect: vi.fn((handler) => {
      live.reconnect = handler;
      return () => {
        live.reconnect = null;
      };
    }),
    push: (payload) =>
      act(() => {
        live.created?.(payload);
      }),
    pushRead: (payload) =>
      act(() => {
        live.read?.(payload);
      }),
    reconnect: () =>
      act(() => {
        live.reconnect?.();
      }),
  };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderBell(api) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <NotificationBell api={api} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const bell = () => screen.getByRole('button', { name: /^Notifications/ });
const popups = () => screen.getByRole('region', { name: 'New notifications' });
const fresh = note('n1', {
  type: 'mention',
  summary: 'mentioned you in #general',
  link: '/project/p1?tab=chat&channel=c1&message=m1',
  createdAt: at(0),
});

describe('NotificationBell popup (Sprint 7 M6)', () => {
  it('a new live notification pops up with who, what and the project', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(within(popups()).queryByRole('button')).toBeNull();

    api.push({ notification: fresh, unreadCount: 1 });

    expect(within(popups()).getByText('Mention')).toBeTruthy();
    expect(within(popups()).getByText('Nia Owner')).toBeTruthy();
    expect(within(popups()).getByText('mentioned you in #general')).toBeTruthy();
    expect(within(popups()).getByText('Open Garden')).toBeTruthy();
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  it('selecting the popup marks it read, opens the related item and closes the popup', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    api.push({ notification: fresh, unreadCount: 1 });

    fireEvent.click(within(popups()).getByRole('button', { name: /mentioned you in #general/ }));

    expect(api.markRead).toHaveBeenCalledWith('n1');
    expect(screen.getByTestId('where').textContent).toBe('/project/p1?tab=chat&channel=c1&message=m1');
    expect(within(popups()).queryByText('mentioned you in #general')).toBeNull();
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Notifications'));
  });

  it('the close button dismisses the popup without marking it read', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    api.push({ notification: fresh, unreadCount: 1 });

    fireEvent.click(within(popups()).getByRole('button', { name: 'Dismiss notification' }));
    expect(within(popups()).queryByText('mentioned you in #general')).toBeNull();
    expect(api.markRead).not.toHaveBeenCalled();
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  it('no popup while the list is open (it is already in view), and opening the list clears popups', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());

    api.push({ notification: fresh, unreadCount: 1 });
    expect(within(popups()).getByText('mentioned you in #general')).toBeTruthy();

    fireEvent.click(bell());
    expect(within(popups()).queryByText('mentioned you in #general')).toBeNull();

    api.push({ notification: note('n2', { createdAt: at(0) }), unreadCount: 2 });
    expect(within(popups()).queryByText('assigned you to "Task n2"')).toBeNull();
    const list = screen.getByRole('region', { name: 'Notifications list' });
    expect(within(list).getByText('assigned you to "Task n2"')).toBeTruthy();
  });

  it('read in another tab: the popup here closes too', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    api.push({ notification: fresh, unreadCount: 1 });

    api.pushRead({ notificationId: 'n1', unreadCount: 0 });
    expect(within(popups()).queryByText('mentioned you in #general')).toBeNull();
  });

  it('the same notification arriving twice pops up once', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    api.push({ notification: fresh, unreadCount: 1 });
    api.push({ notification: fresh, unreadCount: 1 });
    expect(within(popups()).getAllByText('mentioned you in #general')).toHaveLength(1);
  });

  it('when the live connection comes back, the list reloads (notifications sent meanwhile appear)', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    api.list.mockResolvedValueOnce({ notifications: [note('missed', { createdAt: at(1) })], unreadCount: 1, nextBefore: null });
    api.reconnect();

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Notifications, 1 unread'));
    expect(within(popups()).queryByRole('button')).toBeNull(); // missed ones go to the list, not into popups
  });
});
