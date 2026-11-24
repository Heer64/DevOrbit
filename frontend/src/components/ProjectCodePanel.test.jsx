// [Sprint 7 · M8] D3: the "Code & files" panel of a real project shows only real GitHub data.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectCodePanel, { CODE_PANEL_TEXT, safeGithubHref } from './ProjectCodePanel';

const P = 'p'.repeat(24);
const repository = { fullName: 'octo-owner/devorbit', htmlUrl: 'https://github.com/octo-owner/devorbit', defaultBranch: 'main', private: true };
const active = (extra = {}) => ({
  state: 'active',
  reason: null,
  message: '',
  repository,
  stats: { stars: 7, forks: 2, openIssuesAndPrs: 5, pushedAt: new Date(Date.now() - 3 * 3600_000).toISOString() },
  files: [
    { name: 'src', type: 'dir', htmlUrl: 'https://github.com/octo-owner/devorbit/tree/main/src' },
    { name: 'package.json', type: 'file', htmlUrl: 'https://github.com/octo-owner/devorbit/blob/main/package.json' },
    { name: 'README.md', type: 'file', htmlUrl: 'https://github.com/octo-owner/devorbit/blob/main/README.md' },
  ],
  filesTotal: 3,
  moreFiles: false,
  empty: false,
  ...extra,
});
const empty = (state, extra = {}) => ({ state, reason: null, message: '', repository: null, stats: null, files: [], filesTotal: 0, moreFiles: false, empty: false, ...extra });
const fakeApi = (answer) => ({ code: vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer))) });

describe('ProjectCodePanel (D3)', () => {
  it('shows the real repository, numbers and top-level files, each opening on GitHub', async () => {
    const api = fakeApi(active());
    render(<ProjectCodePanel projectId={P} api={api} />);
    const name = await screen.findByText('octo-owner/devorbit');
    expect(api.code).toHaveBeenCalledWith(P);
    expect(name.closest('a').getAttribute('href')).toBe('https://github.com/octo-owner/devorbit');
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText(/Private repository/)).toBeTruthy();

    const numbers = screen.getByLabelText('Repository numbers');
    expect(numbers.textContent).toContain('7 stars');
    expect(numbers.textContent).toContain('2 forks');
    expect(numbers.textContent).toContain('5 open issues & PRs');
    expect(numbers.textContent).toMatch(/Last push/);

    const files = within(screen.getByLabelText('Files at the top of the repository')).getAllByRole('link');
    expect(files.map((link) => link.textContent)).toEqual(['srcFolder', 'package.jsonFile', 'README.mdFile']);
    for (const link of files) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
    expect(screen.getByText('Open on GitHub').closest('a').getAttribute('href')).toBe('https://github.com/octo-owner/devorbit');
  });

  it('never shows the old sample data', async () => {
    render(<ProjectCodePanel projectId={P} api={fakeApi(active())} />);
    await screen.findByText('octo-owner/devorbit');
    const text = document.body.textContent;
    for (const sample of ['12 forks', '4 open PRs', '128 commits', 'Updated 2h ago', 'Frontend source', 'API & services', 'SAMPLE']) {
      expect(text).not.toContain(sample);
    }
  });

  it('no repository: Owner/Admin are pointed to the GitHub panel, other members to the Owner', async () => {
    const { unmount } = render(<ProjectCodePanel projectId={P} canManage api={fakeApi(empty('not_connected'))} />);
    expect(await screen.findByText(CODE_PANEL_TEXT.noRepository)).toBeTruthy();
    expect(screen.getByText(new RegExp(CODE_PANEL_TEXT.ownerHint))).toBeTruthy();
    unmount();

    render(<ProjectCodePanel projectId={P} api={fakeApi(empty('not_connected'))} />);
    expect(await screen.findByText(new RegExp(CODE_PANEL_TEXT.memberHint))).toBeTruthy();
    expect(screen.queryByLabelText('Repository numbers')).toBeNull();
    expect(screen.queryByText('Open on GitHub')).toBeNull();
  });

  it('authorized without a repository, or disconnected: says which, still no numbers', async () => {
    const { unmount } = render(<ProjectCodePanel projectId={P} api={fakeApi(empty('needs_repository'))} />);
    expect(await screen.findByText(new RegExp(CODE_PANEL_TEXT.needsRepository))).toBeTruthy();
    unmount();
    render(<ProjectCodePanel projectId={P} api={fakeApi(empty('disconnected'))} />);
    expect(await screen.findByText(new RegExp(CODE_PANEL_TEXT.disconnected))).toBeTruthy();
    expect(screen.getByTestId('code-empty')).toBeTruthy();
  });

  it('unavailable: the API\'s short message and the repository name, no numbers; Try again reloads', async () => {
    const answer = empty('unavailable', { reason: 'reauthorize', message: 'GitHub no longer accepts this project\'s authorization.', repository });
    const api = fakeApi(answer);
    render(<ProjectCodePanel projectId={P} api={api} />);
    expect(await screen.findByText('GitHub no longer accepts this project\'s authorization.')).toBeTruthy();
    expect(screen.getByText('octo-owner/devorbit')).toBeTruthy();
    expect(screen.queryByLabelText('Repository numbers')).toBeNull();
    fireEvent.click(screen.getByLabelText('Reload repository'));
    await waitFor(() => expect(api.code).toHaveBeenCalledTimes(2));
  });

  it('a request that fails shows an error instead of made-up data', async () => {
    render(<ProjectCodePanel projectId={P} api={fakeApi(new Error('Network down'))} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Network down');
    expect(screen.queryByLabelText('Repository numbers')).toBeNull();
  });

  it('loading, an empty repository, and "Showing 20 of N"', async () => {
    let resolve;
    const api = { code: vi.fn(() => new Promise((r) => { resolve = r; })) };
    const { unmount } = render(<ProjectCodePanel projectId={P} api={api} />);
    expect(screen.getByText(CODE_PANEL_TEXT.loading)).toBeTruthy();
    resolve(active({ files: [], filesTotal: 0, empty: true }));
    expect(await screen.findByText(CODE_PANEL_TEXT.empty)).toBeTruthy();
    unmount();

    const many = Array.from({ length: 20 }, (_, i) => ({ name: `file${i}.js`, type: 'file', htmlUrl: `https://github.com/octo-owner/devorbit/blob/main/file${i}.js` }));
    render(<ProjectCodePanel projectId={P} api={fakeApi(active({ files: many, filesTotal: 35, moreFiles: true }))} />);
    expect(await screen.findByText('Showing 20 of 35. Open the repository to see the rest.')).toBeTruthy();
  });

  it('a link that is not github.com is never rendered as a link', async () => {
    const files = [{ name: 'evil', type: 'file', htmlUrl: 'javascript:alert(1)' }];
    render(<ProjectCodePanel projectId={P} api={fakeApi(active({ files, repository: { ...repository, htmlUrl: 'https://evil.example.com/x' } }))} />);
    expect(await screen.findByText('evil')).toBeTruthy();
    expect(screen.getByText('evil').closest('a')).toBeNull();
    expect(screen.getByText('octo-owner/devorbit').closest('a')).toBeNull();
    expect(screen.queryByText('Open on GitHub')).toBeNull();
    expect(safeGithubHref('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(safeGithubHref('https://github.com.evil.com/a')).toBe(null);
  });
});
