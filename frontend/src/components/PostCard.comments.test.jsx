// [Sprint 7 · M3] The post card's comment button: count, open/close, and the count reaching the list.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostCard from './PostCard';

const NOW = Date.parse('2026-11-20T10:00:00.000Z');

const post = (extra = {}) => ({
  _id: 'p1',
  author: { _id: 'u1', name: 'Asha Author', username: 'asha', avatarUrl: '' },
  text: 'Our first release is out',
  imageUrl: null,
  image: null,
  edited: false,
  editedAt: null,
  createdAt: '2026-11-20T09:00:00.000Z',
  updatedAt: '2026-11-20T09:00:00.000Z',
  upvotes: 0,
  downvotes: 0,
  score: 0,
  commentCount: 3,
  isMine: false,
  ...extra,
});

const commentApi = (count = 3) => ({
  list: vi.fn(() => Promise.resolve({
    comments: [{
      _id: 'c1', post: 'p1', parent: null, author: { _id: 'u2', name: 'Ben Shah', username: 'ben', avatarUrl: '' },
      text: 'Congrats!', edited: false, editedAt: null, deleted: false, createdAt: '2026-11-20T09:30:00.000Z', isMine: false, replies: [], replyCount: 0,
    }],
    nextAfter: null,
    commentCount: count,
  })),
  create: vi.fn((postId, { text }) => Promise.resolve({
    comment: { _id: 'c9', post: 'p1', parent: null, author: { _id: 'u3', name: 'Me', username: 'me', avatarUrl: '' }, text, edited: false, deleted: false, createdAt: '2026-11-20T10:00:00.000Z', isMine: true },
    commentCount: count + 1,
    message: 'Your comment was added.',
  })),
  update: vi.fn(),
  remove: vi.fn(),
});

describe('PostCard · comments (Sprint 7 M3)', () => {
  it('shows the comment count; comments load only when opened', async () => {
    const api = commentApi();
    render(<PostCard post={post()} api={{}} commentApi={api} now={NOW} />);
    const toggle = screen.getByRole('button', { name: '3 comments' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(api.list).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('Congrats!')).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith('p1', { limit: 20 });

    fireEvent.click(toggle);
    expect(screen.queryByText('Congrats!')).toBeNull();
  });

  it('a post with no comments (or from before Sprint 7) shows "Add a comment"', () => {
    render(<PostCard post={post({ commentCount: undefined })} api={{}} commentApi={commentApi(0)} now={NOW} />);
    expect(screen.getByRole('button', { name: 'Add a comment' })).toBeTruthy();
  });

  it('a new comment updates the button and reaches the list through onUpdated', async () => {
    const api = commentApi();
    const onUpdated = vi.fn();
    render(<PostCard post={post()} api={{}} commentApi={api} onUpdated={onUpdated} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: '3 comments' }));
    await screen.findByText('Congrats!');

    fireEvent.change(screen.getByLabelText('Write a comment'), { target: { value: 'Nice one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(await screen.findByText('Nice one')).toBeTruthy();
    expect(screen.getByRole('button', { name: '4 comments' })).toBeTruthy();
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ _id: 'p1', commentCount: 4, text: 'Our first release is out' })));
  });

  it('opening does not call onUpdated when the count has not changed', async () => {
    const onUpdated = vi.fn();
    render(<PostCard post={post()} api={{}} commentApi={commentApi(3)} onUpdated={onUpdated} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: '3 comments' }));
    await screen.findByText('Congrats!');
    expect(onUpdated).not.toHaveBeenCalled();
  });
});
