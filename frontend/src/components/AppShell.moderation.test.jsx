// [Sprint 6 · M7] US-56: the "Moderation" link is shown to Content Moderators and Platform Admins only.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null, logout: () => {} }));
const mocks = vi.hoisted(() => ({ projectApi: { list: vi.fn(), create: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./NotificationBell', () => ({ default: () => null }));
vi.mock('./DmUnreadBadge', () => ({ default: () => null }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import AppShell from './AppShell';

function renderShell(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<p>dashboard</p>} />
          <Route path="/moderation" element={<p>moderation</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectApi.list.mockResolvedValue({ projects: [] });
});

describe('Moderation link', () => {
  it.each([
    ['a Content Moderator', { id: 'u2', name: 'Mo', platformRole: 'moderator', isDemo: false }],
    ['a Platform Admin', { id: 'a1', name: 'Asha', platformRole: 'admin', isDemo: false }],
  ])('%s sees it, and the top bar names the page', async (_label, user) => {
    auth.user = user;
    renderShell('/moderation');
    const link = await screen.findByRole('link', { name: /^moderation$/i });
    expect(link.getAttribute('href')).toBe('/moderation');
    expect(screen.getByText('Moderator queue', { selector: '.crumb b' })).toBeTruthy();
  });

  it.each([
    ['a normal user', { id: 'u1', name: 'Riya', platformRole: 'user', isDemo: false }],
    ['an account from before platform roles', { id: 'u3', name: 'Olga', isDemo: false }],
    ['the demo identity', { id: 'demo-user', name: 'Demo', platformRole: 'moderator', isDemo: true }],
  ])('%s does not', async (_label, user) => {
    auth.user = user;
    renderShell();
    await screen.findByRole('link', { name: /my profile/i });
    expect(screen.queryByRole('link', { name: /^moderation$/i })).toBeNull();
  });
});
