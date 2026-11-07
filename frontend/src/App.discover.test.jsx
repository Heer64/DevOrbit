// [Sprint 5 · M1] US-45 (Actor: Visitor): /discover opens without logging in.
// Logged-out visitors get the light PublicShell; logged-in users keep the AppShell.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null, loading: false }));
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
// The pages themselves are tested elsewhere; here only the routing matters.
vi.mock('./components/AppShell', () => ({ default: () => <div><p>App shell</p><Outlet /></div> }));
vi.mock('./pages/DiscoverPage', () => ({ default: () => <p>Discover page</p> }));
// [Sprint 5 · M2] US-46: the public project page is tested in pages/PublicProjectPage.test.jsx.
vi.mock('./pages/PublicProjectPage', async () => {
  const { useParams } = await import('react-router-dom');
  return { default: function PublicProjectProbe() { return <p>Public project page {useParams().projectId}</p>; } };
});
vi.mock('./pages/DashboardPage', () => ({ default: () => <p>Dashboard page</p> }));
vi.mock('./pages/ProfilePage', () => ({ default: () => <p>Profile page</p> }));
vi.mock('./pages/ProjectPage', () => ({ default: () => <p>Project page</p> }));
vi.mock('./pages/SignupPage', () => ({ default: () => <p>Signup page</p> }));
vi.mock('./pages/LoginPage', () => ({
  default: function LoginProbe() {
    const location = useLocation();
    const from = location.state?.from;
    return <p>Login page{from ? ` from ${from.pathname}${from.search || ''}` : ''}</p>;
  },
}));

import App from './App';

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => {
  auth.user = null;
  auth.loading = false;
});

describe('/discover routing (US-45)', () => {
  it('a logged-out visitor opens Discover in the public frame, not the login page', () => {
    renderAt('/discover');
    expect(screen.getByText('Discover page')).toBeTruthy();
    expect(screen.queryByText(/Login page/)).toBeNull();
    expect(screen.queryByText('App shell')).toBeNull();
    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe('/signup');
  });

  it('"Log in" remembers the filtered Discover page to come back to', () => {
    renderAt('/discover?tag=React&status=Planning');
    fireEvent.click(screen.getByRole('link', { name: 'Log in' }));
    expect(screen.getByText('Login page from /discover?tag=React&status=Planning')).toBeTruthy();
  });

  it('a logged-in user sees Discover inside the normal app shell', () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    renderAt('/discover');
    expect(screen.getByText('App shell')).toBeTruthy();
    expect(screen.getByText('Discover page')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign up' })).toBeNull();
  });

  it('while the session is being restored, a loading screen is shown', () => {
    auth.loading = true;
    renderAt('/discover');
    expect(screen.getByText('Opening your orbit…')).toBeTruthy();
    expect(screen.queryByText('Discover page')).toBeNull();
  });

  it('other pages still need a login', () => {
    renderAt('/dashboard');
    expect(screen.getByText(/Login page/)).toBeTruthy();
    expect(screen.queryByText('Dashboard page')).toBeNull();
  });
});

// [Sprint 5 · M2] US-46 (Actor: Visitor): a Public project's page opens without logging in.
describe('/discover/:projectId routing (US-46)', () => {
  const ID = '0123456789abcdef01234567';

  it('a logged-out visitor opens the public project page in the public frame, not the login page', () => {
    renderAt(`/discover/${ID}`);
    expect(screen.getByText(`Public project page ${ID}`)).toBeTruthy();
    expect(screen.queryByText(/Login page/)).toBeNull();
    expect(screen.queryByText('App shell')).toBeNull();
    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
  });

  it('"Log in" in the public frame comes back to the project page', () => {
    renderAt(`/discover/${ID}`);
    fireEvent.click(screen.getByRole('link', { name: 'Log in' }));
    expect(screen.getByText(`Login page from /discover/${ID}`)).toBeTruthy();
  });

  it('a logged-in user sees the public project page inside the app shell', () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    renderAt(`/discover/${ID}`);
    expect(screen.getByText('App shell')).toBeTruthy();
    expect(screen.getByText(`Public project page ${ID}`)).toBeTruthy();
  });

  it('the member workspace (/project/:id) still needs a login', () => {
    renderAt(`/project/${ID}`);
    expect(screen.getByText(/Login page/)).toBeTruthy();
    expect(screen.queryByText('Project page')).toBeNull();
  });
});
