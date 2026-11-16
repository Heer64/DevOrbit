// [Sprint 6 · M8] Admin panel (US-57 grant/revoke Content Moderator, US-58 suspend/reactivate), with a fake API.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminPage from './AdminPage';
import { ADMIN_ONLY_MESSAGE } from '../platformRoles';

const auth = vi.hoisted(() => ({ user: null }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));

const LABELS = { user: 'Member', moderator: 'Content Moderator', admin: 'Platform Admin' };
const row = (id, name, extra = {}) => ({
  id,
  name,
  username: name.split(' ')[0].toLowerCase(),
  email: `${name.split(' ')[0].toLowerCase()}@example.com`,
  avatarUrl: '',
  platformRole: 'user',
  roleLabel: 'Member',
  suspended: false,
  suspendedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  isMe: false,
  ...extra,
});

function fakeApi(rows) {
  const accounts = rows || [
    row('a1', 'Asha Admin', { platformRole: 'admin', roleLabel: 'Platform Admin', isMe: true }),
    row('u1', 'Riya Kapoor'),
    row('u2', 'Mo Moderator', { platformRole: 'moderator', roleLabel: 'Content Moderator' }),
    row('u3', 'Sam Suspended', { suspended: true, suspendedAt: '2026-11-15T10:00:00.000Z' }),
  ];
  const summary = () => ({
    moderators: accounts.filter((a) => a.platformRole === 'moderator').length,
    admins: accounts.filter((a) => a.platformRole === 'admin').length,
    suspended: accounts.filter((a) => a.suspended).length,
  });
  const find = (id) => accounts.find((a) => a.id === id);
  return {
    accounts,
    users: vi.fn(async ({ q = '', status = 'all', role = 'all', page = 1 } = {}) => {
      const matches = accounts.filter(
        (a) =>
          (!q || `${a.name} ${a.username} ${a.email}`.toLowerCase().includes(q.toLowerCase())) &&
          (status === 'all' || (status === 'suspended') === a.suspended) &&
          (role === 'all' || a.platformRole === role)
      );
      return {
        users: matches.slice((page - 1) * 20, page * 20).map((a) => ({ ...a })),
        page,
        pageSize: 20,
        total: matches.length,
        summary: summary(),
      };
    }),
    setRole: vi.fn(async (id, role) => {
      const account = find(id);
      Object.assign(account, { platformRole: role, roleLabel: LABELS[role] });
      const message =
        role === 'moderator' ? `${account.name} is now a Content Moderator.` : `${account.name} is no longer a Content Moderator.`;
      return { user: { ...account }, changed: true, message };
    }),
    suspend: vi.fn(async (id) => {
      const account = find(id);
      Object.assign(account, { suspended: true, suspendedAt: '2026-11-15T12:00:00.000Z' });
      return {
        user: { ...account },
        changed: true,
        sessionsEnded: 2,
        message: `${account.name} is suspended and has been logged out everywhere.`,
      };
    }),
    reactivate: vi.fn(async (id) => {
      const account = find(id);
      Object.assign(account, { suspended: false, suspendedAt: null });
      return { user: { ...account }, changed: true, message: `${account.name} is reactivated and can log in again.` };
    }),
  };
}

const apiError = (status, message) => Object.assign(new Error(message), { status, response: { status, data: { message } } });
const rowOf = (name) => screen.getByRole('listitem', { name });
const summaryText = () => screen.getByLabelText('Platform summary').textContent;

async function renderAsAdmin(api = fakeApi()) {
  render(<AdminPage api={api} />);
  await screen.findByRole('list', { name: 'Accounts' });
  return api;
}

beforeEach(() => {
  auth.user = { id: 'a1', name: 'Asha Admin', platformRole: 'admin', isDemo: false };
});

describe('AdminPage access', () => {
  it.each([
    ['a normal user', { id: 'u1', name: 'Riya', platformRole: 'user' }],
    ['a Content Moderator', { id: 'u2', name: 'Mo', platformRole: 'moderator' }],
    ['the demo identity', { id: 'demo-user', name: 'Demo', platformRole: 'admin', isDemo: true }],
  ])('%s sees "admins only" and no accounts are requested', (_label, user) => {
    auth.user = user;
    const api = fakeApi();
    render(<AdminPage api={api} />);
    expect(screen.getByText(ADMIN_ONLY_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Accounts' })).toBeNull();
    expect(api.users).not.toHaveBeenCalled();
  });

  it('if the server answers 403 (the role was taken away), the page says "admins only"', async () => {
    const api = fakeApi();
    api.users.mockRejectedValueOnce(apiError(403, 'Only a Platform Admin can do this.'));
    render(<AdminPage api={api} />);
    expect(await screen.findByText(ADMIN_ONLY_MESSAGE)).toBeTruthy();
  });
});

describe('AdminPage list', () => {
  it('lists every account with its role and status, and the platform summary', async () => {
    const api = await renderAsAdmin();
    expect(api.users).toHaveBeenCalledWith({});
    expect(within(rowOf('Riya Kapoor')).getByText('Member')).toBeTruthy();
    expect(within(rowOf('Riya Kapoor')).getByText('Active')).toBeTruthy();
    expect(within(rowOf('Mo Moderator')).getByText('Content Moderator')).toBeTruthy();
    expect(within(rowOf('Sam Suspended')).getByText('Suspended since 15 Nov 2026')).toBeTruthy();
    expect(within(rowOf('Riya Kapoor')).getByText('@riya · riya@example.com')).toBeTruthy();
    expect(summaryText()).toContain('1 Content Moderators');
    expect(summaryText()).toContain('1 Platform Admins');
    expect(summaryText()).toContain('1 suspended');
    expect(screen.getByText('Showing 1–4 of 4')).toBeTruthy();
  });

  it('Platform Admin rows, including my own, have no switch and no Suspend button', async () => {
    await renderAsAdmin();
    const mine = rowOf('Asha Admin');
    expect(within(mine).getByText('You')).toBeTruthy();
    expect(within(mine).getByText("Platform Admins can't be changed here.")).toBeTruthy();
    expect(within(mine).queryByRole('switch')).toBeNull();
    expect(within(mine).queryByRole('button', { name: /suspend/i })).toBeNull();
  });

  it('search and filters ask the server again, from page 1', async () => {
    const api = await renderAsAdmin();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search accounts' }), { target: { value: '  riya ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.users).toHaveBeenLastCalledWith({ q: 'riya' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'suspended' } });
    await waitFor(() => expect(api.users).toHaveBeenLastCalledWith({ q: 'riya', status: 'suspended' }));
    expect(await screen.findByText('No accounts match')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(api.users).toHaveBeenLastCalledWith({}));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4));

    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'moderator' } });
    await waitFor(() => expect(api.users).toHaveBeenLastCalledWith({ role: 'moderator' }));
    await waitFor(() => expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Mo Moderator']));
  });

  it('pages through more than 20 accounts', async () => {
    const many = Array.from({ length: 25 }, (_, i) => row(`p${i}`, `Person ${String(i).padStart(2, '0')}`));
    const api = await renderAsAdmin(fakeApi(many));
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(api.users).toHaveBeenLastCalledWith({ page: 2 }));
    expect(await screen.findByText('Showing 21–25 of 25')).toBeTruthy();
    expect(screen.getByRole('button', { name: /next/i }).disabled).toBe(true);
  });

  it('a failed load shows the error and a way to try again', async () => {
    const api = fakeApi();
    api.users.mockRejectedValueOnce(apiError(500, 'Something went wrong. Please try again.'));
    render(<AdminPage api={api} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Accounts' })).toBeTruthy();
  });
});

describe('US-57 Content Moderator switch', () => {
  it('grants the role: calls the API, says so, and the switch turns on', async () => {
    const api = await renderAsAdmin();
    const toggle = within(rowOf('Riya Kapoor')).getByRole('switch', { name: 'Content Moderator: Riya Kapoor' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(api.setRole).toHaveBeenCalledWith('u1', 'moderator');
    expect((await screen.findByRole('status')).textContent).toBe('Riya Kapoor is now a Content Moderator.');
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(within(rowOf('Riya Kapoor')).getByText('Content Moderator')).toBeTruthy();
    expect(summaryText()).toContain('2 Content Moderators');
  });

  it('revokes the role', async () => {
    const api = await renderAsAdmin();
    fireEvent.click(within(rowOf('Mo Moderator')).getByRole('switch'));
    expect(api.setRole).toHaveBeenCalledWith('u2', 'user');
    expect((await screen.findByRole('status')).textContent).toBe('Mo Moderator is no longer a Content Moderator.');
    expect(within(rowOf('Mo Moderator')).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(summaryText()).toContain('0 Content Moderators');
  });

  it('shows the server message when a change is refused, and the switch stays as it was', async () => {
    const api = fakeApi();
    api.setRole.mockRejectedValueOnce(apiError(409, "A Platform Admin's role can't be changed here."));
    await renderAsAdmin(api);
    const toggle = within(rowOf('Riya Kapoor')).getByRole('switch');
    fireEvent.click(toggle);
    expect((await screen.findByRole('alert')).textContent).toBe("A Platform Admin's role can't be changed here.");
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
});

describe('US-58 suspend and reactivate', () => {
  it('Suspend asks first; Cancel changes nothing', async () => {
    const api = await renderAsAdmin();
    fireEvent.click(within(rowOf('Riya Kapoor')).getByRole('button', { name: 'Suspend Riya Kapoor' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Suspend Riya Kapoor?' });
    expect(dialog.textContent).toContain('logged out on every device');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.suspend).not.toHaveBeenCalled();
  });

  it('confirming suspends: the row shows Suspended and offers Reactivate', async () => {
    const api = await renderAsAdmin();
    fireEvent.click(within(rowOf('Riya Kapoor')).getByRole('button', { name: 'Suspend Riya Kapoor' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Suspend account' }));
    expect(api.suspend).toHaveBeenCalledWith('u1');
    expect((await screen.findByRole('status')).textContent).toBe('Riya Kapoor is suspended and has been logged out everywhere.');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(within(rowOf('Riya Kapoor')).getByText('Suspended since 15 Nov 2026')).toBeTruthy();
    expect(within(rowOf('Riya Kapoor')).getByRole('button', { name: 'Reactivate Riya Kapoor' })).toBeTruthy();
    expect(summaryText()).toContain('2 suspended');
  });

  it('a refused suspension keeps the dialog open with the reason', async () => {
    const api = fakeApi();
    api.suspend.mockRejectedValueOnce(apiError(409, "A Platform Admin's account can't be suspended."));
    await renderAsAdmin(api);
    fireEvent.click(within(rowOf('Riya Kapoor')).getByRole('button', { name: 'Suspend Riya Kapoor' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend account' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe("A Platform Admin's account can't be suspended.");
    expect(within(rowOf('Riya Kapoor')).getByText('Active')).toBeTruthy();
  });

  it('Reactivate gives access back at once', async () => {
    const api = await renderAsAdmin();
    fireEvent.click(within(rowOf('Sam Suspended')).getByRole('button', { name: 'Reactivate Sam Suspended' }));
    expect(api.reactivate).toHaveBeenCalledWith('u3');
    expect((await screen.findByRole('status')).textContent).toBe('Sam Suspended is reactivated and can log in again.');
    expect(within(rowOf('Sam Suspended')).getByText('Active')).toBeTruthy();
    expect(within(rowOf('Sam Suspended')).getByRole('button', { name: 'Suspend Sam Suspended' })).toBeTruthy();
    expect(summaryText()).toContain('0 suspended');
  });
});
