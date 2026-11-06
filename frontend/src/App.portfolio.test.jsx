// [Sprint 5 · M5] US-49 AC3: a shared portfolio link (/portfolio/:username) opens without logging in.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useParams } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null, loading: false }));
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
// Only the routing is tested here; the page itself is tested in pages/PortfolioPage.test.jsx.
vi.mock('./components/AppShell', () => ({ default: () => <div><p>App shell</p><Outlet /></div> }));
vi.mock('./pages/PortfolioPage', () => ({
  default: function PortfolioProbe() {
    const { username } = useParams();
    return <p>Portfolio of {username}</p>;
  },
}));
vi.mock('./pages/DiscoverPage', () => ({ default: () => <p>Discover page</p> }));
vi.mock('./pages/DashboardPage', () => ({ default: () => <p>Dashboard page</p> }));
vi.mock('./pages/ProfilePage', () => ({ default: () => <p>Profile page</p> }));
vi.mock('./pages/ProjectPage', () => ({ default: () => <p>Project page</p> }));
vi.mock('./pages/SignupPage', () => ({ default: () => <p>Signup page</p> }));
vi.mock('./pages/LoginPage', () => ({ default: () => <p>Login page</p> }));

import App from './App';

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => {
  auth.user = null;
  auth.loading = false;
});

describe('/portfolio/:username routing (US-49)', () => {
  it('anyone with the link opens it without logging in, in the public frame', () => {
    renderAt('/portfolio/max_member');
    expect(screen.getByText('Portfolio of max_member')).toBeTruthy();
    expect(screen.queryByText('Login page')).toBeNull();
    expect(screen.queryByText('App shell')).toBeNull();
    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
  });

  it('a logged-in user opens it inside the normal app shell', () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    renderAt('/portfolio/max_member');
    expect(screen.getByText('App shell')).toBeTruthy();
    expect(screen.getByText('Portfolio of max_member')).toBeTruthy();
  });
});
