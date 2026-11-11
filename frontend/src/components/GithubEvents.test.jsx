// [Sprint 4 · M4] US-34 See GitHub events in the feed: GitHub entries in the Activity feed
// (type, title, author, safe GitHub link) and the webhook status in the GitHub panel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  onProject: vi.fn(() => () => {}),
}));

vi.mock('../api', () => ({
  activityApi: { project: mocks.project },
  liveApi: { onProject: mocks.onProject },
  githubApi: {},
}));

import ActivityPanel from './ActivityPanel';
import GithubIntegrationPanel from './GithubIntegrationPanel';
import GithubWebhookStatus from './GithubWebhookStatus';
import { activityGithubLink, activityLook } from './activityDisplay';

const COMMIT_URL = 'https://github.com/octo-owner/devorbit/commit/1111111111111111111111111111111111111111';

const githubEvent = (id, type, summary, meta, minute = 0) => ({
  _id: id,
  project: 'p1',
  type,
  actor: null,
  summary,
  targetType: 'github',
  targetLabel: meta.title,
  meta,
  createdAt: new Date(Date.UTC(2026, 10, 2, 10, minute)).toISOString(),
});

afterEach(() => cleanup());

describe('activityGithubLink', () => {
  it('returns the GitHub link of a GitHub entry only', () => {
    expect(activityGithubLink({ type: 'github.commit', meta: { url: COMMIT_URL } })).toBe(COMMIT_URL);
    expect(activityGithubLink({ type: 'github.issue', meta: { url: 'javascript:alert(1)' } })).toBe('');
    expect(activityGithubLink({ type: 'github.issue', meta: { url: 'https://evil.example/github.com/x' } })).toBe('');
    expect(activityGithubLink({ type: 'task.created', meta: { url: COMMIT_URL } })).toBe('');
    expect(activityGithubLink({ type: 'github.pull_request', meta: {} })).toBe('');
  });

  it('every GitHub type has its own title', () => {
    expect(activityLook({ type: 'github.commit' }).title).toBe('Commit pushed');
    // [Sprint 6 · M1] D2: without an action the name is neutral (also what the type filter shows).
    expect(activityLook({ type: 'github.issue' }).title).toBe('GitHub issue');
    expect(activityLook({ type: 'github.pull_request' }).title).toBe('Pull request');
  });

  // [Sprint 6 · M1] D2 fix (Sprint 4 exit checks): an opened issue was titled "GitHub issue updated".
  it('titles issue and pull request entries by what happened', () => {
    const issue = (action) => activityLook({ type: 'github.issue', meta: { action } }).title;
    expect(issue('opened')).toBe('GitHub issue opened');
    expect(issue('edited')).toBe('GitHub issue updated');
    expect(issue('closed')).toBe('GitHub issue closed');
    expect(issue('reopened')).toBe('GitHub issue reopened');

    const pr = (action) => activityLook({ type: 'github.pull_request', meta: { action } }).title;
    expect(pr('opened')).toBe('Pull request opened');
    expect(pr('edited')).toBe('Pull request updated');
    expect(pr('synchronize')).toBe('Pull request updated');
    expect(pr('closed')).toBe('Pull request closed');
    expect(pr('merged')).toBe('Pull request merged');
    expect(pr('reopened')).toBe('Pull request reopened');
  });

  it('unknown or odd actions keep the neutral title, and the icon never changes', () => {
    expect(activityLook({ type: 'github.issue', meta: { action: 'labeled' } }).title).toBe('GitHub issue');
    expect(activityLook({ type: 'github.issue', meta: { action: 'toString' } }).title).toBe('GitHub issue');
    expect(activityLook({ type: 'github.issue', meta: { action: 42 } }).title).toBe('GitHub issue');
    expect(activityLook({ type: 'github.pull_request', meta: null }).title).toBe('Pull request');
    expect(activityLook({ type: 'github.issue', meta: { action: 'opened' } }).icon)
      .toBe(activityLook({ type: 'github.issue' }).icon);
    // Commits and FORGE events are not affected by meta.action.
    expect(activityLook({ type: 'github.commit', meta: { action: 'pushed' } }).title).toBe('Commit pushed');
    expect(activityLook({ type: 'task.created', meta: { action: 'opened' } }).title).toBe('Task created');
  });
});

describe('ActivityPanel with GitHub events', () => {
  beforeEach(() => {
    mocks.project.mockReset();
    mocks.onProject.mockReset();
    mocks.onProject.mockImplementation(() => () => {});
  });

  it('shows type, title, GitHub author and an "Open on GitHub" link that opens safely', async () => {
    mocks.project.mockResolvedValue({
      activity: [
        githubEvent('g1', 'github.commit', 'pushed commit "Fix login bug" to main', { author: 'octocat', title: 'Fix login bug', url: COMMIT_URL }, 2),
        githubEvent('g2', 'github.pull_request', 'merged pull request #7 "Add webhooks"', { author: 'dev-gh', title: 'Add webhooks', url: 'https://github.com/octo-owner/devorbit/pull/7', action: 'merged' }, 1),
      ],
      nextBefore: null,
    });

    render(<ActivityPanel projectId="p1" />);

    expect(await screen.findByText('Commit pushed', { selector: 'b' })).toBeTruthy();
    expect(screen.getByText('octocat pushed commit "Fix login bug" to main')).toBeTruthy();
    expect(screen.getByText('Pull request merged', { selector: 'b' })).toBeTruthy(); // [Sprint 6 · M1] D2
    expect(screen.getByText('dev-gh merged pull request #7 "Add webhooks"')).toBeTruthy();

    const links = screen.getAllByRole('link', { name: /open on github/i });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe(COMMIT_URL);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
    expect(links[0].getAttribute('rel')).toContain('noreferrer');
  });

  it('never links to a non-GitHub URL', async () => {
    mocks.project.mockResolvedValue({
      activity: [githubEvent('g3', 'github.issue', 'opened issue #1 "x"', { author: 'octocat', title: 'x', url: 'javascript:alert(1)' })],
      nextBefore: null,
    });
    render(<ActivityPanel projectId="p1" />);
    expect(await screen.findByText('octocat opened issue #1 "x"')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /open on github/i })).toBeNull();
  });

  // [Sprint 6 · M1] D2: the exact case from the Sprint 4 exit checks.
  it('an opened issue is titled "GitHub issue opened", not "GitHub issue updated"', async () => {
    mocks.project.mockResolvedValue({
      activity: [githubEvent('g4', 'github.issue', 'opened issue #1 "Login fails"', {
        author: 'octocat', title: 'Login fails', url: 'https://github.com/octo-owner/devorbit/issues/1', action: 'opened', number: 1,
      })],
      nextBefore: null,
    });
    render(<ActivityPanel projectId="p1" />);
    expect(await screen.findByText('GitHub issue opened', { selector: 'b' })).toBeTruthy();
    expect(screen.queryByText('GitHub issue updated', { selector: 'b' })).toBeNull();
    expect(screen.getByText('octocat opened issue #1 "Login fails"')).toBeTruthy();
  });
});

describe('GithubWebhookStatus', () => {
  it('shows an active webhook', () => {
    render(<GithubWebhookStatus projectId="p1" webhook={{ status: 'active', message: 'Commits, issues and pull requests from this repository now appear in the Activity feed.' }} />);
    expect(screen.getByText('Webhook active')).toBeTruthy();
    expect(screen.getByText(/now appear in the Activity feed/)).toBeTruthy();
  });

  it('explains why the webhook is not set up', () => {
    render(<GithubWebhookStatus projectId="p1" webhook={{ status: 'not_admin', message: 'Webhook not set up: the authorized GitHub account is not an admin of this repository, so it cannot add a webhook.' }} />);
    expect(screen.getAllByText(/Webhook not set up/).length).toBeGreaterThan(0);
    expect(screen.getByText(/not an admin/)).toBeTruthy();
  });

  it('loads recent deliveries when opened', async () => {
    const api = {
      deliveries: vi.fn(() => Promise.resolve({
        deliveries: [
          { deliveryId: 'd1', event: 'push', action: '', status: 'processed', entries: 2, receivedAt: new Date().toISOString() },
          { deliveryId: 'd2', event: 'issues', action: 'labeled', status: 'ignored', reason: 'Nothing in this event is shown in the feed.', receivedAt: new Date().toISOString() },
          { deliveryId: 'd3', event: 'pull_request', action: 'opened', status: 'failed', lastError: 'Error: Could not save the feed entry.', receivedAt: new Date().toISOString() },
        ],
      })),
    };
    const { container } = render(<GithubWebhookStatus projectId="p1" webhook={{ status: 'active', message: '' }} api={api} />);
    const details = container.querySelector('details');
    details.open = true;
    fireEvent(details, new Event('toggle'));

    await waitFor(() => expect(api.deliveries).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Added to feed')).toBeTruthy();
    expect(screen.getByText(/2 new entries/)).toBeTruthy();
    expect(screen.getByText('Ignored')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText(/Could not save the feed entry/)).toBeTruthy();
  });
});

describe('GithubIntegrationPanel webhook status', () => {
  it('shows the webhook status under the Active repository', async () => {
    const api = {
      status: vi.fn(() => Promise.resolve({
        configured: true,
        canAuthorize: true,
        canSelectRepository: true,
        connectionState: 'active',
        active: true,
        connection: { githubLogin: 'octo-owner', scopes: ['repo'], authorizedAt: '2026-11-01T10:00:00.000Z', authorizedBy: { _id: 'u1', name: 'Riya Kapoor' } },
        repository: { id: 101, fullName: 'octo-owner/devorbit', htmlUrl: 'https://github.com/octo-owner/devorbit', private: false },
        webhook: { status: 'active', message: 'Commits, issues and pull requests from this repository now appear in the Activity feed.', events: ['push', 'issues', 'pull_request'] },
      })),
      authorize: vi.fn(),
      deliveries: vi.fn(() => Promise.resolve({ deliveries: [] })),
    };
    render(
      <MemoryRouter initialEntries={['/project/p1']}>
        <Routes>
          <Route path="/project/:id" element={<GithubIntegrationPanel projectId="p1" api={api} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText('Webhook active')).toBeTruthy();
    expect(screen.getByText('Recent deliveries')).toBeTruthy();
  });
});
