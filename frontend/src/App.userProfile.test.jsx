// [Sprint 5 · M3] US-06 (Actor: Registered User): /people/:username needs a login.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useParams } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null, loading: false }));
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
// Only the routing is tested here; the page itself is tested in pages/UserProfilePage.test.jsx.
vi.mock('./components/AppShell', () => ({ default: () => <div><p>App shell</p><Outlet /></div> }));
vi.mock('./pages/UserProfilePage', () => ({
  default: function UserProfileProbe() {
    const { username } = useParams();
    return <p>Profile of {username}</p>;
  },
}));
vi.mock('./pages/PortfolioPage', () => ({ default: () => <p>Portfolio page</p> }));
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

describe('/people/:username routing (US-06)', () => {
  it('a logged-in user opens another user\'s profile inside the app shell', () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    renderAt('/people/bob.skilltag');
    expect(screen.getByText('App shell')).toBeTruthy();
    expect(screen.getByText('Profile of bob.skilltag')).toBeTruthy();
  });

  it('a visitor who is not logged in is sent to log in first', () => {
    renderAt('/people/bob.skilltag');
    expect(screen.getByText('Login page')).toBeTruthy();
    expect(screen.queryByText('Profile of bob.skilltag')).toBeNull();
  });

  it('my own Profile page still opens at /profile', () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    renderAt('/profile');
    expect(screen.getByText('Profile page')).toBeTruthy();
  });
});
