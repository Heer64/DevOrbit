// [Sprint 5 · M8] US-54: a post's author photo, name and @username open their profile, where they can be
// followed. Also: the vote buttons show 👍 / 👎 (names stay "Upvote" / "Downvote").
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import PostCard from './PostCard';

const post = (overrides = {}) => ({
  _id: 'p1',
  author: { _id: 'u1', name: 'Asha Author', username: 'asha.dev', avatarUrl: '' },
  text: 'Hello FORGE',
  imageUrl: null,
  edited: false,
  createdAt: '2026-11-09T04:00:00.000Z',
  upvotes: 2,
  downvotes: 0,
  score: 2,
  myVote: 0,
  isMine: false,
  ...overrides,
});

const api = { vote: vi.fn(), unvote: vi.fn(), update: vi.fn(), remove: vi.fn() };

function ProfileStub() {
  const { username } = useParams();
  return <h1>Profile of {username}</h1>;
}

function renderInApp(item = post()) {
  return render(
    <MemoryRouter initialEntries={['/feed']}>
      <Routes>
        <Route path="/feed" element={<PostCard post={item} api={api} />} />
        <Route path="/people/:username" element={<ProfileStub />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PostCard author links to their profile', () => {
  it('the name is a link to /people/:username and opens that profile', () => {
    renderInApp();
    const link = screen.getByRole('link', { name: 'Asha Author' });
    expect(link.getAttribute('href')).toBe('/people/asha.dev');
    expect(link.getAttribute('title')).toBe("View Asha Author's profile");
    fireEvent.click(link);
    expect(screen.getByRole('heading', { name: 'Profile of asha.dev' })).toBeTruthy();
  });

  it('the photo and @username open the same profile', () => {
    const { container } = renderInApp();
    const photo = container.querySelector('a.post-author-photo');
    expect(photo.getAttribute('href')).toBe('/people/asha.dev');
    expect(photo.getAttribute('tabindex')).toBe('-1'); // one keyboard stop per author: the name
    fireEvent.click(photo);
    expect(screen.getByRole('heading', { name: 'Profile of asha.dev' })).toBeTruthy();
  });

  it('@username link', () => {
    const { container } = renderInApp();
    const handle = container.querySelector('a.post-author-handle');
    expect(handle.textContent).toBe('@asha.dev');
    expect(handle.getAttribute('href')).toBe('/people/asha.dev');
  });

  it('special characters in a username are encoded', () => {
    renderInApp(post({ author: { _id: 'u2', name: 'Odd Name', username: 'odd name', avatarUrl: '' } }));
    expect(screen.getByRole('link', { name: 'Odd Name' }).getAttribute('href')).toBe('/people/odd%20name');
  });

  it('a deleted author is plain text, not a link', () => {
    renderInApp(post({ author: null }));
    expect(screen.getByText('Deleted user')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('outside the app router it is still a normal link (no crash)', () => {
    render(<PostCard post={post()} api={api} />);
    expect(screen.getByRole('link', { name: 'Asha Author' }).getAttribute('href')).toBe('/people/asha.dev');
  });
});

describe('vote buttons show 👍 / 👎', () => {
  it('upvote is 👍 and downvote is 👎, with the same accessible names', () => {
    renderInApp();
    const group = screen.getByRole('group', { name: 'Vote on this post' });
    expect(within(group).getByRole('button', { name: 'Upvote' }).textContent).toBe('👍');
    expect(within(group).getByRole('button', { name: 'Downvote' }).textContent).toBe('👎');
    expect(group.textContent.toLowerCase()).not.toContain('like');
  });

  it('after voting the active button is still named for removing the vote', () => {
    renderInApp(post({ myVote: 1 }));
    const button = screen.getByRole('button', { name: 'Remove upvote' });
    expect(button.textContent).toBe('👍');
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });
});
