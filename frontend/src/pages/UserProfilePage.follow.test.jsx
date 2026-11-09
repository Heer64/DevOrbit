// [Sprint 5 · M8] US-54 Follow / Unfollow on another user's profile, follower count and total vote score.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UserProfilePage from './UserProfilePage';

const profile = (overrides = {}) => ({
  name: 'Bob Builder',
  username: 'bob.builder',
  headline: 'Backend developer',
  bio: 'Builds APIs.',
  avatarUrl: '',
  skills: ['Node.js'],
  followerCount: 4,
  publicScore: -3,
  portfolio: { available: false, path: null },
  isMe: false,
  isFollowing: false,
  ...overrides,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

function renderPage(api) {
  return render(
    <MemoryRouter initialEntries={['/people/bob.builder']}>
      <Routes>
        <Route path="/people/:username" element={<UserProfilePage api={api} portfolios={{ shared: vi.fn() }} />} />
      </Routes>
    </MemoryRouter>
  );
}

const stats = () => screen.getByLabelText('Public stats').textContent;

describe('UserProfilePage follow (US-54)', () => {
  it("AC1: Follow raises the follower count by one, from the server's answer", async () => {
    const pending = deferred();
    const api = { user: vi.fn(() => Promise.resolve({ profile: profile() })), follow: vi.fn(() => pending.promise), unfollow: vi.fn() };
    renderPage(api);
    const button = await screen.findByRole('button', { name: 'Follow Bob Builder' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(stats()).toContain('4');

    fireEvent.click(button);
    expect(api.follow).toHaveBeenCalledWith('bob.builder');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Following…');

    pending.resolve({ following: true, followerCount: 5, changed: true, message: 'You are now following Bob Builder.' });
    const unfollow = await screen.findByRole('button', { name: 'Unfollow Bob Builder' });
    expect(unfollow.getAttribute('aria-pressed')).toBe('true');
    expect(stats()).toContain('5');
    expect(stats()).not.toContain('4');
    expect(screen.getByRole('status').textContent).toBe('You are now following Bob Builder.');
  });

  it('AC2: Unfollow lowers the follower count by one', async () => {
    const api = {
      user: vi.fn(() => Promise.resolve({ profile: profile({ isFollowing: true, followerCount: 1 }) })),
      follow: vi.fn(),
      unfollow: vi.fn(() => Promise.resolve({ following: false, followerCount: 0, changed: true, message: 'You unfollowed Bob Builder.' })),
    };
    renderPage(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Unfollow Bob Builder' }));
    await screen.findByRole('button', { name: 'Follow Bob Builder' });
    expect(api.unfollow).toHaveBeenCalledWith('bob.builder');
    expect(stats()).toContain('0');
    expect(stats()).toContain('Followers');
  });

  it('a failed follow shows why and changes nothing', async () => {
    const api = {
      user: vi.fn(() => Promise.resolve({ profile: profile() })),
      follow: vi.fn(() => Promise.reject(Object.assign(new Error('Network error'), { status: 0 }))),
    };
    renderPage(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Follow Bob Builder' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Network error');
    expect(screen.getByRole('button', { name: 'Follow Bob Builder' }).disabled).toBe(false);
    expect(stats()).toContain('4');
  });

  it('AC3: shows the total vote score (it can be negative), never "likes"', async () => {
    renderPage({ user: vi.fn(() => Promise.resolve({ profile: profile() })) });
    await screen.findByRole('heading', { name: 'Bob Builder' });
    expect(stats()).toContain('-3');
    expect(stats()).toContain('Total vote score');
    expect(document.body.textContent.toLowerCase()).not.toContain('like');
  });

  it('my own profile has no Follow button', async () => {
    renderPage({ user: vi.fn(() => Promise.resolve({ profile: profile({ isMe: true }) })) });
    await screen.findByRole('heading', { name: 'Bob Builder' });
    expect(screen.queryByRole('button', { name: /follow/i })).toBeNull();
  });

  it('opens as "Unfollow" when I already follow them', async () => {
    renderPage({ user: vi.fn(() => Promise.resolve({ profile: profile({ isFollowing: true }) })) });
    const button = await screen.findByRole('button', { name: 'Unfollow Bob Builder' });
    expect(within(button).getByText(/Unfollow/)).toBeTruthy();
  });

  it('a double click sends only one request', async () => {
    const pending = deferred();
    const api = { user: vi.fn(() => Promise.resolve({ profile: profile() })), follow: vi.fn(() => pending.promise) };
    renderPage(api);
    const button = await screen.findByRole('button', { name: 'Follow Bob Builder' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.follow).toHaveBeenCalledTimes(1);
    pending.resolve({ following: true, followerCount: 5, changed: true, message: '' });
    await waitFor(() => expect(stats()).toContain('5'));
  });
});
