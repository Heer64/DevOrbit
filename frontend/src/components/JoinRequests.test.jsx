// [Sprint 3 · M2] Join requests: "Request to join" card (US-47) and the Owner/Admin queue (US-12).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import JoinRequestCard, { joinState } from './JoinRequestCard';
import JoinRequestsPanel from './JoinRequestsPanel';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

function apiError(status, data) {
  const error = new Error(data.message);
  error.status = status;
  error.response = { status, data };
  return error;
}

const pendingRequest = (overrides = {}) => ({
  _id: 'r1',
  status: 'Pending',
  message: 'I know React',
  createdAt: new Date().toISOString(),
  user: { _id: 'u2', name: 'Vera Visitor', username: 'vera' },
  ...overrides,
});

describe('joinState', () => {
  it('picks pending, blocked or the form', () => {
    expect(joinState({ joinRequest: { status: 'Pending' } })).toBe('pending');
    expect(joinState({ joinRequest: { status: 'Rejected' }, canRequestAgainAt: inDays(3) })).toBe('blocked');
    expect(joinState({ joinRequest: { status: 'Rejected' }, canRequestAgainAt: inDays(-1) })).toBe('form');
    expect(joinState({ joinRequest: null, canRequestAgainAt: null })).toBe('form');
    expect(joinState({ joinRequest: { status: 'Approved' } })).toBe('form'); // approved, then removed later
  });
});

describe('JoinRequestCard (US-47)', () => {
  it('sends a request with an optional message and then shows it as pending', async () => {
    const api = {
      mine: vi.fn(() => Promise.resolve({ joinRequest: null, canRequestAgainAt: null, isMember: false })),
      create: vi.fn((projectId, message) => Promise.resolve({ joinRequest: pendingRequest({ message }) })),
    };
    render(<JoinRequestCard projectId="p1" api={api} />);

    const box = await screen.findByLabelText('Message to the project team');
    fireEvent.change(box, { target: { value: '  I know React  ' } });
    expect(screen.getByText('16/500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Request to join/ }));

    await screen.findByText(/Request sent on/);
    expect(api.create).toHaveBeenCalledWith('p1', 'I know React');
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('I know React')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Request to join/ })).toBeNull();
  });

  it('shows an existing pending request instead of the form', async () => {
    const api = { mine: vi.fn(() => Promise.resolve({ joinRequest: pendingRequest(), canRequestAgainAt: null, isMember: false })), create: vi.fn() };
    render(<JoinRequestCard projectId="p1" api={api} />);
    await screen.findByText(/Request sent on/);
    expect(screen.queryByLabelText('Message to the project team')).toBeNull();
  });

  it('tells a rejected visitor when they can ask again', async () => {
    const api = {
      mine: vi.fn(() => Promise.resolve({ joinRequest: { status: 'Rejected' }, canRequestAgainAt: inDays(5), isMember: false })),
      create: vi.fn(),
    };
    render(<JoinRequestCard projectId="p1" api={api} />);
    await screen.findByText(/Your last request was not approved\. You can ask again on/);
    expect(screen.queryByRole('button', { name: /Request to join/ })).toBeNull();
  });

  it('switches to the blocked notice when the server says the 7 days are not over', async () => {
    const api = {
      mine: vi.fn(() => Promise.resolve({ joinRequest: null, canRequestAgainAt: null, isMember: false })),
      create: vi.fn(() => Promise.reject(apiError(409, { message: 'Your last request was not approved.', canRequestAgainAt: inDays(2) }))),
    };
    render(<JoinRequestCard projectId="p1" api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /Request to join/ }));
    await screen.findByText(/You can ask again on/);
  });

  it('shows other errors and keeps the form', async () => {
    const api = {
      mine: vi.fn(() => Promise.resolve({ joinRequest: null, canRequestAgainAt: null, isMember: false })),
      create: vi.fn(() => Promise.reject(apiError(403, { message: 'Only public projects accept join requests.' }))),
    };
    render(<JoinRequestCard projectId="p1" api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /Request to join/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only public projects accept join requests.');
    expect(screen.getByRole('button', { name: /Request to join/ })).toBeTruthy();
  });

  it('renders nothing for a member', async () => {
    const api = { mine: vi.fn(() => Promise.resolve({ joinRequest: null, canRequestAgainAt: null, isMember: true })), create: vi.fn() };
    const { container } = render(<JoinRequestCard projectId="p1" api={api} />);
    await waitFor(() => expect(api.mine).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.join-card')).toBeNull());
  });
});

describe('JoinRequestsPanel (US-12)', () => {
  function fakeApi(list = [pendingRequest(), pendingRequest({ _id: 'r2', message: '', user: { _id: 'u3', name: 'Rae Reject', username: 'rae' } })]) {
    return {
      list: vi.fn(() => Promise.resolve({ joinRequests: list })),
      approve: vi.fn((projectId, requestId, role) => Promise.resolve({ joinRequest: { _id: requestId, status: 'Approved', role } })),
      reject: vi.fn((projectId, requestId) => Promise.resolve({ joinRequest: { _id: requestId, status: 'Rejected' } })),
    };
  }

  it('lists pending requests with their messages', async () => {
    render(<JoinRequestsPanel projectId="p1" myRole="Owner" api={fakeApi()} />);
    expect(await screen.findByText('Vera Visitor')).toBeTruthy();
    expect(screen.getByText('I know React')).toBeTruthy();
    expect(screen.getByText('Rae Reject')).toBeTruthy();
    expect(screen.getByText('2 pending')).toBeTruthy();
  });

  it('approves with the chosen role and tells the page to reload the team', async () => {
    const api = fakeApi();
    const onApproved = vi.fn();
    render(<JoinRequestsPanel projectId="p1" myRole="Owner" api={api} onApproved={onApproved} />);

    const roleSelect = await screen.findByLabelText('Role for Vera Visitor');
    expect(roleSelect.value).toBe('Contributor');
    expect([...roleSelect.options].map((o) => o.value)).toEqual(['Admin', 'Contributor', 'Viewer']);
    fireEvent.change(roleSelect, { target: { value: 'Viewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve Vera Visitor' }));

    await screen.findByText('Vera Visitor joined as Viewer.');
    expect(api.approve).toHaveBeenCalledWith('p1', 'r1', 'Viewer');
    expect(onApproved).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('I know React')).toBeNull();
    expect(screen.getByText('1 pending')).toBeTruthy();
  });

  it('rejects a request', async () => {
    const api = fakeApi();
    render(<JoinRequestsPanel projectId="p1" myRole="Admin" api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject Rae Reject' }));
    await screen.findByText("Rae Reject's request was rejected. They can ask again in 7 days.");
    expect(api.reject).toHaveBeenCalledWith('p1', 'r2');
    expect(screen.queryByText('Rae Reject')).toBeNull();
  });

  it('offers an Admin only Contributor and Viewer', async () => {
    render(<JoinRequestsPanel projectId="p1" myRole="Admin" api={fakeApi()} />);
    const roleSelect = await screen.findByLabelText('Role for Vera Visitor');
    expect([...roleSelect.options].map((o) => o.value)).toEqual(['Contributor', 'Viewer']);
  });

  it('drops a request another manager already decided', async () => {
    const api = fakeApi();
    api.approve.mockRejectedValueOnce(apiError(409, { message: 'This request was already rejected.' }));
    render(<JoinRequestsPanel projectId="p1" myRole="Owner" api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Vera Visitor' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This request was already rejected.');
    expect(screen.queryByText('Vera Visitor')).toBeNull();
  });

  it('shows an empty state', async () => {
    render(<JoinRequestsPanel projectId="p1" myRole="Owner" api={fakeApi([])} />);
    expect(await screen.findByText('No pending requests.')).toBeTruthy();
  });
});
