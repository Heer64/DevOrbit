// [Sprint 3 · M1] Invitations: the Owner/Admin panel (US-10) and "Your invitations" on the dashboard (US-11).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import InvitationsPanel from './InvitationsPanel';
import MyInvitations from './MyInvitations';
import { daysLeft, invitationBadge } from './invitationDisplay';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();
const user = { id: 'u1', name: 'Gia Guest', isDemo: false };

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.response = { status, data: { message } };
  return error;
}

const invitation = (overrides = {}) => ({
  _id: 'i1',
  status: 'Pending',
  role: 'Viewer',
  createdAt: new Date().toISOString(),
  expiresAt: inDays(7),
  respondedAt: null,
  invitee: { _id: 'u1', name: 'Gia Guest', username: 'gia' },
  invitedBy: { _id: 'u0', name: 'Nia Owner', username: 'nia' },
  project: { _id: 'p1', name: 'Secret Lab', color: 'violet', visibility: 'Private' },
  ...overrides,
});

describe('invitation display helpers', () => {
  it('labels each status', () => {
    expect(invitationBadge(invitation()).label).toMatch(/^Pending · expires /);
    expect(invitationBadge(invitation()).tone).toBe('orange');
    expect(invitationBadge(invitation({ status: 'Accepted' }))).toEqual({ label: 'Accepted', tone: 'green' });
    expect(invitationBadge(invitation({ status: 'Declined' }))).toEqual({ label: 'Declined', tone: 'red' });
    expect(invitationBadge(invitation({ status: 'Expired' }))).toEqual({ label: 'Expired', tone: '' });
  });

  it('counts days left, rounded up', () => {
    const now = Date.now();
    expect(daysLeft(new Date(now + 7 * DAY).toISOString(), now)).toBe(7);
    expect(daysLeft(new Date(now + 7 * DAY - 5000).toISOString(), now)).toBe(7);
    expect(daysLeft(new Date(now + 1.5 * DAY).toISOString(), now)).toBe(2);
    expect(daysLeft(new Date(now + 2 * 60 * 60 * 1000).toISOString(), now)).toBe(1);
    expect(daysLeft(new Date(now - DAY).toISOString(), now)).toBe(0);
  });
});

describe('InvitationsPanel (US-10)', () => {
  it('lists sent invitations, so a declined one is visible to the inviter', async () => {
    const api = {
      forProject: vi.fn(() => Promise.resolve({
        invitations: [
          invitation({ _id: 'a', invitee: { name: 'Dee Decline' }, status: 'Declined', respondedAt: new Date().toISOString() }),
          invitation({ _id: 'b', invitee: { name: 'Pip Pending' }, role: 'Contributor' }),
          invitation({ _id: 'c', invitee: { name: 'Lou Late' }, status: 'Expired' }),
        ],
      })),
      send: vi.fn(),
    };
    render(<InvitationsPanel projectId="p1" myRole="Owner" api={api} />);

    const list = await screen.findByLabelText('Sent invitations');
    const declinedRow = within(list).getByText('Dee Decline').closest('.member-row');
    expect(within(declinedRow).getByText('Declined')).toBeTruthy();
    expect(within(declinedRow).getByText(/declined/)).toBeTruthy();
    expect(within(within(list).getByText('Pip Pending').closest('.member-row')).getByText(/^Pending · expires/)).toBeTruthy();
    expect(within(within(list).getByText('Lou Late').closest('.member-row')).getByText('Expired')).toBeTruthy();
    expect(screen.getByText('1 pending')).toBeTruthy();
    expect(api.forProject).toHaveBeenCalledWith('p1');
  });

  it('sends an invitation with the chosen role and adds it to the list', async () => {
    const api = {
      forProject: vi.fn(() => Promise.resolve({ invitations: [] })),
      send: vi.fn((projectId, { role }) => Promise.resolve({ invitation: invitation({ _id: 'new', role, invitee: { name: 'Gia Guest' } }) })),
    };
    render(<InvitationsPanel projectId="p1" myRole="Owner" api={api} />);

    const input = await screen.findByLabelText('Email or username to invite');
    const roleSelect = screen.getByLabelText('Role for the invited person');
    expect(within(roleSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['Admin', 'Contributor', 'Viewer']);
    expect(roleSelect.value).toBe('Contributor');

    fireEvent.change(input, { target: { value: '  gia  ' } });
    fireEvent.change(roleSelect, { target: { value: 'Viewer' } });
    fireEvent.click(screen.getByRole('button', { name: /Send invite/ }));

    await screen.findByText(/Invitation sent to Gia Guest\. It expires on/);
    expect(api.send).toHaveBeenCalledWith('p1', { identifier: 'gia', role: 'Viewer' });
    expect(input.value).toBe('');
    const row = within(screen.getByLabelText('Sent invitations')).getByText('Gia Guest').closest('.member-row');
    expect(within(row).getByText(/^Viewer · sent/)).toBeTruthy();
  });

  it('only offers the roles an Admin may hand out', async () => {
    const api = { forProject: vi.fn(() => Promise.resolve({ invitations: [] })), send: vi.fn() };
    render(<InvitationsPanel projectId="p1" myRole="Admin" api={api} />);
    const roleSelect = await screen.findByLabelText('Role for the invited person');
    expect(within(roleSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['Contributor', 'Viewer']);
  });

  it('shows the server error for a duplicate invitation and keeps the list as it was', async () => {
    const api = {
      forProject: vi.fn(() => Promise.resolve({ invitations: [invitation({ invitee: { name: 'Pip Pending' } })] })),
      send: vi.fn(() => Promise.reject(apiError(409, 'That person already has a pending invitation to this project.'))),
    };
    render(<InvitationsPanel projectId="p1" myRole="Owner" api={api} />);
    fireEvent.change(await screen.findByLabelText('Email or username to invite'), { target: { value: 'pip' } });
    fireEvent.click(screen.getByRole('button', { name: /Send invite/ }));

    expect((await screen.findByRole('alert')).textContent).toBe('That person already has a pending invitation to this project.');
    expect(within(screen.getByLabelText('Sent invitations')).getAllByText('Pip Pending')).toHaveLength(1);
    expect(screen.getByLabelText('Email or username to invite').value).toBe('pip');
  });

  it('cannot send an empty invitation', async () => {
    const api = { forProject: vi.fn(() => Promise.resolve({ invitations: [] })), send: vi.fn() };
    render(<InvitationsPanel projectId="p1" myRole="Owner" api={api} />);
    const button = await screen.findByRole('button', { name: /Send invite/ });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email or username to invite'), { target: { value: '   ' } });
    expect(button.disabled).toBe(true);
  });
});

describe('MyInvitations (US-11)', () => {
  it('shows a pending invitation with who sent it, the role and the expiry', async () => {
    const api = { mine: vi.fn(() => Promise.resolve({ invitations: [invitation()] })), accept: vi.fn(), decline: vi.fn() };
    render(<MyInvitations user={user} api={api} />);

    const panel = await screen.findByRole('region', { name: 'Your invitations' });
    expect(within(panel).getByText('Secret Lab')).toBeTruthy();
    expect(within(panel).getByText(/Nia Owner invited you to join as/)).toBeTruthy();
    expect(within(panel).getByText('Viewer')).toBeTruthy();
    expect(within(panel).getByText(/Expires .* · 7 days left/)).toBeTruthy();
    expect(within(panel).getByText('1 pending')).toBeTruthy();
  });

  it('accepting joins the project, reloads my projects and offers to open it', async () => {
    const api = {
      mine: vi.fn()
        .mockResolvedValueOnce({ invitations: [invitation()] })
        .mockResolvedValue({ invitations: [] }),
      accept: vi.fn(() => Promise.resolve({ invitation: invitation({ status: 'Accepted' }), project: { _id: 'p1', name: 'Secret Lab' }, joined: true })),
      decline: vi.fn(),
    };
    const updated = vi.fn();
    window.addEventListener('devorbit:projects-updated', updated);
    const onOpenProject = vi.fn();
    render(<MyInvitations user={user} api={api} onOpenProject={onOpenProject} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation to Secret Lab' }));
    expect((await screen.findByRole('status')).textContent).toMatch('You joined Secret Lab as Viewer.');
    expect(api.accept).toHaveBeenCalledWith('i1');
    expect(updated).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Accept invitation to Secret Lab' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Open project/ }));
    expect(onOpenProject).toHaveBeenCalledWith('p1');
    window.removeEventListener('devorbit:projects-updated', updated);
  });

  it('declining removes the invitation and says so', async () => {
    const api = {
      mine: vi.fn(() => Promise.resolve({ invitations: [invitation(), invitation({ _id: 'i2', project: { _id: 'p2', name: 'Other Lab' } })] })),
      accept: vi.fn(),
      decline: vi.fn(() => Promise.resolve({ invitation: invitation({ status: 'Declined' }) })),
    };
    render(<MyInvitations user={user} api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Decline invitation to Secret Lab' }));
    expect((await screen.findByRole('status')).textContent).toBe('You declined the invitation to Secret Lab.');
    expect(api.decline).toHaveBeenCalledWith('i1');
    expect(api.accept).not.toHaveBeenCalled();
    expect(screen.queryByText('Secret Lab')).toBeNull();
    expect(screen.getByText('Other Lab')).toBeTruthy();
  });

  it('an expired invitation shows the server message and disappears', async () => {
    const api = {
      mine: vi.fn(() => Promise.resolve({ invitations: [invitation({ expiresAt: inDays(0.5) })] })),
      accept: vi.fn(() => Promise.reject(apiError(409, 'This invitation has expired. Ask the project team to invite you again.'))),
      decline: vi.fn(),
    };
    render(<MyInvitations user={user} api={api} />);

    expect(await screen.findByText(/last day/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation to Secret Lab' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This invitation has expired. Ask the project team to invite you again.');
    expect(screen.queryByRole('button', { name: 'Accept invitation to Secret Lab' })).toBeNull();
  });

  it('shows nothing when there are no invitations, and never calls the API for the demo user', async () => {
    const api = { mine: vi.fn(() => Promise.resolve({ invitations: [] })), accept: vi.fn(), decline: vi.fn() };
    const { container, unmount } = render(<MyInvitations user={user} api={api} />);
    await vi.waitFor(() => expect(api.mine).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
    unmount();

    const demoApi = { mine: vi.fn(), accept: vi.fn(), decline: vi.fn() };
    const demo = render(<MyInvitations user={{ ...user, isDemo: true }} api={demoApi} />);
    expect(demo.container.innerHTML).toBe('');
    expect(demoApi.mine).not.toHaveBeenCalled();
  });
});
