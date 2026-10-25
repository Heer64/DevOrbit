// [Sprint 3 · M3] Team & roles: remove a member (US-13) and leave a project (US-14), both with confirmation.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  projectApi: { members: vi.fn(), removeMember: vi.fn(), setMemberRole: vi.fn(), addMember: vi.fn() },
}));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import TeamPanel from './TeamPanel';

const team = [
  { userId: 'o1', name: 'Nia Owner', username: 'nia', role: 'Owner', avatarUrl: '' },
  { userId: 'a1', name: 'Ari Admin', username: 'ari', role: 'Admin', avatarUrl: '' },
  { userId: 'c1', name: 'Leo Contributor', username: 'leo', role: 'Contributor', avatarUrl: '' },
];
const without = (id) => team.filter((m) => m.userId !== id);

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.response = { status, data: { message } };
  return error;
}

beforeEach(() => {
  mocks.projectApi.members.mockReset().mockResolvedValue({ members: team });
  mocks.projectApi.removeMember.mockReset();
});

const dialog = () => screen.getByRole('alertdialog');

describe('Remove a member (US-13)', () => {
  it('asks for confirmation and does nothing when cancelled', async () => {
    render(<TeamPanel projectId="p1" projectName="Open Garden" myRole="Owner" currentUserId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Leo Contributor' }));

    expect(within(dialog()).getByText('Remove Leo Contributor?')).toBeTruthy();
    expect(within(dialog()).getByText(/Their past messages, tasks and activity stay in the project/)).toBeTruthy();
    expect(within(dialog()).getByText(/lose access to “Open Garden” straight away/)).toBeTruthy();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.projectApi.removeMember).not.toHaveBeenCalled();
    expect(screen.getByText('Leo Contributor')).toBeTruthy();
  });

  it('Escape also cancels', async () => {
    render(<TeamPanel projectId="p1" myRole="Owner" currentUserId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Leo Contributor' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.projectApi.removeMember).not.toHaveBeenCalled();
  });

  it('removes after confirming and updates the team', async () => {
    mocks.projectApi.removeMember.mockResolvedValue({ members: without('c1') });
    const onMembers = vi.fn();
    render(<TeamPanel projectId="p1" myRole="Owner" currentUserId="o1" onMembers={onMembers} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Leo Contributor' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove member' }));

    await screen.findByText('Leo Contributor was removed from the project.');
    expect(mocks.projectApi.removeMember).toHaveBeenCalledWith('p1', 'c1');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText('Leo Contributor')).toBeNull();
    expect(onMembers).toHaveBeenLastCalledWith(without('c1'));
  });

  it('keeps the dialog open and shows the server error if removing fails', async () => {
    mocks.projectApi.removeMember.mockRejectedValue(apiError(403, 'Admins can only remove Contributors and Viewers.'));
    render(<TeamPanel projectId="p1" myRole="Owner" currentUserId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Leo Contributor' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove member' }));

    expect((await within(dialog()).findByRole('alert')).textContent).toBe('Admins can only remove Contributors and Viewers.');
    expect(screen.getByText('Leo Contributor')).toBeTruthy();
  });

  it('never offers to remove the Owner, and an Admin cannot remove another Admin', async () => {
    render(<TeamPanel projectId="p1" myRole="Admin" currentUserId="a2" />);
    await screen.findByText('Nia Owner');
    expect(screen.queryByRole('button', { name: 'Remove Nia Owner' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Ari Admin' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Leo Contributor' })).toBeTruthy();
  });

  it('Contributors see no remove buttons', async () => {
    render(<TeamPanel projectId="p1" myRole="Contributor" currentUserId="c1" />);
    await screen.findByText('Nia Owner');
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });
});

describe('Leave a project (US-14)', () => {
  it('asks for confirmation, then leaves and calls onLeft', async () => {
    mocks.projectApi.removeMember.mockResolvedValue({ members: without('c1') });
    const onLeft = vi.fn();
    const updated = vi.fn();
    window.addEventListener('devorbit:projects-updated', updated);
    render(<TeamPanel projectId="p1" projectName="Open Garden" myRole="Contributor" currentUserId="c1" onLeft={onLeft} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Leave project' }));
    expect(within(dialog()).getByText('Leave this project?')).toBeTruthy();
    expect(within(dialog()).getByText(/Your messages and tasks stay in the project/)).toBeTruthy();
    expect(mocks.projectApi.removeMember).not.toHaveBeenCalled();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Leave project' }));
    await waitFor(() => expect(onLeft).toHaveBeenCalledTimes(1));
    expect(mocks.projectApi.removeMember).toHaveBeenCalledWith('p1', 'c1');
    expect(updated).toHaveBeenCalled();
    window.removeEventListener('devorbit:projects-updated', updated);
  });

  it('cancelling keeps you in the project', async () => {
    const onLeft = vi.fn();
    render(<TeamPanel projectId="p1" myRole="Contributor" currentUserId="c1" onLeft={onLeft} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave project' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(mocks.projectApi.removeMember).not.toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('shows the error and stays when leaving fails', async () => {
    mocks.projectApi.removeMember.mockRejectedValue(apiError(500, 'Something went wrong. Please try again.'));
    const onLeft = vi.fn();
    render(<TeamPanel projectId="p1" myRole="Contributor" currentUserId="c1" onLeft={onLeft} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave project' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Leave project' }));
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('Something went wrong. Please try again.');
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('the only Owner is asked to transfer ownership first, and nothing is sent', async () => {
    render(<TeamPanel projectId="p1" projectName="Open Garden" myRole="Owner" currentUserId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave project' }));

    expect(within(dialog()).getByText('Transfer ownership first')).toBeTruthy();
    expect(within(dialog()).getByText(/You are the only Owner of “Open Garden”/)).toBeTruthy();
    expect(within(dialog()).queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.projectApi.removeMember).not.toHaveBeenCalled();
  });
});
