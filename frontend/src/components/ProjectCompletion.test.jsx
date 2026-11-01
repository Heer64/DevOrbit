// [Sprint 4 · M8] US-15: Owner marks the project Completed or reopens it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  projectCompletionApi: { complete: vi.fn(), reopen: vi.fn() },
}));
vi.mock('../api', () => ({ projectCompletionApi: mocks.projectCompletionApi }));

import ProjectCompletion, { formatCompletedOn } from './ProjectCompletion';

const P = 'c'.repeat(24);

beforeEach(() => { vi.clearAllMocks(); });

describe('ProjectCompletion', () => {
  it.each(['Admin', 'Contributor', 'Viewer', null])('shows nothing to %s', (role) => {
    const { container } = render(<ProjectCompletion projectId={P} status="In progress" myRole={role} />);
    expect(container.textContent).toBe('');
  });

  it('Owner marks an active project Completed after confirming', async () => {
    const updated = { _id: P, status: 'Completed', completedAt: '2026-11-01T08:00:00.000Z' };
    mocks.projectCompletionApi.complete.mockResolvedValue({ project: updated });
    const onChanged = vi.fn();
    const onNotice = vi.fn();
    const heard = vi.fn();
    window.addEventListener('devorbit:projects-updated', heard);

    render(<ProjectCompletion projectId={P} status="In progress" myRole="Owner" onChanged={onChanged} onNotice={onNotice} />);
    fireEvent.click(screen.getByRole('button', { name: /Mark as completed/ }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(mocks.projectCompletionApi.complete).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as completed' }).at(-1));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
    expect(mocks.projectCompletionApi.complete).toHaveBeenCalledWith(P);
    expect(onNotice).toHaveBeenCalledWith('Project marked as Completed.');
    expect(heard).toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    window.removeEventListener('devorbit:projects-updated', heard);
  });

  it('Owner reopens a Completed project', async () => {
    mocks.projectCompletionApi.reopen.mockResolvedValue({ project: { _id: P, status: 'In progress', completedAt: null } });
    const onChanged = vi.fn();
    render(<ProjectCompletion projectId={P} status="Completed" myRole="Owner" onChanged={onChanged} />);
    expect(screen.queryByRole('button', { name: /Mark as completed/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Reopen project/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Reopen project' }).at(-1));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ _id: P, status: 'In progress', completedAt: null }));
    expect(mocks.projectCompletionApi.reopen).toHaveBeenCalledWith(P);
  });

  it('shows the server error and keeps the dialog open', async () => {
    mocks.projectCompletionApi.complete.mockRejectedValue(new Error('This project is already Completed.'));
    const onChanged = vi.fn();
    render(<ProjectCompletion projectId={P} status="In progress" myRole="Owner" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /Mark as completed/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as completed' }).at(-1));
    expect(await screen.findByText('This project is already Completed.')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('formats the completion date', () => {
    expect(formatCompletedOn('2026-11-01T08:00:00.000Z')).toMatch(/Nov 1, 2026/);
    expect(formatCompletedOn(null)).toBe('');
  });
});
