// [Sprint 6 · M7] US-56 moderation warning and FR-20 join request outcome in the notification bell.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import NotificationBell, { NOTIFICATION_KINDS } from './NotificationBell';

const notifications = [
  { _id: 'w1', type: 'moderation_warning', summary: 'A Content Moderator warned you about your post "Buy now" (reason: Spam or misleading). Please follow the community rules.', actor: null, project: null, link: '/feed', read: false, createdAt: new Date().toISOString() },
  { _id: 'j1', type: 'join_approved', summary: 'approved your request to join "Open Garden" as Contributor', actor: { _id: 'u1', name: 'Nia Owner' }, project: { _id: 'p1', name: 'Open Garden' }, link: '/project/p1', read: false, createdAt: new Date(Date.now() - 60_000).toISOString() },
  { _id: 'j2', type: 'join_rejected', summary: 'Your request to join "Climate Map" was declined.', actor: null, project: { _id: 'p2', name: 'Climate Map' }, link: '/discover/p2', read: true, createdAt: new Date(Date.now() - 120_000).toISOString() },
];

const fakeApi = () => ({
  list: vi.fn(() => Promise.resolve({ notifications, unreadCount: 2, nextBefore: null })),
  markRead: vi.fn((id) => Promise.resolve({ notification: { _id: id, read: true }, unreadCount: 1 })),
  onCreated: vi.fn(() => () => {}),
  onRead: vi.fn(() => () => {}),
});

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

async function openBell(api) {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <NotificationBell api={api} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
  return screen.getByRole('region', { name: 'Notifications list' });
}

describe('personal notifications in the bell', () => {
  it('has labels for the three new kinds', () => {
    expect(NOTIFICATION_KINDS.moderation_warning.label).toBe('Moderation warning');
    expect(NOTIFICATION_KINDS.join_approved.label).toBe('Join request approved');
    expect(NOTIFICATION_KINDS.join_rejected.label).toBe('Join request declined');
  });

  it('shows a warning without a project or actor, and join outcomes with their project', async () => {
    const list = await openBell(fakeApi());
    const items = within(list).getAllByRole('button').filter((b) => b.className.includes('notif-item'));
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Moderation warning');
    expect(items[0].textContent).toContain('A Content Moderator warned you');
    expect(items[1].textContent).toContain('Nia Owner approved your request to join "Open Garden" as Contributor');
    expect(items[1].textContent).toContain('Join request approved');
    expect(items[2].textContent).toContain('Join request declined');
    expect(items[2].textContent).toContain('Climate Map');
  });

  it('opening the warning goes to the feed and marks it read; a declined request opens the public page', async () => {
    const api = fakeApi();
    let list = await openBell(api);
    await act(async () => { fireEvent.click(within(list).getByText(/A Content Moderator warned you/)); });
    expect(api.markRead).toHaveBeenCalledWith('w1');
    expect(screen.getByTestId('where').textContent).toBe('/feed');

    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    list = screen.getByRole('region', { name: 'Notifications list' });
    await act(async () => { fireEvent.click(within(list).getByText(/was declined/)); });
    expect(screen.getByTestId('where').textContent).toBe('/discover/p2');
  });
});
