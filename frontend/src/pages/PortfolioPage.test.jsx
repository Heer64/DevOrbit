// [Sprint 5 · M5] US-49 AC3: the shareable, read-only portfolio page.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PortfolioPage from './PortfolioPage';

const portfolio = {
  user: { name: 'Max Member', username: 'max_member', headline: 'Backend engineer', avatarUrl: '' },
  projects: [
    { name: 'Open Garden', description: 'Community gardening app', domain: 'Community', tags: [], role: 'Contributor', completedAt: '2026-11-01T00:00:00.000Z', isPrivate: false, stats: { tasksCompleted: 3, decisionsRecorded: 2, messagesPosted: 5, computedAt: new Date().toISOString() } },
    { name: 'Private project', description: '', domain: 'Research', tags: [], role: 'Admin', completedAt: '2026-10-20T00:00:00.000Z', isPrivate: true, stats: { tasksCompleted: 1, decisionsRecorded: 0, messagesPosted: 2, computedAt: new Date().toISOString() } },
  ],
  totals: { projects: 2, tasksCompleted: 4, decisionsRecorded: 2, messagesPosted: 7 },
  statsUpdatedAt: new Date().toISOString(),
};

function renderPage(api, path = '/portfolio/max_member') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/portfolio/:username" element={<PortfolioPage api={api} />} /></Routes>
    </MemoryRouter>
  );
}

describe('PortfolioPage', () => {
  it('loads the portfolio for the username in the link and shows each project with role and numbers', async () => {
    const api = { shared: vi.fn(() => Promise.resolve(portfolio)) };
    renderPage(api);
    expect(await screen.findByRole('heading', { name: 'Max Member' })).toBeTruthy();
    expect(api.shared).toHaveBeenCalledWith('max_member');
    expect(screen.getByText('Open Garden')).toBeTruthy();
    expect(screen.getByText('Contributor')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByLabelText(/My contribution to Open Garden: 3 tasks completed · 2 decisions recorded · 5 messages posted/)).toBeTruthy();
    expect(screen.getByText(/updated just now/)).toBeTruthy();
  });

  it('is read-only: no links into projects, no buttons', async () => {
    renderPage({ shared: () => Promise.resolve(portfolio) });
    await screen.findByText('Open Garden');
    expect(screen.queryByRole('link', { name: 'Open Garden' })).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('a private or unknown portfolio says it is not available and shows nothing else', async () => {
    const error = Object.assign(new Error('This portfolio is not available.'), { status: 404 });
    renderPage({ shared: () => Promise.reject(error) });
    expect((await screen.findByRole('alert')).textContent).toBe('This portfolio is not available.');
    expect(screen.queryByText('Open Garden')).toBeNull();
  });

  it('shows other errors as they come', async () => {
    renderPage({ shared: () => Promise.reject(Object.assign(new Error('Server is down'), { status: 500 })) });
    expect((await screen.findByRole('alert')).textContent).toBe('Server is down');
  });

  it('an empty portfolio says so', async () => {
    renderPage({ shared: () => Promise.resolve({ ...portfolio, projects: [], totals: { projects: 0, tasksCompleted: 0, decisionsRecorded: 0, messagesPosted: 0 }, statsUpdatedAt: null }) });
    expect(await screen.findByText('Max Member has no completed projects yet.')).toBeTruthy();
  });
});
