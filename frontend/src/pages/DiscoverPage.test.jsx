// Sprint 2 leftovers: the Discover page on real data (demo users keep the sample cards).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null }));
const mocks = vi.hoisted(() => ({
  projectApi: { discover: vi.fn() },
  userApi: { search: vi.fn() },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import DiscoverPage, { toDiscoverPerson, toDiscoverProject } from './DiscoverPage';

const realUser = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
const apiProjects = [
  { _id: 'p1', name: 'Open Garden', description: 'Community gardening app', domain: 'Community', tags: ['Community'], color: 'mint', progress: 30, members: [{}, {}] },
  { _id: 'p2', name: 'React Toolkit', description: 'Shared UI pieces', domain: 'Developer tools', tags: [], color: 'blue', progress: 70, members: [{}] },
];
const apiPeople = [
  { id: 'u2', name: 'Bob Reactdev', username: 'bob', role: 'Frontend developer', initials: 'BR', skills: ['React'], projects: 1, githubUrl: 'github.com/bob' },
];

function ProjectProbe() {
  const { id } = useParams();
  return <p>Project page {id}</p>;
}

function renderDiscover(route = '/discover') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/project/:id" element={<ProjectProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

const cardTitles = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent.trim());
const projectSearch = () => screen.getByRole('textbox', { name: 'Search projects' });

beforeEach(() => {
  auth.user = realUser;
  mocks.projectApi.discover.mockReset().mockResolvedValue({ projects: apiProjects });
  mocks.userApi.search.mockReset().mockResolvedValue({ people: apiPeople });
});

describe('Discover with real data: projects', () => {
  it('loads public projects from the API instead of the sample cards', async () => {
    renderDiscover();
    expect(screen.getByText('Loading projects…')).toBeTruthy();

    expect(await screen.findByRole('heading', { name: 'Open Garden' })).toBeTruthy();
    expect(cardTitles()).toEqual(['Open Garden', 'React Toolkit']);
    expect(screen.queryByText('Orbit dashboard')).toBeNull();
    expect(mocks.projectApi.discover).toHaveBeenCalledWith('');
    expect(within(screen.getByRole('heading', { name: 'Open Garden' }).closest('article')).getByText('2 members')).toBeTruthy();
  });

  it('debounces the search: one request after typing stops', async () => {
    renderDiscover();
    await screen.findByRole('heading', { name: 'Open Garden' });
    mocks.projectApi.discover.mockResolvedValue({ projects: [apiProjects[1]] });

    fireEvent.change(projectSearch(), { target: { value: 'r' } });
    fireEvent.change(projectSearch(), { target: { value: 're' } });
    fireEvent.change(projectSearch(), { target: { value: 'react' } });

    await waitFor(() => expect(mocks.projectApi.discover).toHaveBeenLastCalledWith('react'));
    const queries = mocks.projectApi.discover.mock.calls.map(([q]) => q);
    expect(queries).toEqual(['', 'react']);
    await waitFor(() => expect(cardTitles()).toEqual(['React Toolkit']));
  });

  it('builds the domain filter from the loaded projects and filters by it', async () => {
    renderDiscover();
    await screen.findByRole('heading', { name: 'Open Garden' });

    const select = screen.getByRole('combobox', { name: 'Filter by domain' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All domains', 'Community', 'Developer tools']);

    fireEvent.change(select, { target: { value: 'Developer tools' } });
    expect(cardTitles()).toEqual(['React Toolkit']);
  });

  it('sorts alphabetically or by most recently active', async () => {
    mocks.projectApi.discover.mockResolvedValue({ projects: [apiProjects[1], apiProjects[0]] });
    renderDiscover();
    await screen.findByRole('heading', { name: 'Open Garden' });
    expect(cardTitles()).toEqual(['React Toolkit', 'Open Garden']);

    fireEvent.click(screen.getByRole('button', { name: 'Sort: Recently active' }));
    expect(cardTitles()).toEqual(['Open Garden', 'React Toolkit']);
  });

  it('opens a project page', async () => {
    renderDiscover();
    fireEvent.click(await screen.findByRole('button', { name: 'View Open Garden' }));
    expect(screen.getByText('Project page p1')).toBeTruthy();
  });

  it('shows an empty state when there are no public projects', async () => {
    mocks.projectApi.discover.mockResolvedValue({ projects: [] });
    renderDiscover();
    expect(await screen.findByText(/No public projects yet/)).toBeTruthy();
  });

  it('shows the error and can try again', async () => {
    mocks.projectApi.discover.mockRejectedValueOnce(new Error('Server is down.'));
    renderDiscover();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Server is down.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Open Garden' })).toBeTruthy();
  });

  it('uses the ?q= link as the first search', async () => {
    renderDiscover('/discover?q=garden');
    await waitFor(() => expect(mocks.projectApi.discover).toHaveBeenCalledWith('garden'));
    expect(projectSearch().value).toBe('garden');
  });
});

describe('Discover with real data: people', () => {
  it('loads discoverable people from the API', async () => {
    renderDiscover();
    await screen.findByRole('heading', { name: 'Open Garden' });
    fireEvent.click(screen.getByRole('button', { name: /^People/ }));

    expect(await screen.findByRole('heading', { name: 'Bob Reactdev' })).toBeTruthy();
    expect(mocks.userApi.search).toHaveBeenCalledWith('');
    expect(screen.getByText('@bob')).toBeTruthy();
    expect(screen.getByText('Frontend developer')).toBeTruthy();
    // There is no follow API yet, so real users do not get a fake Follow button.
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();
    expect(screen.getByRole('link', { name: /GitHub profile/ }).getAttribute('href')).toBe('https://github.com/bob');
  });

  it('shows an empty state when nobody is discoverable', async () => {
    mocks.userApi.search.mockResolvedValue({ people: [] });
    renderDiscover();
    fireEvent.click(screen.getByRole('button', { name: /^People/ }));
    expect(await screen.findByText('No one else has a discoverable profile yet.')).toBeTruthy();
  });
});

describe('Discover for demo users', () => {
  it('keeps the sample projects and never calls the API', () => {
    auth.user = { id: 'demo-user', name: 'Aarav Mehta', isDemo: true };
    renderDiscover();
    expect(screen.getByRole('heading', { name: 'Orbit dashboard' })).toBeTruthy();
    expect(mocks.projectApi.discover).not.toHaveBeenCalled();
  });
});

describe('mapping helpers', () => {
  it('turns API projects and people into card data', () => {
    expect(toDiscoverProject(apiProjects[0])).toMatchObject({ id: 'p1', contributors: 2, tone: 'mint', trending: null, initials: 'OG' });
    expect(toDiscoverProject({}).name).toBe('Untitled project');
    expect(toDiscoverPerson(apiPeople[0])).toMatchObject({ id: 'u2', handle: '@bob', followers: null, skills: ['React'] });
  });
});
