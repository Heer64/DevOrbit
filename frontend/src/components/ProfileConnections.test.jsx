// [Sprint 7 · M4] Followers / following lists on a profile.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfileConnections from './ProfileConnections';

const person = (n) => ({ name: `Person ${n}`, username: `person.${n}`, headline: n === 1 ? 'Backend dev' : '', avatarUrl: '' });
const page = (people, extra = {}) => ({ people, total: people.length, page: 1, pageSize: 20, hasMore: false, ...extra });

function renderLists(api, props = {}) {
  return render(
    <MemoryRouter>
      <ProfileConnections username="ann" name="Ann Author" followerCount={2} followingCount={1} api={api} {...props} />
    </MemoryRouter>
  );
}

describe('ProfileConnections (Sprint 7 · M4)', () => {
  it('shows followers first, each linking to their profile, with the counts on the tabs', async () => {
    const api = { followers: vi.fn(() => Promise.resolve(page([person(1), person(2)]))), following: vi.fn() };
    renderLists(api);
    const link = await screen.findByRole('link', { name: /Person 1/ });
    expect(link.getAttribute('href')).toBe('/people/person.1');
    expect(screen.getByText('@person.1 · Backend dev')).toBeTruthy();
    expect(api.followers).toHaveBeenCalledWith('ann', 1);
    expect(screen.getByRole('tab', { name: /Followers/ }).textContent).toContain('2');
    expect(screen.getByRole('tab', { name: /Following/ }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /Followers/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('switches to the Following list', async () => {
    const api = {
      followers: vi.fn(() => Promise.resolve(page([person(1)]))),
      following: vi.fn(() => Promise.resolve(page([person(9)]))),
    };
    renderLists(api);
    await screen.findByText('Person 1');
    fireEvent.click(screen.getByRole('tab', { name: /Following/ }));
    expect(await screen.findByText('Person 9')).toBeTruthy();
    expect(api.following).toHaveBeenCalledWith('ann', 1);
    expect(screen.queryByText('Person 1')).toBeNull();
  });

  it('loads 20 more with "Show more"', async () => {
    const first = Array.from({ length: 20 }, (_, i) => person(i + 1));
    const api = {
      followers: vi.fn((_u, p) =>
        Promise.resolve(p === 1 ? page(first, { total: 21, hasMore: true }) : page([person(21)], { total: 21, page: 2 }))
      ),
      following: vi.fn(),
    };
    renderLists(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Person 21')).toBeTruthy();
    expect(screen.getByText('Person 1')).toBeTruthy();
    expect(api.followers).toHaveBeenLastCalledWith('ann', 2);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('empty lists say so, in your own words on My profile', async () => {
    const api = { followers: vi.fn(() => Promise.resolve(page([]))), following: vi.fn(() => Promise.resolve(page([]))) };
    renderLists(api, { isMe: true });
    expect(await screen.findByText('You have no followers yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Following/ }));
    expect(await screen.findByText('You are not following anyone yet.')).toBeTruthy();
  });

  it('shows an error when the list cannot load', async () => {
    const api = { followers: vi.fn(() => Promise.reject(new Error('Server is busy.'))), following: vi.fn() };
    renderLists(api);
    expect((await screen.findByRole('alert')).textContent).toBe('Server is busy.');
  });

  it('reloads when refreshKey changes (after Follow / Unfollow)', async () => {
    const api = { followers: vi.fn(() => Promise.resolve(page([person(1)]))), following: vi.fn() };
    const { rerender } = renderLists(api, { refreshKey: 'a' });
    await screen.findByText('Person 1');
    rerender(
      <MemoryRouter>
        <ProfileConnections username="ann" name="Ann Author" followerCount={3} followingCount={1} api={api} refreshKey="b" />
      </MemoryRouter>
    );
    await waitFor(() => expect(api.followers).toHaveBeenCalledTimes(2));
  });

  it('renders nothing when the api has no list calls', () => {
    const { container } = renderLists({ user: vi.fn() });
    expect(container.textContent).toBe('');
  });
});
