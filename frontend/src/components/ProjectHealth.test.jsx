// [Sprint 4 · M8] US-40: project health (overdue tasks, blocked tasks, activity level).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  healthApi: { project: vi.fn() },
  taskApi: { subscribe: vi.fn(() => () => {}) },
}));
vi.mock('../api', () => ({ healthApi: mocks.healthApi, taskApi: mocks.taskApi }));

import ProjectHealth, { formatDay, levelHint } from './ProjectHealth';

const P = 'b'.repeat(24);

function health(overrides = {}) {
  return {
    project: { _id: P, name: 'Orbit', status: 'In progress' },
    membershipRole: 'Owner',
    overdue: {
      total: 2,
      limit: 50,
      tasks: [
        { _id: 't1', title: 'Write API docs', status: 'To do', label: '', dueDate: '2026-10-28T00:00:00.000Z', daysOverdue: 4, assignee: { _id: 'u1', name: 'Riya Kapoor' } },
        { _id: 't2', title: 'Fix login bug', status: 'Blocked', label: '', dueDate: '2026-10-31T00:00:00.000Z', daysOverdue: 1, assignee: null },
      ],
    },
    blocked: {
      total: 2,
      limit: 50,
      tasks: [
        { _id: 't2', title: 'Fix login bug', status: 'Blocked', label: '', dueDate: '2026-10-31T00:00:00.000Z', daysOverdue: 1, assignee: null },
        { _id: 't3', title: 'Waiting on design', status: 'To do', label: 'Blocked', dueDate: null, daysOverdue: 0, assignee: null },
      ],
    },
    activity: { days: 7, since: '2026-10-25T10:00:00.000Z', count: 12, level: 'Medium', thresholds: { mediumFrom: 5, highAbove: 20 } },
    generatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.taskApi.subscribe.mockImplementation(() => () => {});
});

describe('helpers', () => {
  it('formats due days in UTC', () => {
    expect(formatDay('2026-10-28T00:00:00.000Z')).toBe('Oct 28');
    expect(formatDay(null)).toBe('');
  });
  it('explains the activity thresholds', () => {
    expect(levelHint(health().activity)).toBe('Low < 5 · Medium 5–20 · High > 20 events in 7 days');
  });
});

describe('ProjectHealth', () => {
  it('lists overdue and blocked tasks and shows the activity level', async () => {
    mocks.healthApi.project.mockResolvedValue(health());
    render(<ProjectHealth projectId={P} />);

    expect(await screen.findByText('Project health')).toBeTruthy();
    expect(mocks.healthApi.project).toHaveBeenCalledWith(P);

    const overdue = screen.getByRole('region', { name: /Overdue/ });
    expect(within(overdue).getByText('Write API docs')).toBeTruthy();
    expect(within(overdue).getByText(/4 days overdue · due Oct 28/)).toBeTruthy();
    expect(within(overdue).getByText(/1 day overdue/)).toBeTruthy();

    const blocked = screen.getByRole('region', { name: /Blocked/ });
    expect(within(blocked).getByText('Fix login bug')).toBeTruthy();
    expect(within(blocked).getByText(/Status: Blocked/)).toBeTruthy();
    expect(within(blocked).getByText(/Label: Blocked/)).toBeTruthy();

    expect(screen.getByTestId('activity-level').textContent).toBe('Medium');
    expect(screen.getByText('12 events in the last 7 days')).toBeTruthy();
    expect(screen.getByText('4 items need attention.', { exact: false })).toBeTruthy();
  });

  it('shows empty states and Low activity for a quiet project', async () => {
    mocks.healthApi.project.mockResolvedValue(health({
      overdue: { total: 0, limit: 50, tasks: [] },
      blocked: { total: 0, limit: 50, tasks: [] },
      activity: { days: 7, count: 1, level: 'Low', thresholds: { mediumFrom: 5, highAbove: 20 } },
    }));
    render(<ProjectHealth projectId={P} />);
    expect(await screen.findByText('No overdue tasks.')).toBeTruthy();
    expect(screen.getByText('No blocked tasks.')).toBeTruthy();
    expect(screen.getByTestId('activity-level').textContent).toBe('Low');
    expect(screen.getByText(/Nothing overdue or blocked right now/)).toBeTruthy();
  });

  it('opens a task when it is clicked', async () => {
    mocks.healthApi.project.mockResolvedValue(health());
    const onOpenTask = vi.fn();
    render(<ProjectHealth projectId={P} onOpenTask={onOpenTask} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Write API docs' }));
    expect(onOpenTask).toHaveBeenCalledWith('t1');
  });

  it('says when more tasks exist than are listed', async () => {
    const data = health();
    mocks.healthApi.project.mockResolvedValue(health({ blocked: { ...data.blocked, total: 5 } }));
    render(<ProjectHealth projectId={P} />);
    expect(await screen.findByText(/\+3 more tasks/)).toBeTruthy();
  });

  it('explains a 403 and can retry', async () => {
    mocks.healthApi.project.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    render(<ProjectHealth projectId={P} />);
    expect(await screen.findByText(/visible to the project Owner and Admins only/)).toBeTruthy();

    mocks.healthApi.project.mockResolvedValueOnce(health());
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.getByTestId('activity-level').textContent).toBe('Medium'));
  });

  it('reloads when a teammate changes a task', async () => {
    let onUpdated;
    mocks.taskApi.subscribe.mockImplementation((_id, updated) => { onUpdated = updated; return () => {}; });
    mocks.healthApi.project.mockResolvedValue(health());
    render(<ProjectHealth projectId={P} />);
    await screen.findByText('Project health');
    expect(mocks.healthApi.project).toHaveBeenCalledTimes(1);
    onUpdated({});
    // The reload waits about 400 ms so a burst of changes causes one request.
    await waitFor(() => expect(mocks.healthApi.project).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });
});
