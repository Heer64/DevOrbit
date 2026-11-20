// [Sprint 7 · M4] Another user's profile: Following count, followers / following lists, and their projects.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UserProfilePage from './UserProfilePage';

const profile = {
  name: 'Ann Author',
  username: 'ann',
  headline: '',
  bio: '',
  avatarUrl: '',
  skills: [],
  followerCount: 1,
  followingCount: 4,
  publicScore: 0,
  portfolio: { available: false, path: null },
  isMe: false,
  isFollowing: false,
};
const list = (people) => ({ people, total: people.length, page: 1, pageSize: 20, hasMore: false });

function makeApi() {
  let followers = [{ name: 'Ben Builder', username: 'ben', headline: '', avatarUrl: '' }];
  return {
    user: vi.fn(() => Promise.resolve({ profile })),
    follow: vi.fn(() => {
      followers = [{ name: 'Me Myself', username: 'me', headline: '', avatarUrl: '' }, ...followers];
      return Promise.resolve({ following: true, followerCount: 2, changed: true, message: 'You are now following Ann Author.' });
    }),
    unfollow: vi.fn(),
    followers: vi.fn(() => Promise.resolve(list(followers))),
    following: vi.fn(() => Promise.resolve(list([]))),
    projects: vi.fn(() =>
      Promise.resolve({
        projects: [
          {
            _id: 'p1',
            name: 'Open Garden',
            description: '',
            domain: 'Community',
            status: 'In progress',
            visibility: 'Public',
            tags: [],
            color: 'mint',
            role: 'Owner',
            memberCount: 2,
            viewerIsMember: false,
            path: '/discover/p1',
          },
        ],
      })
    ),
  };
}

function renderPage(api) {
  return render(
    <MemoryRouter initialEntries={['/people/ann']}>
      <Routes>
        <Route
          path="/people/:username"
          element={<UserProfilePage api={api} portfolios={{ shared: vi.fn() }} messages={{ open: vi.fn() }} />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('UserProfilePage lists and projects (Sprint 7 · M4)', () => {
  it("shows the Following count, the followers list and the user's projects", async () => {
    const api = makeApi();
    renderPage(api);
    expect(await screen.findByRole('heading', { name: 'Ann Author' })).toBeTruthy();
    const stats = screen.getByLabelText('Public stats').textContent;
    expect(stats).toContain('4');
    expect(stats).toContain('Following');
    expect((await screen.findByRole('link', { name: /Ben Builder/ })).getAttribute('href')).toBe('/people/ben');
    expect((await screen.findByRole('link', { name: 'Open Open Garden' })).getAttribute('href')).toBe('/discover/p1');
    expect(api.projects).toHaveBeenCalledWith('ann');
  });

  it('reloads the followers list after Follow', async () => {
    const api = makeApi();
    renderPage(api);
    await screen.findByRole('link', { name: /Ben Builder/ });
    fireEvent.click(screen.getByRole('button', { name: 'Follow Ann Author' }));
    expect(await screen.findByRole('link', { name: /Me Myself/ })).toBeTruthy();
    await waitFor(() => expect(api.followers.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole('tab', { name: /Followers/ }).textContent).toContain('2');
  });
});
