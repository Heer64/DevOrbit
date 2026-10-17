// Sprint 2 Pair D: the board inside the Tasks tab, live updates and the temporary task "drawer".
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TasksPanel from './TasksPanel';

const PROJECT = 'p1';

function fakeApi(initial) {
  let listener = null;
  return {
    list: vi.fn(() => Promise.resolve({ tasks: initial.map((t) => ({ ...t })), membershipRole: 'Owner' })),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(),
    updateStatus: vi.fn(() => new Promise(() => {})),
    subscribe: vi.fn((projectId, callback) => { listener = callback; return () => { listener = null; }; }),
    push: (task) => act(() => { listener?.(task); }),
  };
}

const seed = [
  { _id: 'a', title: 'Draft schema', status: 'To do', priority: 'Low', version: 3, assignee: null, createdBy: { _id: 'me' } },
  { _id: 'b', title: 'Waiting on design', status: 'Blocked', priority: 'High', version: 0, assignee: null, createdBy: { _id: 'me' } },
];

const columnOf = (title) => screen.getByText(title).closest('section')?.getAttribute('aria-label')?.replace(' column', '');

async function renderBoard(props = {}) {
  localStorage.setItem('devorbit_task_view', 'board');
  const api = props.api || fakeApi(seed);
  render(<TasksPanel projectId={PROJECT} myRole="Owner" currentUserId="me" members={[]} api={api} {...props} />);
  await screen.findByText('Draft schema');
  return api;
}

describe('TasksPanel board view', () => {
  it('switches between list and board', async () => {
    render(<TasksPanel projectId={PROJECT} myRole="Owner" currentUserId="me" members={[]} api={fakeApi(seed)} />);
    await screen.findByText('Draft schema');
    expect(screen.queryByRole('region', { name: 'Blocked column' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /board/i }));
    expect(screen.getByRole('region', { name: 'Blocked column' })).toBeTruthy();
    expect(columnOf('Waiting on design')).toBe('Blocked');
    expect(localStorage.getItem('devorbit_task_view')).toBe('board');

    fireEvent.click(screen.getByRole('button', { name: /list/i }));
    expect(screen.queryByRole('region', { name: 'Blocked column' })).toBeNull();
  });

  it('subscribes to live updates for this project and moves the card on task:updated', async () => {
    const api = await renderBoard();
    expect(api.subscribe).toHaveBeenCalledWith(PROJECT, expect.any(Function));

    api.push({ ...seed[0], status: 'Done', version: 4 });
    expect(columnOf('Draft schema')).toBe('Done');
  });

  it('ignores stale or repeated task:updated events', async () => {
    const api = await renderBoard();
    api.push({ ...seed[0], status: 'Done', version: 3 });
    expect(columnOf('Draft schema')).toBe('To Do');
    api.push({ ...seed[0], status: 'Done', version: 2 });
    expect(columnOf('Draft schema')).toBe('To Do');
  });

  it('clicking a card opens the task in the edit modal (temporary drawer)', async () => {
    await renderBoard();
    fireEvent.click(screen.getByText('Waiting on design'));
    expect(screen.getByRole('heading', { name: 'Edit task' })).toBeTruthy();
    expect(screen.getByDisplayValue('Waiting on design')).toBeTruthy();
  });

  it('Viewers get a read-only board and a read-only task modal', async () => {
    const api = await renderBoard({ myRole: 'Viewer' });
    expect(screen.getByText(/You are a Viewer on this project/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /^Move / })).toBeNull();

    fireEvent.click(screen.getByText('Draft schema'));
    expect(screen.getByRole('heading', { name: 'Task details' })).toBeTruthy();
    expect(screen.getByDisplayValue('Draft schema').closest('fieldset').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();
    expect(api.updateStatus).not.toHaveBeenCalled();
  });

  it('unsubscribes when the panel goes away', async () => {
    const stop = vi.fn();
    const api = fakeApi(seed);
    api.subscribe = vi.fn(() => stop);
    localStorage.setItem('devorbit_task_view', 'board');
    const view = render(<TasksPanel projectId={PROJECT} myRole="Owner" currentUserId="me" members={[]} api={api} />);
    await screen.findByText('Draft schema');
    view.unmount();
    expect(stop).toHaveBeenCalled();
  });
});
