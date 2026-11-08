// [Sprint 5 · M6] Community feed page: list posts, add a new one on top, edit and delete in place, load older.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FeedPage from './FeedPage';
import { postTimeAgo, checkPostImage, checkPostText, postErrorMessage, POST_TEXT_REQUIRED_MESSAGE } from '../posts';

const make = (id, text, extra = {}) => ({
  _id: id,
  author: { _id: 'u1', name: 'Asha Author', username: 'asha', avatarUrl: '' },
  text,
  imageUrl: null,
  edited: false,
  createdAt: '2026-11-07T10:00:00.000Z',
  upvotes: 0,
  downvotes: 0,
  score: 0,
  isMine: true,
  ...extra,
});

function fakeApi() {
  return {
    list: vi.fn(({ before } = {}) => Promise.resolve(before
      ? { posts: [make('p1', 'Oldest post')], nextBefore: null }
      : { posts: [make('p3', 'Newest post'), make('p2', 'Middle post', { isMine: false })], nextBefore: 'p2' })),
    create: vi.fn(({ text }) => Promise.resolve({ post: make('p4', text), message: 'Your post is published.' })),
    update: vi.fn((id, { text }) => Promise.resolve({ post: make(id, text, { edited: true }) })),
    remove: vi.fn((id) => Promise.resolve({ postId: id })),
  };
}

const postTexts = () => within(screen.getByLabelText('Posts')).getAllByRole('article').map((card) => card.querySelector('.post-body')?.textContent);

describe('FeedPage', () => {
  it('lists posts newest first and loads older ones', async () => {
    const api = fakeApi();
    render(<FeedPage api={api} />);
    await screen.findByText('Newest post');
    expect(postTexts()).toEqual(['Newest post', 'Middle post']);

    fireEvent.click(screen.getByRole('button', { name: 'Load older posts' }));
    await screen.findByText('Oldest post');
    expect(api.list).toHaveBeenLastCalledWith({ before: 'p2' });
    expect(postTexts()).toEqual(['Newest post', 'Middle post', 'Oldest post']);
    expect(screen.queryByRole('button', { name: 'Load older posts' })).toBeNull();
  });

  it('a new post appears at the top; a deleted post disappears', async () => {
    const api = fakeApi();
    render(<FeedPage api={api} />);
    await screen.findByText('Newest post');

    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'Brand new' } });
    fireEvent.click(screen.getByRole('button', { name: /^post$/i }));
    await waitFor(() => expect(postTexts()[0]).toBe('Brand new'));

    const card = screen.getByText('Newest post').closest('article');
    fireEvent.click(within(card).getByLabelText('Delete post'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete post' }));
    await waitFor(() => expect(screen.queryByText('Newest post')).toBeNull());
    expect(api.remove).toHaveBeenCalledWith('p3');
  });

  it('only my posts have Edit and Delete', async () => {
    render(<FeedPage api={fakeApi()} />);
    const other = (await screen.findByText('Middle post')).closest('article');
    expect(within(other).queryByLabelText('Edit post')).toBeNull();
    const mine = screen.getByText('Newest post').closest('article');
    expect(within(mine).getByLabelText('Edit post')).toBeTruthy();
  });

  it('shows an empty state and a load error', async () => {
    const api = fakeApi();
    api.list = vi.fn(() => Promise.resolve({ posts: [], nextBefore: null }));
    const { unmount } = render(<FeedPage api={api} />);
    expect(await screen.findByText('No posts yet')).toBeTruthy();
    unmount();

    api.list = vi.fn(() => Promise.reject(Object.assign(new Error('Server down'), { status: 500 })));
    render(<FeedPage api={api} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Server down');
  });
});

describe('post helpers', () => {
  it('check text and images the same way as the server', () => {
    expect(checkPostText('  ')).toBe(POST_TEXT_REQUIRED_MESSAGE);
    expect(checkPostText('a'.repeat(500))).toBe('');
    expect(checkPostText('a'.repeat(501))).toMatch(/500 characters/);
    expect(checkPostImage(null)).toBe('');
    expect(checkPostImage({ type: 'image/png', size: 10 })).toBe('');
    expect(checkPostImage({ type: 'image/svg+xml', size: 10 })).toMatch(/JPEG, PNG or WebP/);
    expect(checkPostImage({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });

  it('formats times and errors', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    expect(postTimeAgo('2026-11-07T11:59:40Z', now)).toBe('just now');
    expect(postTimeAgo('2026-11-07T11:30:00Z', now)).toBe('30 min ago');
    expect(postTimeAgo('2026-11-07T09:00:00Z', now)).toBe('3 h ago');
    expect(postTimeAgo('2026-11-05T12:00:00Z', now)).toBe('2 d ago');
    expect(postErrorMessage({ status: 429, message: 'Wait 5 minutes.' })).toBe('Wait 5 minutes.');
    expect(postErrorMessage({ status: 413 })).toMatch(/5 MB/);
  });
});
