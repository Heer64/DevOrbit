// [Sprint 4 · M1] US-31 Authorize GitHub: project integration settings panel.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import GithubIntegrationPanel, { GITHUB_RESULTS, githubResult } from './GithubIntegrationPanel';

const P = 'p'.repeat(24);
const AUTH_URL = 'https://github.com/login/oauth/authorize?client_id=cid&state=s';

function fakeApi(status, authorize = () => Promise.resolve({ url: AUTH_URL })) {
  return {
    status: vi.fn(() => (status instanceof Error ? Promise.reject(status) : Promise.resolve(status))),
    authorize: vi.fn(authorize),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderPanel({ api, entry = `/project/${P}`, navigateTo = vi.fn() }) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/project/:id" element={<><GithubIntegrationPanel projectId={P} api={api} navigateTo={navigateTo} /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  );
  return { navigateTo };
}

const notConnected = { configured: true, canAuthorize: true, connection: null };
const connected = {
  configured: true,
  canAuthorize: true,
  connection: { githubLogin: 'octo-owner', scopes: ['repo'], authorizedAt: '2026-10-31T10:00:00.000Z', authorizedBy: { _id: 'u1', name: 'Riya Kapoor', username: 'riyak' } },
};

describe('GithubIntegrationPanel', () => {
  it('Owner clicks Connect GitHub and is sent to the GitHub authorize URL from the API', async () => {
    const api = fakeApi(notConnected);
    const { navigateTo } = renderPanel({ api });
    fireEvent.click(await screen.findByRole('button', { name: /connect github/i }));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(AUTH_URL));
    expect(api.authorize).toHaveBeenCalledWith(P);
  });

  it('AC1: back from GitHub after approving, shows the stored authorization and clears ?github', async () => {
    renderPanel({ api: fakeApi(connected), entry: `/project/${P}?tab=tasks&github=connected` });
    expect((await screen.findByRole('status')).textContent).toContain(GITHUB_RESULTS.connected.text);
    expect(await screen.findByText('Authorized as @octo-owner')).toBeTruthy();
    expect(screen.getByText(/By Riya Kapoor/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect github/i })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(`/project/${P}?tab=tasks`));
    expect(screen.getByTestId('location').textContent).not.toContain('github=');
  });

  it('AC2: back from GitHub after denying, says the connection was not made and nothing was stored', async () => {
    renderPanel({ api: fakeApi(notConnected), entry: `/project/${P}?github=denied` });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('was not made');
    expect(alert.textContent).toContain('Nothing was saved.');
    expect(await screen.findByText('Not connected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /connect github/i })).toBeTruthy();
  });

  it('every failure result says nothing was saved; unknown results fall back to the generic error', () => {
    for (const [key, value] of Object.entries(GITHUB_RESULTS)) {
      if (key === 'connected') expect(value.ok).toBe(true);
      else expect(value.text).toContain('Nothing was saved.');
    }
    expect(githubResult('something-else')).toBe(GITHUB_RESULTS.error);
  });

  it('Admins see the status but cannot connect', async () => {
    renderPanel({ api: fakeApi({ configured: true, canAuthorize: false, connection: null }) });
    expect(await screen.findByText('Only the project Owner can connect GitHub.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect github/i })).toBeNull();
  });

  it('explains when GitHub is not configured on the server', async () => {
    renderPanel({ api: fakeApi({ configured: false, canAuthorize: true, connection: null }) });
    expect(await screen.findByText(/not set up on this server/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect github/i })).toBeNull();
  });

  it('shows the server error and stays on the page when the connection cannot start', async () => {
    const error = Object.assign(new Error('Only the project Owner can connect GitHub.'), { status: 403 });
    const api = fakeApi(notConnected, () => Promise.reject(error));
    const { navigateTo } = renderPanel({ api });
    fireEvent.click(await screen.findByRole('button', { name: /connect github/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('Only the project Owner can connect GitHub.');
    expect(navigateTo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /connect github/i }).disabled).toBe(false);
  });

  it('never navigates to a URL that is not GitHub', async () => {
    const api = fakeApi(notConnected, () => Promise.resolve({ url: 'https://evil.example/login' }));
    const { navigateTo } = renderPanel({ api });
    fireEvent.click(await screen.findByRole('button', { name: /connect github/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/valid sign-in link/i);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('shows a load error', async () => {
    renderPanel({ api: fakeApi(new Error('Only the project Owner and Admins can view integration settings.')) });
    expect((await screen.findByRole('alert')).textContent).toContain('integration settings');
  });
});
