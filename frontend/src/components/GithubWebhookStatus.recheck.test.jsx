// [Sprint 7 · M8] Missed events: "Check for missed events" under an active webhook (Owner/Admin panel).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GithubWebhookStatus from './GithubWebhookStatus';

const P = 'p'.repeat(24);
const activeHook = { status: 'active', message: 'Commits, issues and pull requests from this repository now appear in the Activity feed.', events: ['push', 'issues', 'pull_request'], updatedAt: null };

describe('Check for missed events', () => {
  it('asks the server and shows what happened', async () => {
    const api = {
      deliveries: vi.fn(() => Promise.resolve({ deliveries: [] })),
      recheckMissedEvents: vi.fn(() => Promise.resolve({ checked: 4, redelivered: 2, message: 'Asked GitHub to send 2 missed events again. They appear in the Activity feed within a few seconds.' })),
    };
    render(<GithubWebhookStatus projectId={P} webhook={activeHook} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: /check for missed events/i }));
    expect(screen.getByRole('button', { name: /checking github/i }).disabled).toBe(true);
    expect((await screen.findByRole('status')).textContent).toBe('Asked GitHub to send 2 missed events again. They appear in the Activity feed within a few seconds.');
    expect(api.recheckMissedEvents).toHaveBeenCalledWith(P);
    expect(screen.getByRole('button', { name: /check for missed events/i }).disabled).toBe(false);
  });

  it('nothing missed', async () => {
    const api = { recheckMissedEvents: vi.fn(() => Promise.resolve({ checked: 3, redelivered: 0, message: 'No missed GitHub events in the last 24 hours.' })) };
    render(<GithubWebhookStatus projectId={P} webhook={activeHook} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: /check for missed events/i }));
    expect((await screen.findByRole('status')).textContent).toBe('No missed GitHub events in the last 24 hours.');
  });

  it('shows the server\'s reason when it cannot check (e.g. re-authorize first)', async () => {
    const api = { recheckMissedEvents: vi.fn(() => Promise.reject(new Error('GitHub no longer accepts this project\'s authorization. Re-authorize GitHub.'))) };
    render(<GithubWebhookStatus projectId={P} webhook={activeHook} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: /check for missed events/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Re-authorize GitHub/);
    await waitFor(() => expect(screen.getByRole('button', { name: /check for missed events/i }).disabled).toBe(false));
  });

  it('only for an active webhook', () => {
    const api = { recheckMissedEvents: vi.fn() };
    render(<GithubWebhookStatus projectId={P} webhook={{ status: 'not_admin', message: 'Webhook not set up' }} api={api} />);
    expect(screen.queryByRole('button', { name: /check for missed events/i })).toBeNull();
  });

  it('not shown with an API that cannot do it', () => {
    render(<GithubWebhookStatus projectId={P} webhook={activeHook} api={{ deliveries: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: /check for missed events/i })).toBeNull();
  });
});
