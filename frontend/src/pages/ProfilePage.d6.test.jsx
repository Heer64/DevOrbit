// [Sprint 7 · M4] D6: My profile shows real "About" text and real "Contribution snapshot" numbers,
// plus real Followers / Following counts and lists.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  user: {
    id: 'u1',
    name: 'Ann Author',
    fullName: 'Ann Author',
    username: 'ann',
    bio: 'I build things.',
    skills: ['React'],
    focus: 'Realtime collaboration',
    exploring: '',
    openTo: 'Hackathon teams',
    isDemo: false,
  },
  updateUser: vi.fn(),
}));
const mocks = vi.hoisted(() => ({
  profileApi: {
    snapshot: vi.fn(),
    followers: vi.fn(),
    following: vi.fn(),
    update: vi.fn(),
  },
  projectApi: { list: vi.fn() },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../components/MyPortfolioPanel', () => ({ default: () => null })); // has its own tests; same labels as the snapshot
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import ProfilePage, { joinedText } from './ProfilePage';

const snapshot = {
  projects: 3,
  completedProjects: 1,
  tasksCompleted: 7,
  tasksCompletedThisWeek: 2,
  messagesPosted: 15,
  decisionsRecorded: 4,
  collaborators: 5,
  followerCount: 6,
  followingCount: 2,
  joinedAt: '2026-08-14T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profileApi.snapshot.mockResolvedValue({ snapshot });
  mocks.profileApi.followers.mockResolvedValue({
    people: [{ name: 'Ben Builder', username: 'ben', headline: '', avatarUrl: '' }],
    total: 6,
    page: 1,
    pageSize: 20,
    hasMore: false,
  });
  mocks.profileApi.following.mockResolvedValue({ people: [], total: 2, page: 1, pageSize: 20, hasMore: false });
  mocks.profileApi.update.mockImplementation((payload) => Promise.resolve({ user: { ...auth.user, ...payload } }));
  mocks.projectApi.list.mockResolvedValue({ projects: [] });
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>
  );

describe('ProfilePage D6 (Sprint 7 · M4)', () => {
  it('Contribution snapshot shows the real numbers, not the old fixed ones', async () => {
    renderPage();
    expect(await screen.findByText('Tasks completed')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('+2 this week')).toBeTruthy());
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('Messages posted')).toBeTruthy();
    expect(screen.getByText('Decisions recorded')).toBeTruthy();
    expect(screen.getByText('1/3')).toBeTruthy();
    for (const fixed of ['86%', 'weekly momentum', 'Commits contributed', '+6 this week']) {
      expect(screen.queryByText(fixed)).toBeNull();
    }
  });

  it("About shows the user's own words instead of the fixed paragraph", async () => {
    renderPage();
    expect(await screen.findByText('Realtime collaboration')).toBeTruthy();
    expect(screen.getByText('Hackathon teams')).toBeTruthy();
    expect(screen.queryByText('EXPLORING')).toBeNull();
    expect(screen.queryByText(/turning fuzzy ideas into clear, useful products/)).toBeNull();
    expect(screen.queryByText('Ahmedabad, India')).toBeNull();
    expect(await screen.findByText('Joined August 2026')).toBeTruthy();
  });

  it('real follower / following counts and the lists on My profile', async () => {
    renderPage();
    expect((await screen.findByRole('link', { name: /Ben Builder/ })).getAttribute('href')).toBe('/people/ben');
    expect(mocks.profileApi.followers).toHaveBeenCalledWith('ann', 1);
    await waitFor(() => expect(screen.getByRole('tab', { name: /Following/ }).textContent).toContain('2'));
  });

  it('About fields are saved with "Save changes"', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Edit profile/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Rust and WebAssembly'), { target: { value: '  Rust  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(mocks.profileApi.update).toHaveBeenCalled());
    const payload = mocks.profileApi.update.mock.calls[0][0];
    expect(payload.exploring).toBe('Rust');
    expect(payload.focus).toBe('Realtime collaboration');
    expect(payload.openTo).toBe('Hackathon teams');
  });

  it('joinedText', () => {
    expect(joinedText('2026-09-03T00:00:00.000Z')).toBe('Joined September 2026');
    expect(joinedText(null)).toBe('');
    expect(joinedText('nope')).toBe('');
  });
});
