// [Sprint 4 · M7] US-39: project dashboard tab (milestone progress, open tasks, due in the next 7 days).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  dashboardApi: { project: vi.fn() },
  taskApi: { subscribe: vi.fn() },
  live: { onUpdated: null, onDeleted: null, stop: vi.fn() },
}));
vi.mock('../api', () => ({ dashboardApi: mocks.dashboardApi, taskApi: mocks.taskApi }));

import ProjectDashboard, { daysFromToday, formatDueDay, relativeDueLabel } from './ProjectDashboard';

const P = 'a'.repeat(24);

function dashboard(overrides = {}) {
  return {
    project: { _id: P, name: 'Orbit', status: 'In progress' },
    membershipRole: 'Viewer',
    milestones: {
      total: 3,
      completed: 1,
      items: [
        { _id: 'm1', title: 'MVP', dueDate: '2026-11-10T00:00:00.000Z', taskCount: 3, doneCount: 2, progress: 67, completed: false },
        { _id: 'm2', title: 'Beta', dueDate: '2026-11-30T00:00:00.000Z', taskCount: 1, doneCount: 1, progress: 100, completed: true },
        { _id: 'm3', title: 'Later', dueDate: null, taskCount: 0, doneCount: 0, progress: 0, completed: false },
      ],
    },
    tasks: { total: 9, open: 6, done: 3, byStatus: { 'To do': 3, 'In progress': 2, Blocked: 1, Done: 3 } },
    dueSoon: {
      days: 7,
      from: '2026-10-31',
      to: '2026-11-07',
      total: 3,
      limit: 50,
      tasks: [
        { _id: 't1', title: 'Write API docs', status: 'To do', priority: 'High', dueDate: '2026-10-31T00:00:00.000Z', assignee: { _id: 'u1', name: 'Riya Kapoor' }, milestone: { _id: 'm1', title: 'MVP' } },
        { _id: 't2', title: 'Fix login bug', status: 'Blocked', priority: 'Medium', dueDate: '2026-11-01T00:00:00.000Z', assignee: null, milestone: null },
        { _id: 't3', title: 'Prepare demo', status: 'In progress', priority: 'Low', dueDate: '2026-11-07T00:00:00.000Z', assignee: null, milestone: null },
      ],
    },
    generatedAt: '2026-10-31T10:09:00.000Z',
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.live.onUpdated = null;
  mocks.live.onDeleted = null;
  mocks.taskApi.subscribe.mockImplementation((_id, onUpdated, onDeleted) => {
    mocks.live.onUpdated = onUpdated;
    mocks.live.onDeleted = onDeleted;
    return mocks.live.stop;
  });
  mocks.dashboardApi.project.mockResolvedValue(dashboard());
});

describe('dashboard date helpers', () => {
  it('shows stored due days in UTC, whatever the viewer timezone', () => {
    expect(formatDueDay('2026-10-31T00:00:00.000Z')).toBe('Sat, Oct 31');
    expect(formatDueDay('2026-11-07T00:00:00.000Z', true)).toBe('Sat, Nov 7, 2026');
    expect(formatDueDay(null)).toBe('No due date');
    expect(formatDueDay('nope')).toBe('No due date');
  });

  it('counts days from the server window start, including the day-7 boundary', () => {
    expect(daysFromToday('2026-10-31T00:00:00.000Z', '2026-10-31')).toBe(0);
    expect(daysFromToday('2026-11-01T00:00:00.000Z', '2026-10-31')).toBe(1);
    expect(daysFromToday('2026-11-07T00:00:00.000Z', '2026-10-31')).toBe(7);
    expect(daysFromToday('2026-03-30T00:00:00.000Z', '2026-03-28')).toBe(2); // across a DST change elsewhere
    expect(daysFromToday(null, '2026-10-31')).toBeNull();
    expect(daysFromToday('2026-10-31T00:00:00.000Z', '')).toBeNull();
  });

  it('turns day counts into labels', () => {
    expect(relativeDueLabel(0)).toBe('Today');
    expect(relativeDueLabel(1)).toBe('Tomorrow');
    expect(relativeDueLabel(7)).toBe('In 7 days');
    expect(relativeDueLabel(-1)).toBe('Overdue');
    expect(relativeDueLabel(null)).toBe('');
  });
});

describe('ProjectDashboard', () => {
  it('shows a loading state, then the numbers from the API', async () => {
    const pending = deferred();
    mocks.dashboardApi.project.mockReturnValueOnce(pending.promise);
    render(<ProjectDashboard projectId={P} />);

    expect(screen.getByRole('status').textContent).toContain('Loading dashboard…');
    expect(mocks.dashboardApi.project).toHaveBeenCalledWith(P);

    await act(async () => { pending.resolve(dashboard()); });
    expect(screen.getByRole('heading', { name: 'Milestone progress' })).toBeTruthy();
  });

  it('shows the open task count with its status breakdown', async () => {
    render(<ProjectDashboard projectId={P} />);
    const tile = (await screen.findByText('Open tasks')).closest('.pd-stat');
    expect(within(tile).getByText('6')).toBeTruthy();
    expect(within(tile).getByText('of 9 tasks not Done')).toBeTruthy();
    const byStatus = within(tile).getByRole('list', { name: 'Open tasks by status' });
    expect(within(byStatus).getByText('To do').nextSibling.textContent).toContain('3');
    expect(within(byStatus).getByText('In progress').nextSibling.textContent).toContain('2');
    expect(within(byStatus).getByText('Blocked').nextSibling.textContent).toContain('1');
    expect(within(byStatus).queryByText('Done')).toBeNull();
  });

  it('shows a progress bar and percentage for every milestone', async () => {
    render(<ProjectDashboard projectId={P} />);
    const mvp = await screen.findByRole('progressbar', { name: 'MVP progress' });
    expect(mvp.getAttribute('aria-valuenow')).toBe('67');
    expect(mvp.firstChild.style.width).toBe('67%');
    expect(screen.getByRole('progressbar', { name: 'Beta progress' }).getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByRole('progressbar', { name: 'Later progress' }).getAttribute('aria-valuenow')).toBe('0');

    const list = screen.getByRole('region', { name: 'Milestone progress' });
    expect(within(list).getByText('67%')).toBeTruthy();
    expect(within(list).getByText(/2 of 3 tasks done/)).toBeTruthy();
    expect(within(list).getByText(/No tasks attached yet/)).toBeTruthy();
    expect(within(list).getByText(/Completed/)).toBeTruthy();

    const tile = screen.getByText('Milestones completed').closest('.pd-stat');
    expect(within(tile).getByText('1 / 3')).toBeTruthy();
  });

  it('lists tasks due in the next 7 days with title, due date and status', async () => {
    render(<ProjectDashboard projectId={P} />);
    const region = await screen.findByRole('region', { name: 'Due in the next 7 days' });
    const rows = within(region).getAllByRole('button', { name: /^Open task / });
    expect(rows).toHaveLength(3);

    expect(rows[0].textContent).toContain('Write API docs');
    expect(rows[0].textContent).toContain('Today');
    expect(rows[0].textContent).toContain('Sat, Oct 31');
    expect(rows[0].textContent).toContain('To do');
    expect(rows[0].textContent).toContain('Riya Kapoor · MVP');

    expect(rows[1].textContent).toContain('Tomorrow');
    expect(rows[1].textContent).toContain('Blocked');
    expect(rows[1].textContent).toContain('Unassigned');

    expect(rows[2].textContent).toContain('In 7 days');
    expect(rows[2].textContent).toContain('Sat, Nov 7');

    const tile = screen.getByText('Due in the next 7 days', { selector: '.pd-stat p' }).closest('.pd-stat');
    expect(within(tile).getByText('3')).toBeTruthy();
    expect(within(tile).getByText('Sat, Oct 31 – Sat, Nov 7')).toBeTruthy();
  });

  it('opens a task and the Milestones tab through the callbacks', async () => {
    const onOpenTask = vi.fn();
    const onOpenMilestones = vi.fn();
    render(<ProjectDashboard projectId={P} onOpenTask={onOpenTask} onOpenMilestones={onOpenMilestones} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Fix login bug' }));
    expect(onOpenTask).toHaveBeenCalledWith('t2');
    fireEvent.click(screen.getByRole('button', { name: 'Open milestones' }));
    expect(onOpenMilestones).toHaveBeenCalled();
  });

  it('says how many more tasks are due when the list is cut off', async () => {
    const data = dashboard();
    data.dueSoon.total = 55;
    mocks.dashboardApi.project.mockResolvedValue(data);
    render(<ProjectDashboard projectId={P} />);
    expect(await screen.findByText(/\+52 more tasks due in the next 7 days/)).toBeTruthy();
  });

  it('empty project: zero counts and friendly empty states', async () => {
    mocks.dashboardApi.project.mockResolvedValue(dashboard({
      milestones: { total: 0, completed: 0, items: [] },
      tasks: { total: 0, open: 0, done: 0, byStatus: { 'To do': 0, 'In progress': 0, Blocked: 0, Done: 0 } },
      dueSoon: { days: 7, from: '2026-10-31', to: '2026-11-07', total: 0, limit: 50, tasks: [] },
    }));
    render(<ProjectDashboard projectId={P} />);

    expect(await screen.findByText(/No milestones yet\. Owners and Admins can create them/)).toBeTruthy();
    expect(screen.getByText('No tasks yet. Add tasks with due dates to see deadlines here.')).toBeTruthy();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    const tile = screen.getByText('Open tasks').closest('.pd-stat');
    expect(tile.querySelector('.pd-stat-value').textContent).toBe('0');
    expect(within(tile).getByText('No tasks yet')).toBeTruthy();
  });

  it('tasks exist but none are due this week', async () => {
    mocks.dashboardApi.project.mockResolvedValue(dashboard({ dueSoon: { days: 7, from: '2026-10-31', to: '2026-11-07', total: 0, limit: 50, tasks: [] } }));
    render(<ProjectDashboard projectId={P} />);
    expect(await screen.findByText('Nothing is due in the next 7 days.')).toBeTruthy();
  });

  it('shows an error with Try again, and recovers', async () => {
    mocks.dashboardApi.project.mockRejectedValueOnce(Object.assign(new Error('Server is down.'), { status: 500 }));
    render(<ProjectDashboard projectId={P} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Server is down.');

    fireEvent.click(within(alert).getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('heading', { name: 'Milestone progress' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a 403 explains the dashboard is for members only', async () => {
    mocks.dashboardApi.project.mockRejectedValueOnce(Object.assign(new Error('You are not a member of this project.'), { status: 403 }));
    render(<ProjectDashboard projectId={P} />);
    expect((await screen.findByRole('alert')).textContent).toContain('visible to project members only');
  });

  it('keeps the last numbers if a refresh fails', async () => {
    render(<ProjectDashboard projectId={P} />);
    await screen.findByRole('heading', { name: 'Milestone progress' });
    mocks.dashboardApi.project.mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Showing the last loaded numbers. Network error');
    expect(screen.getByRole('progressbar', { name: 'MVP progress' })).toBeTruthy();
  });

  it('reloads when refreshKey changes', async () => {
    const { rerender } = render(<ProjectDashboard projectId={P} refreshKey={0} />);
    await screen.findByRole('heading', { name: 'Milestone progress' });
    expect(mocks.dashboardApi.project).toHaveBeenCalledTimes(1);

    mocks.dashboardApi.project.mockResolvedValue(dashboard({ tasks: { total: 10, open: 7, done: 3, byStatus: { 'To do': 4, 'In progress': 2, Blocked: 1, Done: 3 } } }));
    rerender(<ProjectDashboard projectId={P} refreshKey={1} />);
    await waitFor(() => expect(mocks.dashboardApi.project).toHaveBeenCalledTimes(2));
    const tile = screen.getByText('Open tasks').closest('.pd-stat');
    expect(await within(tile).findByText('7')).toBeTruthy();
  });

  it('reloads once after live task changes from a teammate, and stops listening on unmount', async () => {
    const { unmount } = render(<ProjectDashboard projectId={P} />);
    await screen.findByRole('heading', { name: 'Milestone progress' });
    expect(mocks.taskApi.subscribe).toHaveBeenCalledWith(P, expect.any(Function), expect.any(Function));

    act(() => { mocks.live.onUpdated({ _id: 't9' }); mocks.live.onDeleted('t1'); });
    await waitFor(() => expect(mocks.dashboardApi.project).toHaveBeenCalledTimes(2)); // two events, one reload
    await new Promise((resolve) => { setTimeout(resolve, 450); });
    expect(mocks.dashboardApi.project).toHaveBeenCalledTimes(2);

    unmount();
    expect(mocks.live.stop).toHaveBeenCalled();
  });
});
