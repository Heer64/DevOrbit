// [Sprint 5 · M2] US-46 View a public project page (Visitor) + US-47 Request to join (Registered User).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));

import PublicProjectPage, { NOT_AVAILABLE } from './PublicProjectPage';

const ID = '0123456789abcdef01234567';
const project = {
  _id: ID,
  name: 'Open Garden',
  description: 'Community gardening app',
  domain: 'Community',
  status: 'In progress',
  memberNames: ['Olivia Owner', 'Casey Contributor'],
};

const publicApiWith = (result = { project }) => ({
  project: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
});
const apiError = (status, message) => Object.assign(new Error(message), { status, response: { status, data: { message } } });

function LoginProbe() {
  const location = useLocation();
  const from = location.state?.from;
  return <p>Login page{from ? ` from ${from.pathname}` : ''}</p>;
}
function WorkspaceProbe() {
  const { id } = useParams();
  return <p>Workspace {id}</p>;
}

function renderPage({ api = publicApiWith(), joinApi } = {}) {
  render(
    <MemoryRouter initialEntries={[`/discover/${ID}`]}>
      <Routes>
        <Route path="/discover/:projectId" element={<PublicProjectPage api={api} joinApi={joinApi} />} />
        <Route path="/discover" element={<p>Discover list</p>} />
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/signup" element={<p>Signup page</p>} />
        <Route path="/project/:id" element={<WorkspaceProbe />} />
      </Routes>
    </MemoryRouter>
  );
  return api;
}

const notMember = () => ({
  mine: vi.fn(() => Promise.resolve({ joinRequest: null, canRequestAgainAt: null, isMember: false })),
  create: vi.fn((_id, message) =>
    Promise.resolve({ joinRequest: { _id: 'j1', status: 'Pending', message, createdAt: '2026-11-07T10:00:00.000Z' } })
  ),
});

beforeEach(() => {
  auth.user = null;
});

describe('US-46 public project page', () => {
  it('AC1: shows name, description, domain, status and member names, loaded by the ID in the link', async () => {
    const api = renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Open Garden' })).toBeTruthy();
    expect(api.project).toHaveBeenCalledWith(ID);
    expect(screen.getByText('Community gardening app')).toBeTruthy();
    expect(screen.getByTitle('Domain').textContent).toBe('Community');
    expect(screen.getByTitle('Project status').textContent).toBe('In progress');
    const members = within(screen.getByRole('region', { name: 'Members' }));
    expect(members.getByText('Olivia Owner')).toBeTruthy();
    expect(members.getByText('Casey Contributor')).toBeTruthy();
    expect(screen.getByText('2 members')).toBeTruthy();
  });

  it('AC1: is read-only: no inputs, no edit, delete or settings buttons', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Open Garden' });
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/edit/i)).toBeNull();
  });

  it('AC2: channels, messages, tasks and files are not shown', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Open Garden' });
    for (const tab of ['Tasks', 'Chat', 'Files', 'Docs', 'Activity']) {
      expect(screen.queryByRole('button', { name: tab })).toBeNull();
    }
    expect(screen.getByText('Channels, messages, tasks and files are visible to project members only.')).toBeTruthy();
  });

  it('a Private or missing project shows "not available" and nothing else', async () => {
    renderPage({ api: publicApiWith(apiError(404, 'This project is not public or does not exist.')) });
    expect((await screen.findByRole('alert')).textContent).toBe(NOT_AVAILABLE);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByText(/Request to join/)).toBeNull();
  });

  it('other errors are shown, not hidden', async () => {
    renderPage({ api: publicApiWith(apiError(500, 'Server is down')) });
    expect((await screen.findByRole('alert')).textContent).toBe('Server is down');
  });

  it('"Back to Discover" returns to the list', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Open Garden' });
    fireEvent.click(screen.getByRole('link', { name: /Back to Discover/ }));
    expect(screen.getByText('Discover list')).toBeTruthy();
  });
});

describe('US-47 request to join from the public page', () => {
  it('AC3: a visitor who is not logged in is asked to log in first, and comes back here afterwards', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Open Garden' });
    fireEvent.click(screen.getByRole('link', { name: /Request to join/ }));
    expect(screen.getByText(`Login page from /discover/${ID}`)).toBeTruthy();
  });

  it('AC1: a logged-in non-member sends a request with an optional message and sees it pending', async () => {
    auth.user = { id: 'u9', name: 'Ravi Requester', isDemo: false };
    const joinApi = notMember();
    renderPage({ joinApi });
    await screen.findByRole('heading', { level: 1, name: 'Open Garden' });
    await waitFor(() => expect(joinApi.mine).toHaveBeenCalledWith(ID));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message to the project team' }), { target: { value: 'I know React' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request to join' }));
    await waitFor(() => expect(joinApi.create).toHaveBeenCalledWith(ID, 'I know React'));
    expect(await screen.findByText('Pending')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open workspace/ })).toBeNull();
  });

  it('AC2: when a request is already pending, the page says so instead of offering another', async () => {
    auth.user = { id: 'u9', name: 'Ravi Requester', isDemo: false };
    const joinApi = {
      ...notMember(),
      mine: vi.fn(() =>
        Promise.resolve({
          joinRequest: { status: 'Pending', message: '', createdAt: '2026-11-06T10:00:00.000Z' },
          canRequestAgainAt: null,
          isMember: false,
        })
      ),
    };
    renderPage({ joinApi });
    expect(await screen.findByText('Pending')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request to join' })).toBeNull();
  });

  it('a member gets a link into the workspace and no join form', async () => {
    auth.user = { id: 'u1', name: 'Olivia Owner', isDemo: false };
    const joinApi = { ...notMember(), mine: vi.fn(() => Promise.resolve({ joinRequest: null, canRequestAgainAt: null, isMember: true })) };
    renderPage({ joinApi });
    const open = await screen.findByRole('link', { name: /Open workspace/ });
    expect(screen.queryByRole('button', { name: 'Request to join' })).toBeNull();
    fireEvent.click(open);
    expect(screen.getByText(`Workspace ${ID}`)).toBeTruthy();
  });

  it('demo users are told join requests need a real account (no API calls)', async () => {
    auth.user = { id: 'demo', name: 'Demo', isDemo: true };
    const joinApi = notMember();
    renderPage({ joinApi });
    expect(await screen.findByText(/Join requests need a real account/)).toBeTruthy();
    expect(joinApi.mine).not.toHaveBeenCalled();
  });
});
