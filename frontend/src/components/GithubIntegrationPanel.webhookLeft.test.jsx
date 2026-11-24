// [Sprint 7 · M8] D4: after Disconnect the Owner/Admin is told when the webhook is still on GitHub.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GithubIntegrationPanel, { LEFT_WEBHOOK_TEXT, leftWebhookFrom } from './GithubIntegrationPanel';

const P = 'p'.repeat(24);
const by = { _id: 'u1', name: 'Riya Kapoor', username: 'riyak' };
const repository = { id: 101, name: 'devorbit', fullName: 'octo-owner/devorbit', owner: 'octo-owner', private: true, htmlUrl: 'https://github.com/octo-owner/devorbit', defaultBranch: 'main', connectedAt: '2026-11-01T07:00:00.000Z', connectedBy: by };
const connection = { githubLogin: 'octo-owner', scopes: ['repo'], authorizedAt: '2026-10-31T10:00:00.000Z', authorizedBy: by };
const SETTINGS = 'https://github.com/octo-owner/devorbit/settings/hooks';
const leftWebhook = { repositoryFullName: 'octo-owner/devorbit', settingsUrl: SETTINGS, reason: 'github_refused', at: '2026-11-22T09:00:00.000Z', message: LEFT_WEBHOOK_TEXT };

const status = (extra = {}) => ({
  configured: true, canAuthorize: true, connection, repository, connectionState: 'active', active: true,
  canSelectRepository: true, canReauthorize: true, canDisconnect: true, canVerify: true, acceptingEvents: true,
  disconnectedAt: null, disconnectedBy: null, needsReauthorization: false, reauthorizationReason: null,
  lastCheckedAt: null, repositoryAccess: null, webhook: null, webhookLeftOnGithub: false, leftWebhook: null,
  ...extra,
});
const disconnected = (extra = {}) => status({
  connectionState: 'disconnected', active: false, canSelectRepository: false, canDisconnect: false, canVerify: false,
  acceptingEvents: false, disconnectedAt: '2026-11-22T09:00:00.000Z', disconnectedBy: by, ...extra,
});

function fakeApi(initial, overrides = {}) {
  return {
    status: vi.fn(() => Promise.resolve(initial)),
    authorize: vi.fn(),
    repositories: vi.fn(),
    selectRepository: vi.fn(),
    disconnect: vi.fn(() => Promise.resolve({ ...disconnected(), revokedOnGithub: true, webhookRemoved: true })),
    verify: vi.fn(),
    ...overrides,
  };
}

function renderPanel(api) {
  render(
    <MemoryRouter initialEntries={[`/project/${P}`]}>
      <Routes><Route path="/project/:id" element={<GithubIntegrationPanel projectId={P} api={api} />} /></Routes>
    </MemoryRouter>
  );
}

describe('D4: webhook left on GitHub after Disconnect', () => {
  it('after Disconnect where GitHub refused, warns and links to the repository\'s webhook settings', async () => {
    const api = fakeApi(status(), {
      disconnect: vi.fn(() => Promise.resolve({ ...disconnected({ webhookLeftOnGithub: true, leftWebhook }), revokedOnGithub: false, webhookRemoved: false })),
    });
    renderPanel(api);
    fireEvent.click(await screen.findByRole('button', { name: /^disconnect$/i }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));

    const warning = await screen.findByTestId('github-webhook-left');
    expect(warning.getAttribute('role')).toBe('alert');
    expect(warning.textContent).toContain(LEFT_WEBHOOK_TEXT);
    expect(warning.textContent).toContain('octo-owner/devorbit');
    const link = within(warning).getByRole('link', { name: /Open webhook settings on GitHub/ });
    expect(link.getAttribute('href')).toBe(SETTINGS);
    expect(link.getAttribute('target')).toBe('_blank');
    // The normal "Disconnected" confirmation is still shown.
    expect(screen.getByText(/GitHub was disconnected from this project/)).toBeTruthy();
  });

  it('is still shown after a reload (the API keeps it) until GitHub is connected again', async () => {
    renderPanel(fakeApi(disconnected({ webhookLeftOnGithub: true, leftWebhook })));
    expect((await screen.findByTestId('github-webhook-left')).textContent).toContain(LEFT_WEBHOOK_TEXT);
  });

  it('no warning when the webhook was removed normally (or there was none / it is shared)', async () => {
    renderPanel(fakeApi(status()));
    fireEvent.click(await screen.findByRole('button', { name: /^disconnect$/i }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    await screen.findByText(/GitHub was disconnected from this project/);
    expect(screen.queryByTestId('github-webhook-left')).toBeNull();
    expect(screen.queryByText(LEFT_WEBHOOK_TEXT)).toBeNull();
  });

  it('never shown while connected, and only github.com settings links are used', async () => {
    renderPanel(fakeApi(status({ leftWebhook })));
    await screen.findByText('Active');
    expect(screen.queryByTestId('github-webhook-left')).toBeNull();

    expect(leftWebhookFrom({ leftWebhook })).toEqual({ repositoryFullName: 'octo-owner/devorbit', settingsUrl: SETTINGS });
    expect(leftWebhookFrom({ leftWebhook: { ...leftWebhook, settingsUrl: 'https://evil.example.com/settings/hooks' } }).settingsUrl).toBe(null);
    expect(leftWebhookFrom({ leftWebhook: null })).toBe(null);
    expect(leftWebhookFrom(null)).toBe(null);
  });
});
