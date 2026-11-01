// [Sprint 4 · M2] US-32 Connect a repository: the Owner picks one repository and the connection shows as Active.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GithubIntegrationPanel from './GithubIntegrationPanel';
import GithubRepositoryPicker, { REPOSITORY_ERRORS, repositoryErrorText } from './GithubRepositoryPicker';

const P = 'p'.repeat(24);
const by = { _id: 'u1', name: 'Riya Kapoor', username: 'riyak' };
const connection = { githubLogin: 'octo-owner', scopes: ['repo'], authorizedAt: '2026-10-31T10:00:00.000Z', authorizedBy: by };
const repo = (id, fullName, extra = {}) => ({ id, name: fullName.split('/')[1], fullName, owner: fullName.split('/')[0], private: false, htmlUrl: `https://github.com/${fullName}`, description: '', archived: false, admin: true, updatedAt: null, ...extra });
const REPOS = [repo(101, 'octo-owner/devorbit', { private: true }), repo(102, 'octo-owner/notes'), repo(103, 'campus-org/shared-app', { archived: true })];

const needsRepository = { configured: true, canAuthorize: true, connection, repository: null, connectionState: 'needs_repository', active: false, canSelectRepository: true };
const activeStatus = (fullName = 'octo-owner/devorbit', id = 101) => ({
  ...needsRepository,
  connectionState: 'active',
  active: true,
  repository: { id, name: fullName.split('/')[1], fullName, owner: 'octo-owner', private: true, htmlUrl: `https://github.com/${fullName}`, defaultBranch: 'main', connectedAt: '2026-11-01T07:00:00.000Z', connectedBy: by },
});

const apiError = (code, message = 'Request failed.', status = 409) => Object.assign(new Error(message), { status, response: { status, data: { message, code } } });

function fakeApi({ status = needsRepository, list = { githubLogin: 'octo-owner', repositories: REPOS, truncated: false, selectedId: null }, select } = {}) {
  return {
    status: vi.fn(() => (status instanceof Error ? Promise.reject(status) : Promise.resolve(status))),
    authorize: vi.fn(() => Promise.resolve({ url: 'https://github.com/login/oauth/authorize?x=1' })),
    repositories: vi.fn(() => (list instanceof Error ? Promise.reject(list) : Promise.resolve(list))),
    selectRepository: vi.fn(select || ((_id, repositoryId) => Promise.resolve(activeStatus(REPOS.find((r) => r.id === repositoryId).fullName, repositoryId)))),
  };
}

function renderPanel(api, props = {}) {
  return render(
    <MemoryRouter initialEntries={[`/project/${P}`]}>
      <Routes>
        <Route path="/project/:id" element={<GithubIntegrationPanel projectId={P} api={api} navigateTo={vi.fn()} {...props} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('US-32 GithubIntegrationPanel: choose a repository', () => {
  it('AC: authorized Owner picks a repository from the list; it is connected and shows Active', async () => {
    const api = fakeApi();
    const onChange = vi.fn();
    renderPanel(api, { onChange });

    expect(await screen.findByText('Authorized')).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /choose repository/i }));

    const group = await screen.findByRole('radiogroup', { name: 'Your GitHub repositories' });
    expect(api.repositories).toHaveBeenCalledWith(P);
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByText(/from @octo-owner/)).toBeTruthy();

    const connect = screen.getByRole('button', { name: 'Connect repository' });
    expect(connect.disabled).toBe(true); // nothing chosen yet
    fireEvent.click(within(group).getByLabelText(/octo-owner\/devorbit/));
    expect(connect.disabled).toBe(false);
    fireEvent.click(connect);

    await waitFor(() => expect(api.selectRepository).toHaveBeenCalledWith(P, 101));
    expect(await screen.findByText('Active')).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toContain('octo-owner/devorbit is connected. The GitHub connection is Active.');
    const link = screen.getByRole('link', { name: 'octo-owner/devorbit' });
    expect(link.getAttribute('href')).toBe('https://github.com/octo-owner/devorbit');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/Connected by Riya Kapoor/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('an Active connection shows the repository; the Owner can change it and cancel', async () => {
    const api = fakeApi({ status: activeStatus(), list: { githubLogin: 'octo-owner', repositories: REPOS, truncated: false, selectedId: 101 } });
    renderPanel(api);
    expect(await screen.findByText('Active')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'octo-owner/devorbit' })).toBeTruthy();
    expect(api.repositories).not.toHaveBeenCalled(); // GitHub is only asked when the Owner wants to choose

    fireEvent.click(screen.getByRole('button', { name: 'Change repository' }));
    const group = await screen.findByRole('radiogroup');
    expect(within(group).getByLabelText(/octo-owner\/devorbit/).checked).toBe(true);
    expect(screen.getByText(/Connected now/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect repository' }).disabled).toBe(true); // same as now

    fireEvent.click(within(group).getByLabelText(/octo-owner\/notes/));
    fireEvent.click(screen.getByRole('button', { name: 'Connect repository' }));
    expect(await screen.findByRole('link', { name: 'octo-owner/notes' })).toBeTruthy();
  });

  it('Admins see the repository and Active state but no picker', async () => {
    renderPanel(fakeApi({ status: { ...activeStatus(), canAuthorize: false, canSelectRepository: false } }));
    expect(await screen.findByText('Active')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'octo-owner/devorbit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /change repository/i })).toBeNull();
  });

  it('Admins are told the Owner still has to choose', async () => {
    renderPanel(fakeApi({ status: { ...needsRepository, canAuthorize: false, canSelectRepository: false } }));
    expect(await screen.findByText('Waiting for the project Owner to choose a repository.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /choose repository/i })).toBeNull();
  });

  it('server GitHub settings missing: Unavailable, never Active, no picker', async () => {
    renderPanel(fakeApi({ status: { ...activeStatus(), configured: false, connectionState: 'unavailable', active: false, repository: null, canSelectRepository: false } }));
    expect(await screen.findByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.getByText(/cannot be used/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /repository/i })).toBeNull();
  });

  it('before GitHub is authorized, only M1\'s Connect GitHub is offered', async () => {
    renderPanel(fakeApi({ status: { configured: true, canAuthorize: true, connection: null, repository: null, connectionState: 'not_connected', active: false, canSelectRepository: false } }));
    expect(await screen.findByRole('button', { name: /connect github/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /choose repository/i })).toBeNull();
  });

  it('works with an API that does not send the US-32 fields yet (treated as not chosen)', async () => {
    renderPanel(fakeApi({ status: { configured: true, canAuthorize: true, connection } }));
    expect(await screen.findByText('Authorized as @octo-owner')).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
  });
});

describe('US-32 GithubRepositoryPicker', () => {
  const renderPicker = (api, props = {}) => render(<GithubRepositoryPicker projectId={P} api={api} onSelected={vi.fn()} {...props} />);

  it('shows loading, then the list', async () => {
    let resolve;
    const api = fakeApi();
    api.repositories.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    renderPicker(api);
    expect(screen.getByRole('status').textContent).toContain('Loading your GitHub repositories');
    resolve({ githubLogin: 'octo-owner', repositories: REPOS, truncated: false, selectedId: null });
    expect(await screen.findByRole('radiogroup')).toBeTruthy();
    expect(screen.getByText(/Archived/)).toBeTruthy();
    expect(screen.getAllByText(/Private/).length).toBe(1);
  });

  it('empty GitHub account: explains and offers to reload', async () => {
    const api = fakeApi({ list: { githubLogin: 'octo-owner', repositories: [], truncated: false, selectedId: null } });
    renderPicker(api);
    expect(await screen.findByText(/No repositories were found for @octo-owner/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect repository' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /reload list/i }));
    await waitFor(() => expect(api.repositories).toHaveBeenCalledTimes(2));
  });

  it('a revoked authorization asks to re-authorize; Try again reloads', async () => {
    const api = fakeApi({ list: apiError('github_reauthorize') });
    renderPicker(api);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(REPOSITORY_ERRORS.github_reauthorize);
    api.repositories.mockResolvedValueOnce({ githubLogin: 'octo-owner', repositories: REPOS, truncated: false, selectedId: null });
    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('radiogroup')).toBeTruthy();
  });

  it('GitHub down: shows the server message', async () => {
    renderPicker(fakeApi({ list: apiError('github_unavailable', 'Could not reach GitHub. Please try again.', 502) }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach GitHub.');
  });

  it('a refused selection shows why and keeps the picker open', async () => {
    const onSelected = vi.fn();
    const api = fakeApi({ select: () => Promise.reject(apiError('repository_not_available', 'x', 400)) });
    renderPicker(api, { onSelected });
    fireEvent.click(await screen.findByLabelText(/octo-owner\/notes/));
    fireEvent.click(screen.getByRole('button', { name: 'Connect repository' }));
    expect((await screen.findByRole('alert')).textContent).toContain(REPOSITORY_ERRORS.repository_not_available);
    expect(onSelected).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Connect repository' }).disabled).toBe(false);
  });

  it('long lists can be filtered and say when they were cut', async () => {
    const many = Array.from({ length: 12 }, (_, i) => repo(200 + i, `octo-owner/service-${i}`));
    renderPicker(fakeApi({ list: { githubLogin: 'octo-owner', repositories: [...many, repo(300, 'octo-owner/website')], truncated: true, selectedId: null } }));
    const filter = await screen.findByLabelText('Filter repositories');
    fireEvent.change(filter, { target: { value: 'WEB' } });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    fireEvent.change(filter, { target: { value: 'nothing-like-this' } });
    expect(screen.getByText(/No repository matches/)).toBeTruthy();
    expect(screen.getByText(/Showing the 13 most recently updated repositories/)).toBeTruthy();
  });

  it('error text falls back to the message, then to the default', () => {
    expect(repositoryErrorText(apiError('github_rate_limited'), 'd')).toBe(REPOSITORY_ERRORS.github_rate_limited);
    expect(repositoryErrorText(new Error('Plain'), 'd')).toBe('Plain');
    expect(repositoryErrorText(null, 'd')).toBe('d');
  });
});
