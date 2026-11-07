// [Sprint 5 · M3] US-06 View another user's profile (read-only), with the US-07 portfolio switch.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UserProfilePage from './UserProfilePage';

const profile = (overrides = {}) => ({
  name: 'Bob Skilltag',
  username: 'bob.skilltag',
  headline: 'Frontend developer',
  bio: 'I build calm interfaces.',
  avatarUrl: '/uploads/avatars/bob.png',
  skills: ['Svelte', 'CSS'],
  followerCount: 3,
  publicScore: 12,
  portfolio: { available: true, path: '/portfolio/bob.skilltag' },
  isMe: false,
  ...overrides,
});

const portfolio = {
  user: { name: 'Bob Skilltag', username: 'bob.skilltag', headline: '', avatarUrl: '' },
  projects: [
    { name: 'Open Garden', description: 'Community gardening app', domain: 'Community', tags: [], role: 'Contributor', completedAt: '2026-11-01T00:00:00.000Z', isPrivate: false, stats: { tasksCompleted: 3, decisionsRecorded: 2, messagesPosted: 5, computedAt: new Date().toISOString() } },
  ],
  totals: { projects: 1, tasksCompleted: 3, decisionsRecorded: 2, messagesPosted: 5 },
  statsUpdatedAt: new Date().toISOString(),
};

const okApi = (data = profile()) => ({ user: vi.fn(() => Promise.resolve({ profile: data })) });
const okPortfolios = () => ({ shared: vi.fn(() => Promise.resolve(portfolio)) });

function renderPage({ api = okApi(), portfolios = okPortfolios(), path = '/people/bob.skilltag' } = {}) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/people/:username" element={<UserProfilePage api={api} portfolios={portfolios} />} />
        <Route path="/profile" element={<p>My profile page</p>} />
      </Routes>
    </MemoryRouter>
  );
  return { ...view, api, portfolios };
}

describe('UserProfilePage (US-06)', () => {
  it('AC1: shows photo, bio, skill tags, follower count and score for the username in the link', async () => {
    const { api, container } = renderPage();
    expect(await screen.findByRole('heading', { name: 'Bob Skilltag' })).toBeTruthy();
    expect(api.user).toHaveBeenCalledWith('bob.skilltag');
    expect(container.querySelector('.avatar img').getAttribute('src')).toMatch(/\/uploads\/avatars\/bob\.png$/);
    expect(screen.getByText('@bob.skilltag · Frontend developer')).toBeTruthy();
    expect(screen.getByText('I build calm interfaces.')).toBeTruthy();
    expect(screen.getByText('Svelte')).toBeTruthy();
    expect(screen.getByText('CSS')).toBeTruthy();
    const stats = screen.getByLabelText('Public stats').textContent;
    expect(stats).toContain('3');
    expect(stats).toContain('Followers');
    expect(stats).toContain('12');
    expect(stats).toContain('Score');
  });

  it('is read-only: no edit form or buttons', async () => {
    renderPage();
    await screen.findByText('Open Garden');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByText(/This is how other people see your profile/)).toBeNull();
  });

  it('AC2: only the fields the API sends are shown, never anything else', async () => {
    // Even if a field slipped into the response, the page has no place for it.
    renderPage({ api: okApi({ ...profile(), email: 'bob@example.com', githubUrl: 'https://github.com/bob' }) });
    await screen.findByRole('heading', { name: 'Bob Skilltag' });
    expect(screen.queryByText(/bob@example\.com/)).toBeNull();
    expect(screen.queryByText(/github\.com\/bob/)).toBeNull();
  });

  it('shows the public portfolio, read-only (projects do not link into workspaces)', async () => {
    const { portfolios } = renderPage();
    expect(await screen.findByText('Open Garden')).toBeTruthy();
    expect(portfolios.shared).toHaveBeenCalledWith('bob.skilltag');
    expect(screen.getByText('Contributor')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open Garden' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open shareable portfolio' }).getAttribute('href')).toBe('/portfolio/bob.skilltag');
  });

  it('US-07 AC2: a portfolio that was turned off says "not available" and is never loaded', async () => {
    const portfolios = okPortfolios();
    renderPage({ api: okApi(profile({ portfolio: { available: false, path: null } })), portfolios });
    expect(await screen.findByText('This portfolio is not available.')).toBeTruthy();
    expect(portfolios.shared).not.toHaveBeenCalled();
    expect(screen.queryByText('Open Garden')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open shareable portfolio' })).toBeNull();
  });

  it('if the portfolio was turned off a moment ago, it still says "not available"', async () => {
    const portfolios = { shared: () => Promise.reject(Object.assign(new Error('This portfolio is not available.'), { status: 404 })) };
    renderPage({ portfolios });
    expect(await screen.findByText('This portfolio is not available.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('empty fields get friendly text', async () => {
    renderPage({ api: okApi(profile({ bio: '', headline: '', skills: [], followerCount: 1, publicScore: 0 })) });
    expect(await screen.findByText('Bob Skilltag has not added a bio yet.')).toBeTruthy();
    expect(screen.getByText('@bob.skilltag')).toBeTruthy();
    expect(screen.getByText('No skills listed yet.')).toBeTruthy();
    expect(screen.getByLabelText('Public stats').textContent).toContain('Follower');
    expect(screen.getByLabelText('Public stats').textContent).not.toContain('Followers');
  });

  it('an unknown username says the profile does not exist', async () => {
    const api = { user: () => Promise.reject(Object.assign(new Error('User not found.'), { status: 404 })) };
    renderPage({ api });
    expect((await screen.findByRole('alert')).textContent).toBe('This profile does not exist.');
  });

  it('other errors are shown as they come', async () => {
    const api = { user: () => Promise.reject(Object.assign(new Error('Server is down'), { status: 500 })) };
    renderPage({ api });
    expect((await screen.findByRole('alert')).textContent).toBe('Server is down');
  });

  it('opening my own profile says so and links to editing it', async () => {
    renderPage({ api: okApi(profile({ isMe: true })) });
    expect(await screen.findByText(/This is how other people see your profile/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit your profile' }).getAttribute('href')).toBe('/profile');
  });
});
