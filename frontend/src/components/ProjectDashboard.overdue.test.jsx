// [Sprint 7 · M7] FR-15: overdue tasks on the project dashboard.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ dashboardApi: { project: vi.fn() }, taskApi: { subscribe: vi.fn(() => () => {}) } }));
vi.mock('../api', () => ({ dashboardApi: mocks.dashboardApi, taskApi: mocks.taskApi }));

import ProjectDashboard, { overdueLabel } from './ProjectDashboard';

const P = 'a'.repeat(24);
const base = {
  project: { _id: P, name: 'Orbit', status: 'In progress' },
  membershipRole: 'Viewer',
  milestones: { total: 0, completed: 0, items: [] },
  tasks: { total: 5, open: 4, done: 1, byStatus: { 'To do': 2, 'In progress': 1, Blocked: 1, Done: 1 } },
  dueSoon: { days: 7, from: '2026-11-20', to: '2026-11-27', total: 0, limit: 50, tasks: [] },
  generatedAt: '2026-11-20T10:00:00.000Z',
};
const overdue = {
  total: 3,
  limit: 2,
  tasks: [
    {
      _id: 't1',
      title: 'Write API docs',
      status: 'To do',
      priority: 'High',
      dueDate: '2026-11-10T00:00:00.000Z',
      daysOverdue: 10,
      assignee: { _id: 'u1', name: 'Riya Kapoor' },
      milestone: { _id: 'm1', title: 'MVP' },
    },
    {
      _id: 't2',
      title: 'Fix login bug',
      status: 'Blocked',
      priority: 'Medium',
      dueDate: '2026-11-19T00:00:00.000Z',
      daysOverdue: 1,
      assignee: null,
      milestone: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Project dashboard: overdue (FR-15)', () => {
  it('shows an Overdue tile and lists overdue tasks with how late they are', async () => {
    mocks.dashboardApi.project.mockResolvedValue({ ...base, overdue });
    render(<ProjectDashboard projectId={P} />);
    const section = await screen.findByRole('region', { name: 'Overdue' });
    const rows = within(section).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('10 days overdue');
    expect(rows[0].textContent).toContain('Write API docs');
    expect(rows[0].textContent).toContain('Riya Kapoor · MVP');
    expect(rows[1].textContent).toContain('1 day overdue');
    expect(rows[1].textContent).toContain('Unassigned');
    expect(within(section).getByText('+1 more overdue task. See the Tasks tab for all of them.')).toBeTruthy();
    const tile = screen.getByText('Overdue', { selector: '.pd-stat-top p' }).closest('.pd-stat');
    expect(within(tile).getByText('3')).toBeTruthy();
  });

  it('clicking an overdue task opens it', async () => {
    mocks.dashboardApi.project.mockResolvedValue({ ...base, overdue });
    const onOpenTask = vi.fn();
    render(<ProjectDashboard projectId={P} onOpenTask={onOpenTask} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open overdue task Fix login bug' }));
    expect(onOpenTask).toHaveBeenCalledWith('t2');
  });

  it('nothing overdue says so', async () => {
    mocks.dashboardApi.project.mockResolvedValue({ ...base, overdue: { total: 0, limit: 50, tasks: [] } });
    render(<ProjectDashboard projectId={P} />);
    const section = await screen.findByRole('region', { name: 'Overdue' });
    expect(within(section).getByText('Nothing is overdue. Nice work.')).toBeTruthy();
  });

  it('an older server without overdue data simply shows no overdue section', async () => {
    mocks.dashboardApi.project.mockResolvedValue(base);
    render(<ProjectDashboard projectId={P} />);
    await screen.findByText('Open tasks');
    expect(screen.queryByRole('region', { name: 'Overdue' })).toBeNull();
  });

  it('overdueLabel', () => {
    expect(overdueLabel(1)).toBe('1 day overdue');
    expect(overdueLabel(12)).toBe('12 days overdue');
    expect(overdueLabel(undefined)).toBe('1 day overdue');
  });
});
