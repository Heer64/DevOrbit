// Sprint 2 leftovers: the Discover page on real data (demo users keep the sample cards).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null }));
const mocks = vi.hoisted(() => ({
  projectApi: { discover: vi.fn() },
  userApi: { search: vi.fn() },
  // [Sprint 5 · M1] US-45: the project list now comes from the no-login public API.
  publicApi: { projects: vi.fn(), filters: vi.fn() },
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

// [Sprint 5 · M1] Shows the current URL query, to check the filters are kept in the link.
function UrlProbe() {
  const location = useLocation();
  return <output data-testid="url">{location.search}</output>;
}

function renderDiscover(route = '/discover') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/discover" element={<><DiscoverPage /><UrlProbe /></>} />
        <Route path="/project/:id" element={<ProjectProbe />} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const noFilters = { q: '', domain: '', tag: '', status: '', page: '' };
const lastRequest = () => mocks.publicApi.projects.mock.calls.at(-1)[0];

const cardTitles = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent.trim());
const projectSearch = () => screen.getByRole('textbox', { name: 'Search projects' });

beforeEach(() => {
  auth.user = realUser;
  mocks.projectApi.discover.mockReset().mockResolvedValue({ projects: apiProjects });
  // [Sprint 5 · M1] US-45
  mocks.publicApi.projects.mockReset().mockResolvedValue({ projects: apiProjects, total: apiProjects.length, page: 1, pageSize: 24 });
  mocks.publicApi.filters.mockReset().mockResolvedValue({ domains: ['Community', 'Developer tools', 'Education'], statuses: ['Planning', 'In progress', 'Completed'], tags: ['CSS', 'React'] });
  mocks.userApi.search.mockReset().mockResolvedValue({ people: apiPeople });
});

describe('Discover with real data: projects', () => {
  it('loads public projects from the API instead of the sample cards', async () => {
    renderDiscover();
    expect(screen.getByText('Loading projects…')).toBeTruthy();

    expect(await screen.findByRole('heading', { name: 'Open Garden' })).toBeTruthy();
    expect(cardTitles()).toEqual(['Open Garden', 'React Toolkit']);
    expect(screen.queryByText('Orbit dashboard')).toBeNull();
    // [Sprint 5 · M1] was projectApi.discover(''): now the public API with no filters.
    expect(mocks.publicApi.projects).toHaveBeenCalledWith(noFilters);
    expect(within(screen.getByRole('heading', { name: 'Open Garden' }).closest('article')).getByText('2 members')).toBeTruthy();
  });

  it('debounces the search: one request after typing stops', async () => {
    renderDiscover();
    await screen.findByRole('heading', { name: 'Open Garden' });
    mocks.publicApi.projects.mockResolvedValue({ projects: [apiProjects[1]], total: 1, page: 1, pageSize: 24 });

    fireEvent.change(projectSearch(), { target: { value: 'r' } });
    fireEvent.change(projectSearch(), { target: { value: 're' } });
    fireEvent.change(projectSearch(), { target: { value: 'react' } });

    // [Sprint 5 · M1] was projectApi.discover('react')
    await waitFor(() => expect(lastRequest().q).toBe('react'));
    const queries = mocks.publicApi.projects.mock.calls.map(([filters]) => filters.q);
    expect(queries).toEqual(['', 'react']);
    await waitFor(() => expect(cardTitles()).toEqual(['React Toolkit']));
  });

  // [Sprint 5 · M1] US-45: the domain choices now come from GET /api/public/projects/filters and the
  // server does the filtering (before: built from the loaded cards and filtered in the browser).
  it('lists the agreed domains and asks the server for the chosen one', async () => {
    renderDiscover();
    await screen.findByRole('heading', { name: 'Open Garden' });

    const select = screen.getByRole('combobox', { name: 'Filter by domain' });
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All domains', 'Community', 'Developer tools', 'Education']));

    mocks.publicApi.projects.mockResolvedValue({ projects: [apiProjects[1]], total: 1, page: 1, pageSize: 24 });
    fireEvent.change(select, { target: { value: 'Developer tools' } });
    await waitFor(() => expect(lastRequest()).toEqual({ ...noFilters, domain: 'Developer tools' }));
    await waitFor(() => expect(cardTitles()).toEqual(['React Toolkit']));
  });

  it('sorts alphabetically or by most recently active', async () => {
    mocks.publicApi.projects.mockResolvedValue({ projects: [apiProjects[1], apiProjects[0]], total: 2, page: 1, pageSize: 24 });
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
    mocks.publicApi.projects.mockResolvedValue({ projects: [], total: 0, page: 1, pageSize: 24 });
    renderDiscover();
    expect(await screen.findByText(/No public projects yet/)).toBeTruthy();
  });

  it('shows the error and can try again', async () => {
    mocks.publicApi.projects.mockRejectedValueOnce(new Error('Server is down.'));
    renderDiscover();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Server is down.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Open Garden' })).toBeTruthy();
  });

  it('uses the ?q= link as the first search', async () => {
    renderDiscover('/discover?q=garden');
    await waitFor(() => expect(mocks.publicApi.projects).toHaveBeenCalledWith({ ...noFilters, q: 'garden' }));
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
    expect(mocks.publicApi.projects).not.toHaveBeenCalled(); // [Sprint 5 · M1]
  });
});

// [Sprint 5 · M1] US-45 Browse and filter public projects (Actor: Visitor, not logged in).
describe('Discover for visitors and filters (US-45)', () => {
  it('a visitor (not logged in) sees the public projects', async () => {
    auth.user = null;
    renderDiscover();
    expect(await screen.findByRole('heading', { name: 'Open Garden' })).toBeTruthy();
    expect(mocks.publicApi.projects).toHaveBeenCalledWith(noFilters);
    expect(screen.queryByText('Login page')).toBeNull();
    expect(screen.queryByText('1.2k+')).toBeNull(); // no demo figures for visitors
  });

  it('a visitor gets a log-in prompt on People instead of a failing search', async () => {
    auth.user = null;
    renderDiscover();
    await screen.findByRole('heading', { name: 'Open Garden' });
    fireEvent.click(screen.getByRole('button', { name: /^People/ }));
    expect(screen.getByText('Log in to meet collaborators')).toBeTruthy();
    expect(mocks.userApi.search).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Login page')).toBeTruthy();
  });

  it('skill-tag and status filters go to the server and into the URL; Clear filters resets them', async () => {
    renderDiscover();
    await screen.findByRole('heading', { name: 'Open Garden' });
    const tag = screen.getByRole('combobox', { name: 'Filter by skill tag' });
    await waitFor(() => expect(within(tag).getAllByRole('option').map((o) => o.textContent)).toEqual(['All skill tags', 'CSS', 'React']));

    fireEvent.change(tag, { target: { value: 'React' } });
    await waitFor(() => expect(lastRequest()).toEqual({ ...noFilters, tag: 'React' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), { target: { value: 'Completed' } });
    await waitFor(() => expect(lastRequest()).toEqual({ ...noFilters, tag: 'React', status: 'Completed' }));
    expect(screen.getByTestId('url').textContent).toBe('?tag=React&status=Completed');

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastRequest()).toEqual(noFilters));
    expect(screen.getByTestId('url').textContent).toBe('');
  });

  it('a shared link with filters loads that filtered list and shows the choices', async () => {
    renderDiscover('/discover?domain=Community&tag=React&status=Planning&page=2');
    await waitFor(() => expect(mocks.publicApi.projects).toHaveBeenCalledWith({ q: '', domain: 'Community', tag: 'React', status: 'Planning', page: '2' }));
    expect(screen.getByRole('combobox', { name: 'Filter by domain' }).value).toBe('Community');
    expect(screen.getByRole('combobox', { name: 'Filter by skill tag' }).value).toBe('React');
    expect(screen.getByRole('combobox', { name: 'Filter by status' }).value).toBe('Planning');
  });

  it('no match: "No public projects match these filters" with a Clear filters button', async () => {
    mocks.publicApi.projects.mockResolvedValue({ projects: [], total: 0, page: 1, pageSize: 24 });
    renderDiscover('/discover?status=Completed');
    expect(await screen.findByText('No public projects match these filters.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });

  it('pages through results 24 at a time', async () => {
    mocks.publicApi.projects.mockResolvedValue({ projects: apiProjects, total: 30, page: 1, pageSize: 24 });
    renderDiscover();
    expect(await screen.findByText('Page 1 of 2')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /Public projects/ }).textContent).toContain('30');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastRequest().page).toBe('2'));
    expect(screen.getByTestId('url').textContent).toBe('?page=2');
  });

  it('cards show status and member count from the public API, without a progress bar', async () => {
    mocks.publicApi.projects.mockResolvedValue({ projects: [{ _id: 'p9', name: 'Air Map', description: 'Maps air', domain: 'Climate tech', tags: ['Python'], status: 'Completed', memberCount: 3 }], total: 1, page: 1, pageSize: 24 });
    renderDiscover();
    const card = (await screen.findByRole('heading', { name: 'Air Map' })).closest('article');
    expect(within(card).getByText('3 members')).toBeTruthy();
    expect(within(card).getByText('Completed')).toBeTruthy();
    expect(within(card).queryByText('Progress')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'View Air Map' }));
    expect(screen.getByText('Project page p9')).toBeTruthy(); // publicProjectPath -> /project/:id for now
  });
});

describe('mapping helpers', () => {
  it('turns API projects and people into card data', () => {
    expect(toDiscoverProject(apiProjects[0])).toMatchObject({ id: 'p1', contributors: 2, tone: 'mint', trending: null, initials: 'OG' });
    expect(toDiscoverProject({}).name).toBe('Untitled project');
    // [Sprint 5 · M1] public API shape
    expect(toDiscoverProject({ _id: 'p3', name: 'X', memberCount: 4, status: 'Planning' })).toMatchObject({ contributors: 4, status: 'Planning', progress: null });
    expect(toDiscoverPerson(apiPeople[0])).toMatchObject({ id: 'u2', handle: '@bob', followers: null, skills: ['React'] });
  });
});
