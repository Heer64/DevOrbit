// [Sprint 4 · M3] US-33 Manage the GitHub connection: status, Check connection, Disconnect, Re-authorize.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GithubIntegrationPanel, {
  GITHUB_RESULTS,
  REAUTHORIZED_RESULT,
  checkResultText,
  connectionStateLabel,
  githubResult,
} from './GithubIntegrationPanel';

const P = 'p'.repeat(24);
const AUTH_URL = 'https://github.com/login/oauth/authorize?client_id=cid&state=s';
const by = { _id: 'u1', name: 'Riya Kapoor', username: 'riyak' };
const repository = { id: 101, name: 'devorbit', fullName: 'octo-owner/devorbit', owner: 'octo-owner', private: true, htmlUrl: 'https://github.com/octo-owner/devorbit', defaultBranch: 'main', connectedAt: '2026-11-01T07:00:00.000Z', connectedBy: by };
const connection = { githubLogin: 'octo-owner', scopes: ['repo'], authorizedAt: '2026-10-31T10:00:00.000Z', authorizedBy: by };

const status = (extra = {}) => ({
  configured: true,
  canAuthorize: true,
  connection,
  repository,
  connectionState: 'active',
  active: true,
  canSelectRepository: true,
  canReauthorize: true,
  canDisconnect: true,
  canVerify: true,
  acceptingEvents: true,
  disconnectedAt: null,
  disconnectedBy: null,
  needsReauthorization: false,
  reauthorizationReason: null,
  lastCheckedAt: null,
  repositoryAccess: null,
  ...extra,
});
const adminStatus = (extra = {}) => status({ canSelectRepository: false, ...extra });
const disconnectedStatus = (extra = {}) => status({
  connectionState: 'disconnected', active: false, canSelectRepository: false, canDisconnect: false, canVerify: false,
  acceptingEvents: false, disconnectedAt: '2026-11-02T09:00:00.000Z', disconnectedBy: { _id: 'u2', name: 'Admin Ana', username: 'ana' },
  ...extra,
});

function fakeApi(initial, overrides = {}) {
  return {
    status: vi.fn(() => Promise.resolve(initial)),
    authorize: vi.fn(() => Promise.resolve({ url: AUTH_URL })),
    repositories: vi.fn(() => Promise.resolve({ githubLogin: 'octo-owner', repositories: [], truncated: false, selectedId: null })),
    selectRepository: vi.fn(),
    disconnect: vi.fn(() => Promise.resolve({ ...disconnectedStatus(), revokedOnGithub: true })),
    verify: vi.fn(() => Promise.resolve({ ...status(), check: { token: 'valid', repository: 'accessible' } })),
    ...overrides,
  };
}

function renderPanel({ api, entry = `/project/${P}`, navigateTo = vi.fn(), onChange = vi.fn() }) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/project/:id" element={<GithubIntegrationPanel projectId={P} api={api} navigateTo={navigateTo} onChange={onChange} />} />
      </Routes>
    </MemoryRouter>
  );
  return { navigateTo, onChange };
}

const statusLine = () => screen.getByTestId('github-connection-status').textContent;

describe('US-33 GithubIntegrationPanel: manage the GitHub connection', () => {
  it('AC1: Owner and Admin see the repository name and the connection status', async () => {
    for (const initial of [status(), adminStatus()]) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[`/project/${P}`]}>
          <Routes><Route path="/project/:id" element={<GithubIntegrationPanel projectId={P} api={fakeApi(initial)} />} /></Routes>
        </MemoryRouter>
      );
      expect(await screen.findByText('octo-owner/devorbit')).toBeTruthy();
      expect(screen.getByText('Active')).toBeTruthy();
      expect(statusLine()).toBe('Connection status: Active');
      for (const name of [/check connection/i, /re-authorize github/i, /^disconnect$/i]) {
        expect(screen.getByRole('button', { name })).toBeTruthy();
      }
      unmount();
    }
  });

  it('AC2: Disconnect asks for confirmation; Cancel changes nothing', async () => {
    const api = fakeApi(status());
    renderPanel({ api });
    fireEvent.click(await screen.findByRole('button', { name: /^disconnect$/i }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('octo-owner/devorbit');
    expect(dialog.textContent).toContain('No new GitHub events are added to the Activity Feed. Earlier entries stay.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.disconnect).not.toHaveBeenCalled();
  });

  it('AC2: confirming disconnects; the panel says new events stop and earlier ones stay', async () => {
    const api = fakeApi(status());
    const { onChange } = renderPanel({ api });
    fireEvent.click(await screen.findByRole('button', { name: /^disconnect$/i }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith(P));
    expect((await screen.findByRole('status')).textContent).toContain('GitHub was disconnected from this project.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(statusLine()).toBe('Connection status: Disconnected');
    expect(screen.getByText('Was authorized as @octo-owner')).toBeTruthy();
    expect(screen.getByText(/By Admin Ana/)).toBeTruthy();
    expect(screen.getByText('Last repository:')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^disconnect$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /check connection/i })).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.getByRole('button', { name: /re-authorize github/i })).toBeTruthy();
    expect(onChange).toHaveBeenCalled();
  });

  it('AC2: a failed disconnect keeps the dialog open with the reason', async () => {
    const api = fakeApi(status(), { disconnect: vi.fn(() => Promise.reject(new Error('GitHub is already disconnected from this project.'))) });
    renderPanel({ api });
    fireEvent.click(await screen.findByRole('button', { name: /^disconnect$/i }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    expect((await within(screen.getByRole('alertdialog')).findByRole('alert')).textContent).toContain('already disconnected');
  });

  it('AC3: an expired authorization asks to re-authorize; Re-authorize goes to GitHub', async () => {
    const api = fakeApi(adminStatus({ connectionState: 'needs_reauthorization', active: false, needsReauthorization: true, reauthorizationReason: 'token_rejected' }));
    const { navigateTo } = renderPanel({ api });
    expect(await screen.findByText(/no longer accepts this project's authorization/i)).toBeTruthy();
    expect(statusLine()).toBe('Connection status: Re-authorization needed');
    expect(screen.queryByText('Active')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /re-authorize github/i }));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(AUTH_URL));
    expect(api.authorize).toHaveBeenCalledWith(P);
  });

  it('AC3: a disconnected integration can be re-authorized by an Admin', async () => {
    const api = fakeApi(disconnectedStatus({ canSelectRepository: false }));
    const { navigateTo } = renderPanel({ api });
    fireEvent.click(await screen.findByRole('button', { name: /re-authorize github/i }));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(AUTH_URL));
  });

  it('AC3: back from GitHub after re-authorizing, says so and shows Active', async () => {
    renderPanel({ api: fakeApi(status()), entry: `/project/${P}?github=reauthorized` });
    expect((await screen.findByRole('status')).textContent).toBe(REAUTHORIZED_RESULT.text);
    expect(await screen.findByText('Active')).toBeTruthy();
  });

  it('Check connection reports the token AND the repository', async () => {
    const lost = { ...status({ connectionState: 'repository_unavailable', active: false, repositoryAccess: 'not_accessible' }), check: { token: 'valid', repository: 'not_accessible' } };
    const api = fakeApi(status(), { verify: vi.fn(() => Promise.resolve(lost)) });
    renderPanel({ api });
    fireEvent.click(await screen.findByRole('button', { name: /check connection/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('can no longer read octo-owner/devorbit');
    expect(statusLine()).toBe('Connection status: Repository unavailable');
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('Check connection success keeps it Active and says what was checked', async () => {
    const api = fakeApi(status());
    renderPanel({ api });
    fireEvent.click(await screen.findByRole('button', { name: /check connection/i }));
    expect((await screen.findByRole('status')).textContent).toContain('the authorization works and octo-owner/devorbit can be read');
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows nothing to manage for people the API does not allow', async () => {
    renderPanel({ api: fakeApi(status({ canReauthorize: false, canDisconnect: false, canVerify: false, canSelectRepository: false })) });
    expect(await screen.findByText('octo-owner/devorbit')).toBeTruthy();
    expect(screen.queryByRole('group', { name: /manage the github connection/i })).toBeNull();
  });

  it('helpers: labels, check results and results from GitHub', () => {
    expect(connectionStateLabel('disconnected')).toBe('Disconnected');
    expect(connectionStateLabel('nonsense')).toBe('Not connected');
    expect(checkResultText({ token: 'rejected', repository: 'not_checked' }).ok).toBe(false);
    expect(checkResultText({ token: 'unreadable', repository: 'not_checked' }).ok).toBe(false);
    expect(checkResultText({ token: 'valid', repository: 'none' }).ok).toBe(true);
    expect(checkResultText(undefined).ok).toBe(false);
    expect(githubResult('reauthorized')).toBe(REAUTHORIZED_RESULT);
    expect(githubResult('connected')).toBe(GITHUB_RESULTS.connected);
    expect('reauthorized' in GITHUB_RESULTS).toBe(false); // M1's "every failure says nothing was saved" stays true
  });
});
