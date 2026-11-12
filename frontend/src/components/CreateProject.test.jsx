// [Sprint 1 · gaps] Create-project form: domain from the agreed list, optional starting members and roles.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PROJECT_DOMAINS, startingMembersPayload } from '../domains';

const auth = vi.hoisted(() => ({ user: { id: 'u1', name: 'Owner Person', isDemo: false }, logout: () => {} }));
const mocks = vi.hoisted(() => ({ projectApi: { list: vi.fn(), create: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./NotificationBell', () => ({ default: () => null }));
vi.mock('./DmUnreadBadge', () => ({ default: () => null })); // [Sprint 6 · M2] no live connection in this test
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import AppShell from './AppShell';

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<p>dashboard</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

async function openForm() {
  renderShell();
  fireEvent.click(await screen.findByRole('button', { name: /create a project/i }));
  fireEvent.change(screen.getByPlaceholderText('e.g. CampusConnect'), { target: { value: 'Team project' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectApi.list.mockResolvedValue({ projects: [] });
  mocks.projectApi.create.mockResolvedValue({ project: { _id: 'p1', name: 'Team project', members: [], domain: 'Education' } });
});

describe('create project form', () => {
  it('offers exactly the agreed domains', async () => {
    await openForm();
    const options = [...screen.getByDisplayValue(PROJECT_DOMAINS[0]).querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(PROJECT_DOMAINS);
  });

  it('sends no members when none were added', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
    await waitFor(() => expect(mocks.projectApi.create).toHaveBeenCalled());
    expect(mocks.projectApi.create.mock.calls[0][0]).not.toHaveProperty('members');
  });

  it('sends starting members with their roles; blank rows are dropped', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: /add a member/i }));
    fireEvent.click(screen.getByRole('button', { name: /add a member/i }));
    fireEvent.click(screen.getByRole('button', { name: /add a member/i }));
    fireEvent.change(screen.getByLabelText('Starting member 1 email or username'), { target: { value: 'riya@example.com' } });
    fireEvent.change(screen.getByLabelText('Starting member 1 role'), { target: { value: 'Admin' } });
    fireEvent.change(screen.getByLabelText('Starting member 2 email or username'), { target: { value: '@jai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove starting member 3' }));
    expect(screen.queryByLabelText('Starting member 3 email or username')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
    await waitFor(() => expect(mocks.projectApi.create).toHaveBeenCalled());
    expect(mocks.projectApi.create.mock.calls[0][0].members).toEqual([
      { identifier: 'riya@example.com', role: 'Admin' },
      { identifier: 'jai', role: 'Contributor' },
    ]);
  });

  it('shows the server message when a starting member is unknown', async () => {
    mocks.projectApi.create.mockRejectedValueOnce(
      new Error('No DevOrbit user matches: ghost. Check the email or username. Nothing was created.')
    );
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: /add a member/i }));
    fireEvent.change(screen.getByLabelText('Starting member 1 email or username'), { target: { value: 'ghost' } });
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/No DevOrbit user matches: ghost/);
  });
});

describe('startingMembersPayload', () => {
  it('trims, strips @ and drops empty rows', () => {
    expect(startingMembersPayload([{ identifier: ' @riya ', role: 'Viewer' }, { identifier: '   ' }, { identifier: 'a@b.co' }])).toEqual([
      { identifier: 'riya', role: 'Viewer' },
      { identifier: 'a@b.co', role: 'Contributor' },
    ]);
  });
});
