// Sprint 2 leftovers: the optional task label (US-21) in the task form, list rows and Kanban cards.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TasksPanel from './TasksPanel';

const PROJECT = 'p1';

function fakeApi(initial) {
  return {
    list: vi.fn(() => Promise.resolve({ tasks: initial.map((t) => ({ ...t })), membershipRole: 'Owner' })),
    create: vi.fn((projectId, body) => Promise.resolve({
      task: { _id: 'new1', status: 'To do', priority: 'Medium', version: 0, assignee: null, createdBy: { _id: 'me' }, label: '', ...body },
    })),
    update: vi.fn((projectId, taskId, body) => Promise.resolve({
      task: { ...initial.find((t) => t._id === taskId), ...body, version: 1 },
    })),
    remove: vi.fn(),
    get: vi.fn(),
    updateStatus: vi.fn(() => new Promise(() => {})),
  };
}

const seed = [
  { _id: 'a', title: 'Draft schema', status: 'To do', priority: 'Low', label: 'Backend', version: 0, assignee: null, createdBy: { _id: 'me' } },
  { _id: 'b', title: 'Old task without label', status: 'Done', priority: 'High', version: 0, assignee: null, createdBy: { _id: 'me' } },
];

const labelInput = () => screen.getByPlaceholderText('e.g. Frontend, Bug, Docs');

async function renderPanel(view = 'list', props = {}) {
  localStorage.setItem('devorbit_task_view', view);
  const api = props.api || fakeApi(seed);
  render(<TasksPanel projectId={PROJECT} myRole="Owner" currentUserId="me" members={[]} api={api} {...props} />);
  await screen.findByText('Draft schema');
  return api;
}

describe('Task label (US-21)', () => {
  it('shows the label on list rows, and nothing extra for tasks without one', async () => {
    await renderPanel('list');
    const row = screen.getByText('Draft schema').closest('article');
    expect(within(row).getByText('Backend')).toBeTruthy();
    const oldRow = screen.getByText('Old task without label').closest('article');
    expect(oldRow.querySelector('.custom-label')).toBeNull();
  });

  it('shows the label on Kanban cards', async () => {
    await renderPanel('board');
    const card = screen.getByText('Draft schema').closest('article');
    expect(within(card).getByText('Backend')).toBeTruthy();
  });

  it('sends a trimmed label when creating a task', async () => {
    const api = await renderPanel('list');
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    fireEvent.change(screen.getByPlaceholderText('What needs to get done?'), { target: { value: 'Write docs' } });
    fireEvent.change(labelInput(), { target: { value: '  Docs  ' } });
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0][1]).toMatchObject({ title: 'Write docs', label: 'Docs' });
    expect(await screen.findByText('Write docs')).toBeTruthy();
  });

  it('limits the label input to 30 characters', async () => {
    await renderPanel('list');
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(labelInput().getAttribute('maxLength') || labelInput().getAttribute('maxlength')).toBe('30');
  });

  it('only sends the label (plus version) when just the label was edited', async () => {
    const api = await renderPanel('list');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Draft schema' }));
    expect(labelInput().value).toBe('Backend');

    fireEvent.change(labelInput(), { target: { value: 'API' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0][2]).toEqual({ label: 'API', version: 0 });
    expect(await screen.findByText('API')).toBeTruthy();
  });
});
