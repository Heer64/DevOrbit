import { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import KanbanBoard from './KanbanBoard';

const PROJECT = 'p1';

const tasks = () => [
  { _id: 't1', title: 'Write API docs', status: 'To do', priority: 'Low', version: 0, assignee: null },
  { _id: 't2', title: 'Build board', status: 'In progress', priority: 'High', version: 2, assignee: { _id: 'u1', name: 'Riya Kapoor' } },
  { _id: 't3', title: 'Wait for OAuth', status: 'Blocked', priority: 'Medium', version: 1, assignee: null },
  { _id: 't4', title: 'Set up repo', status: 'Done', priority: 'Medium', version: 4, assignee: null },
];

function apiError(status, data) {
  return Object.assign(new Error(data.message), { status, response: { status, data } });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Owns the task list the way TasksPanel does.
function Harness({ initial = tasks(), api, canMove = true, onOpenTask = () => {}, onMoved }) {
  const [list, setList] = useState(initial);
  const update = useCallback((updater) => setList((old) => updater(old)), []);
  return <KanbanBoard projectId={PROJECT} tasks={list} api={api} canMove={canMove} onUpdateTasks={update} onOpenTask={onOpenTask} onMoved={onMoved} />;
}

const column = (label) => screen.getByRole('region', { name: `${label} column` });
const columnOf = (title) => screen.getByText(title).closest('section').getAttribute('aria-label').replace(' column', '');
const moveSelect = (title) => screen.getByRole('combobox', { name: `Move ${title} to` });

describe('KanbanBoard: US-27 view the board', () => {
  it('shows To Do, In Progress, Blocked and Done columns', () => {
    render(<Harness api={{}} />);
    for (const label of ['To Do', 'In Progress', 'Blocked', 'Done']) {
      expect(column(label)).toBeTruthy();
    }
  });

  it('places each task in the column matching its saved status', () => {
    render(<Harness api={{}} />);
    expect(columnOf('Write API docs')).toBe('To Do');
    expect(columnOf('Build board')).toBe('In Progress');
    expect(columnOf('Wait for OAuth')).toBe('Blocked');
    expect(columnOf('Set up repo')).toBe('Done');
    expect(within(column('Done')).getByLabelText('1 tasks')).toBeTruthy();
  });
});

describe('KanbanBoard: US-28 move tasks', () => {
  it('moves the card immediately (optimistic, well under 300 ms) and sends status + version', async () => {
    const pending = deferred();
    const api = { updateStatus: vi.fn(() => pending.promise) };
    const onMoved = vi.fn();
    render(<Harness api={api} onMoved={onMoved} />);

    const started = performance.now();
    fireEvent.change(moveSelect('Build board'), { target: { value: 'Done' } });
    expect(columnOf('Build board')).toBe('Done');
    expect(performance.now() - started).toBeLessThan(300);

    expect(api.updateStatus).toHaveBeenCalledWith(PROJECT, 't2', { status: 'Done', version: 2 });

    await act(async () => {
      pending.resolve({ task: { ...tasks()[1], status: 'Done', version: 3 } });
    });
    expect(columnOf('Build board')).toBe('Done');
    expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ _id: 't2', version: 3 }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('puts the card back and shows an error when the server rejects the move', async () => {
    const api = { updateStatus: vi.fn(() => Promise.reject(apiError(500, { message: 'Server unavailable.' }))) };
    render(<Harness api={api} />);

    fireEvent.change(moveSelect('Write API docs'), { target: { value: 'Blocked' } });
    expect(columnOf('Write API docs')).toBe('Blocked');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Server unavailable.');
    expect(columnOf('Write API docs')).toBe('To Do');
  });

  it('rolls back after a 403 too (e.g. role changed to Viewer meanwhile)', async () => {
    const api = { updateStatus: vi.fn(() => Promise.reject(apiError(403, { message: 'You do not have permission to change task status.' }))) };
    render(<Harness api={api} />);
    fireEvent.change(moveSelect('Write API docs'), { target: { value: 'Done' } });
    await screen.findByRole('alert');
    expect(columnOf('Write API docs')).toBe('To Do');
  });

  it('on 409 shows the conflict message and leaves the card in the server\'s column', async () => {
    const latest = { ...tasks()[0], status: 'In progress', version: 1, title: 'Write API docs' };
    const api = {
      updateStatus: vi.fn(() => Promise.reject(apiError(409, { message: 'This task was changed by someone else.', task: latest }))),
      get: vi.fn(),
    };
    render(<Harness api={api} />);

    fireEvent.change(moveSelect('Write API docs'), { target: { value: 'Done' } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This task was changed by someone else');
    expect(columnOf('Write API docs')).toBe('In Progress');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('on 409 without a task in the body, fetches the latest task', async () => {
    const api = {
      updateStatus: vi.fn(() => Promise.reject(apiError(409, { message: 'This task was changed by someone else.' }))),
      get: vi.fn(() => Promise.resolve({ task: { ...tasks()[0], status: 'Blocked', version: 5 } })),
    };
    render(<Harness api={api} />);

    fireEvent.change(moveSelect('Write API docs'), { target: { value: 'Done' } });

    await screen.findByRole('alert');
    expect(api.get).toHaveBeenCalledWith(PROJECT, 't1');
    await waitFor(() => expect(columnOf('Write API docs')).toBe('Blocked'));
  });

  it('dropping into the same column sends nothing', () => {
    const api = { updateStatus: vi.fn() };
    render(<Harness api={api} />);
    fireEvent.change(moveSelect('Write API docs'), { target: { value: 'To do' } });
    expect(api.updateStatus).not.toHaveBeenCalled();
  });

  it('ignores a second move of the same card while the first is still saving', () => {
    const api = { updateStatus: vi.fn(() => new Promise(() => {})) };
    render(<Harness api={api} />);
    fireEvent.change(moveSelect('Write API docs'), { target: { value: 'Blocked' } });
    fireEvent.change(moveSelect('Write API docs'), { target: { value: 'Done' } });
    expect(api.updateStatus).toHaveBeenCalledTimes(1);
  });
});

describe('KanbanBoard: opening tasks and Viewer access', () => {
  it('clicking a card opens the task', () => {
    const onOpenTask = vi.fn();
    render(<Harness api={{}} onOpenTask={onOpenTask} />);
    fireEvent.click(screen.getByText('Build board'));
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ _id: 't2' }));
  });

  it('Enter on a focused card opens it', () => {
    const onOpenTask = vi.fn();
    render(<Harness api={{}} onOpenTask={onOpenTask} />);
    const card = screen.getByText('Set up repo').closest('article');
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ _id: 't4' }));
  });

  it('using the Move menu does not open the task', () => {
    const onOpenTask = vi.fn();
    render(<Harness api={{ updateStatus: () => new Promise(() => {}) }} onOpenTask={onOpenTask} />);
    fireEvent.click(moveSelect('Build board'));
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it('Viewers see the board but cannot move cards', () => {
    const api = { updateStatus: vi.fn() };
    const onOpenTask = vi.fn();
    render(<Harness api={api} canMove={false} onOpenTask={onOpenTask} />);

    expect(columnOf('Build board')).toBe('In Progress');
    expect(screen.queryByRole('combobox')).toBeNull();
    const card = screen.getByText('Build board').closest('article');
    expect(card.getAttribute('aria-disabled')).toBe('true');
    expect(card.className).not.toContain('movable');

    fireEvent.click(card);
    expect(onOpenTask).toHaveBeenCalled();
    expect(api.updateStatus).not.toHaveBeenCalled();
  });
});
