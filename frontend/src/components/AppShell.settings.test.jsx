// [Sprint 7 · M5] The Settings page is reachable from the sidebar and from the account menu.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: { id: 'u1', name: 'Aarohi Mehta', email: 'aarohi@example.com', isDemo: false }, logout: () => {} }));
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
          <Route path="/settings" element={<p>settings page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectApi.list.mockResolvedValue({ projects: [] });
});

describe('AppShell → Settings', () => {
  it('the sidebar has a Settings link', () => {
    renderShell();
    const main = screen.getByRole('navigation', { name: 'Main' });
    const link = Array.from(main.querySelectorAll('a')).find((a) => a.textContent.includes('Settings'));
    expect(link?.getAttribute('href')).toBe('/settings');
    fireEvent.click(link);
    expect(screen.getByText('settings page')).toBeTruthy();
  });

  it('the account menu has a Settings item', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(screen.getByText('settings page')).toBeTruthy();
  });

  it('the breadcrumb says Settings on the Settings page', () => {
    renderShell('/settings');
    expect(screen.getByText('Settings', { selector: '.crumb b' })).toBeTruthy();
  });
});
