// [Sprint 5 · M4] US-48 Find a collaborator by skill: Discover → People skill-tag search.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null }));
const mocks = vi.hoisted(() => ({
  projectApi: { discover: vi.fn() },
  userApi: { search: vi.fn(), searchBySkills: vi.fn() },
  publicApi: { projects: vi.fn(), filters: vi.fn() },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import DiscoverPage, { MAX_SKILL_TAGS, addSkillTags, loadPeopleSearch, peopleSearchKey, toDiscoverPerson } from './DiscoverPage';

const everyone = [
  { id: 'u2', name: 'Amit Frontend', username: 'amit', role: 'DevOrbit member', initials: 'AF', skills: ['CSS', 'React'], projects: 0, githubUrl: '' },
  { id: 'u3', name: 'Ben Designer', username: 'ben', role: 'DevOrbit member', initials: 'BD', skills: ['Figma'], projects: 0, githubUrl: '' },
];
// What the server sends for ?skills=react,css — already ordered by number of matching tags.
const ranked = [
  { ...everyone[0], matchedSkills: ['CSS', 'React'], matchCount: 2 },
  { id: 'u4', name: 'Zoe Reactonly', username: 'zoe', role: 'DevOrbit member', initials: 'ZR', skills: ['REACT', 'Go'], projects: 0, githubUrl: '', matchedSkills: ['REACT'], matchCount: 1 },
];

function renderDiscover() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<DiscoverPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const tagBox = () => screen.getByRole('textbox', { name: 'Add a skill tag' });
const personNames = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent.trim());
async function openPeople() {
  renderDiscover();
  fireEvent.click(screen.getByRole('button', { name: /^People/ }));
  await screen.findByRole('heading', { name: 'Ben Designer' });
}
function addTag(text) {
  fireEvent.change(tagBox(), { target: { value: text } });
  fireEvent.keyDown(tagBox(), { key: 'Enter' });
}

beforeEach(() => {
  auth.user = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
  mocks.projectApi.discover.mockReset().mockResolvedValue({ projects: [] });
  mocks.publicApi.projects.mockReset().mockResolvedValue({ projects: [], total: 0, page: 1, pageSize: 24 });
  mocks.publicApi.filters.mockReset().mockResolvedValue({ domains: [], statuses: [], tags: [] });
  mocks.userApi.search.mockReset().mockResolvedValue({ people: everyone });
  mocks.userApi.searchBySkills.mockReset().mockResolvedValue({ people: ranked });
});

describe('US-48 skill-tag helpers', () => {
  it('addSkillTags: trims, splits on commas, skips repeats in any case, stops at 10, cuts at 40 characters', () => {
    expect(addSkillTags([], ' React , css,')).toEqual(['React', 'css']);
    expect(addSkillTags(['React'], 'REACT')).toEqual(['React']);
    expect(addSkillTags([], '')).toEqual([]);
    expect(addSkillTags([], 'x'.repeat(50))[0]).toHaveLength(40);
    const ten = Array.from({ length: MAX_SKILL_TAGS }, (_, i) => `t${i}`);
    expect(addSkillTags(ten, 'one-more')).toEqual(ten);
  });

  it('plain text still uses the old search; tags use the skill search', () => {
    loadPeopleSearch(peopleSearchKey('bob', []));
    expect(mocks.userApi.search).toHaveBeenCalledWith('bob');
    loadPeopleSearch(peopleSearchKey('bob', ['React', 'CSS']));
    expect(mocks.userApi.searchBySkills).toHaveBeenCalledWith(['React', 'CSS'], 'bob');
  });

  it('keeps the matched tags on the card data', () => {
    expect(toDiscoverPerson(ranked[1])).toMatchObject({ matchedSkills: ['REACT'], matchCount: 1 });
    expect(toDiscoverPerson(everyone[1])).toMatchObject({ matchedSkills: [], matchCount: 0 });
  });
});

describe('Discover → People: find a collaborator by skill (US-48)', () => {
  it('searching by tags shows the server\'s ranking and highlights the matching tags', async () => {
    await openPeople();
    expect(mocks.userApi.search).toHaveBeenCalledWith('');

    addTag('react');
    addTag('css');
    await waitFor(() => expect(mocks.userApi.searchBySkills).toHaveBeenLastCalledWith(['react', 'css'], ''));
    await screen.findByRole('heading', { name: 'Zoe Reactonly' });
    expect(personNames()).toEqual(['Amit Frontend', 'Zoe Reactonly']);

    const amit = screen.getByRole('heading', { name: 'Amit Frontend' }).closest('article');
    expect(within(amit).getByText('Matches 2 skill tags')).toBeTruthy();
    expect(within(amit).getByText('React').className).toContain('matched');
    const zoe = screen.getByRole('heading', { name: 'Zoe Reactonly' }).closest('article');
    expect(within(zoe).getByText('Matches 1 skill tag')).toBeTruthy();
    expect(within(zoe).getByText('Go').className).not.toContain('matched');
  });

  it('a comma also adds a tag, and removing every tag goes back to the normal list', async () => {
    await openPeople();
    fireEvent.change(tagBox(), { target: { value: 'figma,' } });
    expect(screen.getByRole('button', { name: 'Remove figma' })).toBeTruthy();
    await waitFor(() => expect(mocks.userApi.searchBySkills).toHaveBeenLastCalledWith(['figma'], ''));

    mocks.userApi.search.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Remove figma' }));
    await waitFor(() => expect(mocks.userApi.search).toHaveBeenCalledWith(''));
    await screen.findByRole('heading', { name: 'Ben Designer' });
  });

  it('shows a clear empty state when nobody has the tags', async () => {
    mocks.userApi.searchBySkills.mockResolvedValue({ people: [] });
    await openPeople();
    addTag('rust');
    expect(await screen.findByText('No collaborators with those skills yet')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear tags' })[0]);
    await screen.findByRole('heading', { name: 'Ben Designer' });
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('demo users keep the sample cards and no tag box', () => {
    auth.user = { id: 'demo-user', name: 'Aarav Mehta', isDemo: true };
    renderDiscover();
    fireEvent.click(screen.getByRole('button', { name: /^People/ }));
    expect(screen.getByRole('heading', { name: 'Riya Kapoor' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Add a skill tag' })).toBeNull();
    expect(mocks.userApi.searchBySkills).not.toHaveBeenCalled();
  });
});
