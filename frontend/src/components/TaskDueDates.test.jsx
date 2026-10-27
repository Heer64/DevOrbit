// [Sprint 3 · M5] Due dates on task rows, Kanban cards and in the task form (US-23).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TasksPanel from './TasksPanel';

const ORIGINAL_TZ = process.env.TZ;

function fakeApi(initial) {
  return {
    list: vi.fn(() => Promise.resolve({ tasks: initial.map((t) => ({ ...t })), membershipRole: 'Owner' })),
    create: vi.fn((projectId, body) => Promise.resolve({
      task: { _id: 'new1', status: 'To do', priority: 'Medium', version: 0, assignee: null, createdBy: { _id: 'me' }, label: '', ...body,
        dueDate: body.dueDate ? `${body.dueDate}T00:00:00.000Z` : null },
    })),
    update: vi.fn((projectId, taskId, body) => Promise.resolve({
      task: { ...initial.find((t) => t._id === taskId), ...body, version: 1 },
    })),
    remove: vi.fn(),
    get: vi.fn(),
    updateStatus: vi.fn(() => new Promise(() => {})),
  };
}

const base = { status: 'To do', priority: 'Medium', version: 0, assignee: null, createdBy: { _id: 'me' } };
const seed = [
  { ...base, _id: 'late', title: 'Late task', dueDate: '2026-10-27T00:00:00.000Z' },
  { ...base, _id: 'today', title: 'Today task', dueDate: '2026-10-28T00:00:00.000Z' },
  { ...base, _id: 'tomorrow', title: 'Tomorrow task', dueDate: '2026-10-29T00:00:00.000Z' },
  { ...base, _id: 'later', title: 'Later task', dueDate: '2026-11-05T00:00:00.000Z' },
  { ...base, _id: 'done', title: 'Finished task', status: 'Done', dueDate: '2026-10-01T00:00:00.000Z' },
  { ...base, _id: 'none', title: 'Undated task', dueDate: null },
];

async function renderPanel({ view = 'list', role = 'Owner', api = fakeApi(seed), ...props } = {}) {
  localStorage.setItem('devorbit_task_view', view);
  render(<TasksPanel projectId="p1" myRole={role} currentUserId="me" members={[]} api={api} {...props} />);
  await screen.findByText('Today task');
  return api;
}

const dueOf = (title) => screen.getByText(title).closest('article').querySelector('.task-due');
const dateInput = () => document.querySelector('.task-modal input[type="date"]');

beforeEach(() => {
  // 28 Oct 2026, 14:30 in India (09:00 UTC).
  process.env.TZ = 'Asia/Kolkata';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('Due date display (US-23)', () => {
  it('list rows show the day with overdue / due today / due tomorrow', async () => {
    await renderPanel();
    expect(dueOf('Late task').textContent).toBe('Oct 27 · overdue');
    expect(dueOf('Late task').classList.contains('overdue')).toBe(true);
    expect(dueOf('Today task').textContent).toBe('Oct 28 · due today');
    expect(dueOf('Today task').classList.contains('due-soon')).toBe(true);
    expect(dueOf('Tomorrow task').textContent).toBe('Oct 29 · due tomorrow');
    expect(dueOf('Later task').textContent).toBe('Nov 5');
    expect(dueOf('Finished task').textContent).toBe('Oct 1');
    expect(dueOf('Finished task').classList.contains('overdue')).toBe(false);
    expect(dueOf('Undated task').textContent).toBe('No due date');
  });

  it('Kanban cards show the same', async () => {
    await renderPanel({ view: 'board' });
    expect(dueOf('Late task').textContent).toBe('Oct 27 · overdue');
    expect(dueOf('Today task').textContent).toBe('Oct 28 · due today');
    expect(dueOf('Finished task').textContent).toBe('Oct 1');
  });

  it('a viewer west of UTC still sees 28 Oct, not 27 Oct', async () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(new Date('2026-10-28T17:00:00.000Z')); // 28 Oct, 10:00 in California
    await renderPanel();
    expect(dueOf('Today task').textContent).toBe('Oct 28 · due today');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Today task' }));
    expect(dateInput().value).toBe('2026-10-28');
  });
});

describe('Editing the due date (US-23)', () => {
  it('sends the picked day as YYYY-MM-DD when creating a task', async () => {
    const api = await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    fireEvent.change(screen.getByPlaceholderText('What needs to get done?'), { target: { value: 'Ship it' } });
    fireEvent.change(dateInput(), { target: { value: '2026-11-05' } });
    expect(screen.getByText('Due Nov 5, end of day.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0][1]).toMatchObject({ title: 'Ship it', dueDate: '2026-11-05' });
    const row = (await screen.findByText('Ship it')).closest('article');
    expect(within(row).getByText('Nov 5')).toBeTruthy();
  });

  it('shows how the picked day reads before saving', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Today task' }));
    expect(dateInput().value).toBe('2026-10-28');
    expect(screen.getByText('Due today (Oct 28).')).toBeTruthy();
    fireEvent.change(dateInput(), { target: { value: '2026-10-29' } });
    expect(screen.getByText('Due tomorrow (Oct 29).')).toBeTruthy();
    fireEvent.change(dateInput(), { target: { value: '2026-10-20' } });
    expect(screen.getByText('Oct 20 has already passed.')).toBeTruthy();
  });

  it('Clear removes the due date and only the due date is sent', async () => {
    const api = await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Today task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear due date' }));
    expect(dateInput().value).toBe('');
    expect(screen.getByText('No due date set.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear due date' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0][2]).toEqual({ dueDate: null, version: 0 });
  });

  it('saving without touching the date does not send it', async () => {
    const api = await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Today task' }));
    fireEvent.change(screen.getByPlaceholderText('What needs to get done?'), { target: { value: 'Today task (renamed)' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0][2]).toEqual({ title: 'Today task (renamed)', version: 0 });
  });

  it('Viewers see the date but cannot change or clear it', async () => {
    await renderPanel({ role: 'Viewer', openTaskId: 'today' }); // opened from a link, like a notification
    await waitFor(() => expect(dateInput()).toBeTruthy());
    expect(dateInput().value).toBe('2026-10-28');
    expect(dateInput().closest('fieldset').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Clear due date' })).toBeNull();
  });
});
