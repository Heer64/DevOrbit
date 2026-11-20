// [Sprint 7 · M7] Transfer ownership from the Team panel: confirm, then the member is Owner and I am Admin.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  projectApi: { members: vi.fn(), removeMember: vi.fn(), setMemberRole: vi.fn(), transferOwnership: vi.fn() },
}));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import TeamPanel from './TeamPanel';

const team = [
  { userId: 'o1', name: 'Nia Owner', username: 'nia', role: 'Owner', avatarUrl: '' },
  { userId: 'a1', name: 'Ari Admin', username: 'ari', role: 'Admin', avatarUrl: '' },
  { userId: 'c1', name: 'Leo Contributor', username: 'leo', role: 'Contributor', avatarUrl: '' },
];
const afterTransfer = [{ ...team[0], role: 'Admin' }, team[1], { ...team[2], role: 'Owner' }];

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.response = { status, data: { message } };
  return error;
}

const dialog = () => screen.getByRole('alertdialog');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectApi.members.mockResolvedValue({ members: team });
  mocks.projectApi.transferOwnership.mockResolvedValue({ members: afterTransfer, membershipRole: 'Admin' });
});

describe('Transfer ownership', () => {
  it('only the Owner sees the crown button, next to every other member', async () => {
    const { unmount } = render(<TeamPanel projectId="p1" myRole="Owner" currentUserId="o1" />);
    expect(await screen.findByRole('button', { name: 'Make Leo Contributor the Owner' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make Ari Admin the Owner' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Make Nia Owner the Owner/ })).toBeNull();
    unmount();

    render(<TeamPanel projectId="p1" myRole="Admin" currentUserId="a1" />);
    await screen.findByText('Leo Contributor');
    expect(screen.queryByRole('button', { name: /the Owner$/ })).toBeNull();
  });

  it('asks for confirmation; Cancel sends nothing', async () => {
    render(<TeamPanel projectId="p1" projectName="Open Garden" myRole="Owner" currentUserId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make Leo Contributor the Owner' }));
    expect(within(dialog()).getByText('Make Leo Contributor the Owner?')).toBeTruthy();
    expect(within(dialog()).getByText(/will become the Owner of “Open Garden”/)).toBeTruthy();
    expect(within(dialog()).getByText(/You will become an Admin/)).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.projectApi.transferOwnership).not.toHaveBeenCalled();
  });

  it('confirming transfers: the list updates, I am told I am an Admin, and the page learns my new role', async () => {
    const onRoleChange = vi.fn();
    const onMembers = vi.fn();
    render(<TeamPanel projectId="p1" myRole="Owner" currentUserId="o1" onRoleChange={onRoleChange} onMembers={onMembers} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make Leo Contributor the Owner' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Transfer ownership' }));

    expect((await screen.findByRole('status')).textContent).toBe('Leo Contributor is now the Owner. You are now an Admin.');
    expect(mocks.projectApi.transferOwnership).toHaveBeenCalledWith('p1', 'c1');
    expect(onRoleChange).toHaveBeenCalledWith('Admin');
    expect(onMembers).toHaveBeenLastCalledWith(afterTransfer);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a refused transfer keeps the dialog open with the reason', async () => {
    mocks.projectApi.transferOwnership.mockRejectedValue(
      apiError(409, 'The team changed while you were doing this. Reload the team and try again.')
    );
    const onRoleChange = vi.fn();
    render(<TeamPanel projectId="p1" myRole="Owner" currentUserId="o1" onRoleChange={onRoleChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make Ari Admin the Owner' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Transfer ownership' }));
    expect((await within(dialog()).findByRole('alert')).textContent).toMatch(/The team changed/);
    expect(onRoleChange).not.toHaveBeenCalled();
  });

  it('the only Owner trying to leave is told how to transfer first', async () => {
    render(<TeamPanel projectId="p1" myRole="Owner" currentUserId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave project' }));
    expect(within(dialog()).getByText('Transfer ownership first')).toBeTruthy();
    expect(within(dialog()).getByText(/Use the crown button next to a member/)).toBeTruthy();
  });

  it('an Owner alone in the project is told to add someone first', async () => {
    mocks.projectApi.members.mockResolvedValue({ members: [team[0]] });
    render(<TeamPanel projectId="p1" myRole="Owner" currentUserId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave project' }));
    expect(within(dialog()).getByText(/Add or invite another member first/)).toBeTruthy();
  });
});
