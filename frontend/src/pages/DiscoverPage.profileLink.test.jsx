// [Sprint 5 · M3] US-06: from collaborator search (Discover → People) a real person's card opens their profile.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null }));
const mocks = vi.hoisted(() => ({
  projectApi: { discover: vi.fn() },
  userApi: { search: vi.fn() },
  publicApi: { projects: vi.fn(), filters: vi.fn() },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import DiscoverPage, { toDiscoverPerson } from './DiscoverPage';

const apiPeople = [
  { id: 'u2', name: 'Bob Skilltag', username: 'bob.skilltag', role: 'Frontend developer', initials: 'BS', skills: ['Svelte'], projects: 1, githubUrl: '' },
  { id: 'u3', name: 'No Handle', username: '', role: 'DevOrbit member', initials: 'NH', skills: [], projects: 0, githubUrl: '' },
];

function ProfileProbe() {
  const { username } = useParams();
  return <p>Profile of {username}</p>;
}

function renderDiscover() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/people/:username" element={<ProfileProbe />} />
        <Route path="/profile" element={<p>My profile page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
  mocks.projectApi.discover.mockReset().mockResolvedValue({ projects: [] });
  mocks.publicApi.projects.mockReset().mockResolvedValue({ projects: [], total: 0, page: 1, pageSize: 24 });
  mocks.publicApi.filters.mockReset().mockResolvedValue({ domains: [], statuses: [], tags: [] });
  mocks.userApi.search.mockReset().mockResolvedValue({ people: apiPeople });
});

describe('Discover people → profile (US-06)', () => {
  it('"View profile" on a real person opens /people/:username', async () => {
    renderDiscover();
    fireEvent.click(screen.getByRole('button', { name: /^People/ }));
    await screen.findByRole('heading', { name: 'Bob Skilltag' });
    const buttons = screen.getAllByRole('button', { name: /View profile/ });
    expect(buttons).toHaveLength(1); // a person without a username has nothing to open
    fireEvent.click(buttons[0]);
    expect(await screen.findByText('Profile of bob.skilltag')).toBeTruthy();
  });

  it('the card data keeps the username for the link', () => {
    expect(toDiscoverPerson(apiPeople[0])).toMatchObject({ username: 'bob.skilltag', handle: '@bob.skilltag' });
    expect(toDiscoverPerson({ name: 'X' }).username).toBe('');
  });
});
