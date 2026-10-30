// [Sprint 3 · M7 Part 2] Notification bell: unread count, list, live updates, open -> navigate + mark read.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import NotificationBell, { badgeText, mergeNotifications } from './NotificationBell';

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

function fakeApi({ notifications = [note('n1'), note('n2', { type: 'mention', summary: 'mentioned you in #general', link: '/project/p1?tab=chat&channel=c1&message=m1', createdAt: at(10) })], unreadCount = 2, nextBefore = null } = {}) {
  const live = { created: null, read: null };
  return {
    list: vi.fn(() => Promise.resolve({ notifications, unreadCount, nextBefore })),
    markRead: vi.fn((id) => Promise.resolve({ notification: { _id: id, read: true }, unreadCount: unreadCount - 1 })),
    onCreated: vi.fn((handler) => { live.created = handler; return () => { live.created = null; }; }),
    onRead: vi.fn((handler) => { live.read = handler; return () => { live.read = null; }; }),
    push: (payload) => live.created?.(payload),
    pushRead: (payload) => live.read?.(payload),
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
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>
  );
}

const bell = () => screen.getByRole('button', { name: /^Notifications/ });
const list = () => screen.getByRole('region', { name: 'Notifications list' });

describe('helpers', () => {
  it('badgeText caps at 9+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(3)).toBe('3');
    expect(badgeText(12)).toBe('9+');
  });

  it('mergeNotifications adds new ones once, newest first', () => {
    const merged = mergeNotifications([note('a', { createdAt: at(10) })], [note('b', { createdAt: at(1) }), note('a', { createdAt: at(10) })]);
    expect(merged.map((n) => n._id)).toEqual(['b', 'a']);
  });
});

describe('NotificationBell (US-30)', () => {
  it('shows the unread count and lists notifications labelled by type', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Notifications, 2 unread'));
    expect(within(bell()).getByText('2')).toBeTruthy();

    fireEvent.click(bell());
    expect(within(list()).getByText('2 unread')).toBeTruthy();
    expect(within(list()).getByText('Assignment')).toBeTruthy();
    expect(within(list()).getByText('Mention')).toBeTruthy();
    expect(within(list()).getByText('mentioned you in #general')).toBeTruthy();
    expect(within(list()).getAllByText('Nia Owner')).toHaveLength(2);
    expect(within(list()).getAllByText('Open Garden')).toHaveLength(2);
  });

  it('opening a notification marks it read and goes to its task or message', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    fireEvent.click(bell());

    fireEvent.click(within(list()).getByText('mentioned you in #general').closest('button'));
    expect(screen.getByTestId('where').textContent).toBe('/project/p1?tab=chat&channel=c1&message=m1');
    expect(api.markRead).toHaveBeenCalledWith('n2');
    expect(screen.queryByRole('region', { name: 'Notifications list' })).toBeNull(); // the list closes
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Notifications, 1 unread'));
  });

  it('opening an already read one navigates without marking it again', async () => {
    const api = fakeApi({ notifications: [note('n1', { read: true })], unreadCount: 0 });
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    fireEvent.click(bell());
    fireEvent.click(within(list()).getByText('assigned you to "Task n1"').closest('button'));
    expect(screen.getByTestId('where').textContent).toBe('/project/p1?tab=tasks&task=n1');
    expect(api.markRead).not.toHaveBeenCalled();
  });

  it('never follows a link that leaves the app', async () => {
    const api = fakeApi({ notifications: [note('bad', { link: 'https://evil.example' })], unreadCount: 1 });
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    fireEvent.click(bell());
    fireEvent.click(within(list()).getByText('assigned you to "Task bad"').closest('button'));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard');
  });

  it('adds live notifications at the top, once, and updates the count', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Notifications, 2 unread'));

    const fresh = note('n3', { type: 'deadline', actor: null, summary: '"Ship it" is due in less than 24 hours', createdAt: at(0) });
    act(() => api.push({ notification: fresh, unreadCount: 3 }));
    act(() => api.push({ notification: fresh, unreadCount: 3 }));
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 3 unread');

    fireEvent.click(bell());
    const items = within(list()).getAllByRole('button').filter((b) => b.className.includes('notif-item'));
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('"Ship it" is due in less than 24 hours');
    expect(within(items[0]).getByText('Deadline')).toBeTruthy();
  });

  it('a notification read in another tab is shown as read here too', async () => {
    const api = fakeApi();
    renderBell(api);
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Notifications, 2 unread'));
    act(() => api.pushRead({ notificationId: 'n1', unreadCount: 1 }));
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 1 unread');

    fireEvent.click(bell());
    const first = within(list()).getByText('assigned you to "Task n1"').closest('button');
    expect(first.className).not.toContain('unread');
  });

  it('shows an empty state, and no badge when nothing is unread', async () => {
    const api = fakeApi({ notifications: [], unreadCount: 0 });
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(bell().getAttribute('aria-label')).toBe('Notifications');
    fireEvent.click(bell());
    expect(within(list()).getByText(/No notifications yet/)).toBeTruthy();
    expect(within(list()).getByText('All caught up')).toBeTruthy();
  });

  it('loads older notifications with Show older', async () => {
    const api = fakeApi({ notifications: [note('n1')], unreadCount: 2, nextBefore: at(5) });
    api.list.mockResolvedValueOnce({ notifications: [note('n1')], unreadCount: 2, nextBefore: at(5) })
      .mockResolvedValueOnce({ notifications: [note('old', { createdAt: at(600) })], unreadCount: 2, nextBefore: null });
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    fireEvent.click(bell());
    fireEvent.click(within(list()).getByRole('button', { name: 'Show older' }));
    await within(list()).findByText('assigned you to "Task old"');
    expect(api.list).toHaveBeenLastCalledWith({ limit: 20, before: expect.any(String) });
    expect(within(list()).queryByRole('button', { name: 'Show older' })).toBeNull();
  });

  it('Escape closes the list', async () => {
    renderBell(fakeApi());
    fireEvent.click(bell());
    expect(list()).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Notifications list' })).toBeNull();
  });

  it('shows an error with a retry when the list cannot load', async () => {
    const api = fakeApi();
    api.list.mockRejectedValueOnce(Object.assign(new Error('Something went wrong. Please try again.'), { status: 500 }));
    renderBell(api);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    fireEvent.click(bell()); // opening after an error retries
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    await within(list()).findByText('mentioned you in #general');
  });
});
