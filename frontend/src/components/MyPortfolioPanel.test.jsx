// [Sprint 5 · M5] US-49: "My portfolio" on the Profile page.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MyPortfolioPanel, { shareUrl } from './MyPortfolioPanel';
import { formatCompletedDate, statsLine } from './PortfolioView';

const P1 = 'a'.repeat(24);
const mine = (overrides = {}) => ({
  user: { name: 'Max Member', username: 'max_member', headline: '', avatarUrl: '' },
  projects: [
    { _id: P1, name: 'Open Garden', description: 'Community gardening app', domain: 'Community', tags: [], role: 'Contributor', completedAt: '2026-11-01T00:00:00.000Z', isPrivate: false, stats: { tasksCompleted: 3, decisionsRecorded: 2, messagesPosted: 5, computedAt: new Date().toISOString() } },
    { _id: 'b'.repeat(24), name: 'Secret Lab', description: 'Internal research', domain: 'Research', tags: [], role: 'Admin', completedAt: '2026-10-20T00:00:00.000Z', isPrivate: true, stats: { tasksCompleted: 1, decisionsRecorded: 0, messagesPosted: 2, computedAt: new Date().toISOString() } },
  ],
  totals: { projects: 2, tasksCompleted: 4, decisionsRecorded: 2, messagesPosted: 7 },
  statsUpdatedAt: new Date().toISOString(),
  isPublic: true,
  sharePath: '/portfolio/max_member',
  ...overrides,
});

const renderPanel = (props) => render(<MemoryRouter><MyPortfolioPanel {...props} /></MemoryRouter>);

describe('MyPortfolioPanel', () => {
  it('AC1: lists my Completed projects with my role, each linking to its workspace', async () => {
    renderPanel({ api: { mine: () => Promise.resolve(mine()) } });
    const link = await screen.findByRole('link', { name: 'Open Garden' });
    expect(link.getAttribute('href')).toBe(`/project/${P1}`);
    expect(screen.getByText('Contributor')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByText('Secret Lab')).toBeTruthy();
    expect(screen.getByText('Completed 1 Nov 2026')).toBeTruthy();
  });

  it('AC2: shows tasks completed, decisions recorded and messages posted per project, with how fresh they are', async () => {
    renderPanel({ api: { mine: () => Promise.resolve(mine()) } });
    expect(await screen.findByLabelText('My contribution to Open Garden: 3 tasks completed · 2 decisions recorded · 5 messages posted')).toBeTruthy();
    expect(screen.getByLabelText('My contribution to Secret Lab: 1 task completed · 0 decisions recorded · 2 messages posted')).toBeTruthy();
    expect(screen.getByLabelText('Portfolio totals').textContent).toContain('7');
    expect(screen.getByText(/Contribution numbers updated just now/)).toBeTruthy();
  });

  it('AC3: a public portfolio shows its link, and Copy link copies it', async () => {
    const copyText = vi.fn(() => Promise.resolve());
    renderPanel({ api: { mine: () => Promise.resolve(mine()) }, copyText });
    const input = await screen.findByLabelText('Portfolio link');
    expect(input.value).toBe(`${window.location.origin}/portfolio/max_member`);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect((await screen.findByRole('status')).textContent).toBe('Link copied.');
    expect(copyText).toHaveBeenCalledWith(`${window.location.origin}/portfolio/max_member`);
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/portfolio/max_member');
    expect(screen.getByText('Public')).toBeTruthy();
  });

  it('if copying fails, it says how to copy by hand', async () => {
    renderPanel({ api: { mine: () => Promise.resolve(mine()) }, copyText: () => Promise.reject(new Error('denied')) });
    fireEvent.click(await screen.findByRole('button', { name: /copy link/i }));
    expect((await screen.findByRole('status')).textContent).toMatch(/copy it/);
  });

  it('a private portfolio hides the link and says what visitors will see', async () => {
    renderPanel({ api: { mine: () => Promise.resolve(mine({ isPublic: false })) } });
    expect(await screen.findByText(/Your portfolio is private/)).toBeTruthy();
    expect(screen.queryByLabelText('Portfolio link')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByText('Open Garden')).toBeTruthy();
  });

  it('with no Completed projects it explains when they will appear', async () => {
    renderPanel({ api: { mine: () => Promise.resolve(mine({ projects: [], totals: { projects: 0, tasksCompleted: 0, decisionsRecorded: 0, messagesPosted: 0 }, statsUpdatedAt: null })) } });
    expect(await screen.findByText(/When a project you belong to is marked Completed/)).toBeTruthy();
  });

  it('shows a load error', async () => {
    renderPanel({ api: { mine: () => Promise.reject(new Error('Could not reach the server')) } });
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server');
  });
});

describe('portfolio helpers', () => {
  it('statsLine uses singular and plural correctly', () => {
    expect(statsLine({ tasksCompleted: 1, decisionsRecorded: 1, messagesPosted: 1 })).toBe('1 task completed · 1 decision recorded · 1 message posted');
    expect(statsLine({})).toBe('0 tasks completed · 0 decisions recorded · 0 messages posted');
  });

  it('formatCompletedDate shows the UTC day and ignores bad dates', () => {
    expect(formatCompletedDate('2026-11-01T00:00:00.000Z')).toBe('1 Nov 2026');
    expect(formatCompletedDate('nope')).toBe('');
  });

  it('shareUrl joins the site address and the share path', () => {
    expect(shareUrl('/portfolio/max', 'https://devorbit.app')).toBe('https://devorbit.app/portfolio/max');
  });
});
