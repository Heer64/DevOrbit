// [Sprint 6 · M8] US-57, US-58: /admin is a logged-in page inside the normal app shell.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null, loading: false }));
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
// Only the routing is tested here; the page itself is tested in pages/AdminPage.test.jsx.
vi.mock('./components/AppShell', () => ({
  default: () => (
    <div>
      <p>App shell</p>
      <Outlet />
    </div>
  ),
}));
vi.mock('./pages/AdminPage', () => ({ default: () => <p>Admin page</p> }));
vi.mock('./pages/DashboardPage', () => ({ default: () => <p>Dashboard page</p> }));
vi.mock('./pages/LoginPage', () => ({ default: () => <p>Login page</p> }));

import App from './App';

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

beforeEach(() => {
  auth.user = null;
  auth.loading = false;
});

describe('/admin routing (US-57, US-58)', () => {
  it('a logged-out visitor is sent to the login page', () => {
    renderAt('/admin');
    expect(screen.getByText('Login page')).toBeTruthy();
    expect(screen.queryByText('Admin page')).toBeNull();
  });

  it('a logged-in user gets the page inside the app shell (the page itself decides who may use it)', () => {
    auth.user = { id: 'a1', name: 'Asha Admin', platformRole: 'admin', isDemo: false };
    renderAt('/admin');
    expect(screen.getByText('App shell')).toBeTruthy();
    expect(screen.getByText('Admin page')).toBeTruthy();
  });
});
