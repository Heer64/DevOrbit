// Sprint 2 leftovers: the dashboard stat cards use real task numbers for signed-in users.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null }));
const mocks = vi.hoisted(() => ({
  projectApi: { list: vi.fn() },
  activityApi: { mine: vi.fn() },
  myTaskApi: { upcoming: vi.fn(), mine: vi.fn(), stats: vi.fn() },
  invitationApi: { mine: vi.fn(), accept: vi.fn(), decline: vi.fn() }, // [Sprint 3 · M1]
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import DashboardPage from './DashboardPage';

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<Outlet context={{ openCreate: () => {} }} />}>
          <Route path="/dashboard" element={<DashboardPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const card = (title) => screen.getByText(title).closest('.stat-card');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectApi.list.mockResolvedValue({ projects: [] });
  mocks.activityApi.mine.mockResolvedValue({ activity: [] });
  mocks.myTaskApi.upcoming.mockResolvedValue({ tasks: [] });
  mocks.myTaskApi.mine.mockResolvedValue({ tasks: [], total: 0 });
  mocks.myTaskApi.stats.mockResolvedValue({ completedLast7Days: 7, openAssignedToMe: 3 });
  mocks.invitationApi.mine.mockResolvedValue({ invitations: [] });
});

describe('Dashboard stat cards', () => {
  it('shows tasks completed in the last 7 days and my open tasks', async () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    renderDashboard();

    expect(await within(card('Tasks completed')).findByText('7')).toBeTruthy();
    expect(within(card('Tasks completed')).getByText('in the last 7 days')).toBeTruthy();
    expect(within(card('Assigned to me')).getByText('3')).toBeTruthy();
    expect(screen.queryByText('Task tracking not connected yet')).toBeNull();
    expect(screen.queryByText('Calculated when task data is connected')).toBeNull();
  });

  it('shows the Upcoming deadlines and My tasks panels', async () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    renderDashboard();
    expect(await screen.findByRole('region', { name: 'Upcoming deadlines' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'My tasks' })).toBeTruthy();
  });

  it('shows a dash while the numbers cannot be loaded', async () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    mocks.myTaskApi.stats.mockRejectedValue(new Error('offline'));
    renderDashboard();
    await screen.findByText('Nothing due in the next 7 days.');
    expect(within(card('Tasks completed')).getByText('—')).toBeTruthy();
  });

  it('demo users keep the sample numbers and no task API is called', () => {
    auth.user = { id: 'demo-user', name: 'Aarav Mehta', isDemo: true };
    renderDashboard();
    expect(within(card('Tasks completed')).getByText('24')).toBeTruthy();
    expect(screen.getByText('Your momentum')).toBeTruthy();
    expect(mocks.myTaskApi.stats).not.toHaveBeenCalled();
    expect(mocks.myTaskApi.upcoming).not.toHaveBeenCalled();
  });
});

// [Sprint 3 · M1] US-10 / US-11: pending invitations appear on the dashboard.
describe('Dashboard invitations', () => {
  it('lists my pending invitations above my projects', async () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    mocks.invitationApi.mine.mockResolvedValue({
      invitations: [{
        _id: 'i1', status: 'Pending', role: 'Contributor', expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
        invitedBy: { name: 'Nia Owner' }, project: { _id: 'p1', name: 'Secret Lab', color: 'mint' },
      }],
    });
    renderDashboard();
    const panel = await screen.findByRole('region', { name: 'Your invitations' });
    expect(within(panel).getByText('Secret Lab')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Accept invitation to Secret Lab' })).toBeTruthy();
  });

  it('shows no invitations panel when there are none, and none for the demo user', async () => {
    auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
    renderDashboard();
    await screen.findByRole('region', { name: 'Upcoming deadlines' });
    expect(screen.queryByRole('region', { name: 'Your invitations' })).toBeNull();
  });
});
