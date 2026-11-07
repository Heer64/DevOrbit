// [Sprint 5 · M7] US-52 Vote on a post: the vote buttons and score on a post card.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostVotes from './PostVotes';
import PostCard from './PostCard';
import { nextVote, voteErrorMessage, voteSummary, withVote } from '../votes';

const post = (extra = {}) => ({
  _id: 'p1',
  author: { _id: 'u1', name: 'Asha Author', username: 'asha', avatarUrl: '' },
  text: 'Vote on me',
  imageUrl: null,
  image: null,
  edited: false,
  editedAt: null,
  createdAt: '2026-11-07T11:55:00.000Z',
  updatedAt: '2026-11-07T11:55:00.000Z',
  upvotes: 0,
  downvotes: 0,
  score: 0,
  myVote: 0,
  isMine: false,
  ...extra,
});

// A fake server that answers like PUT/DELETE /api/posts/:postId/vote.
function fakeApi(start = post()) {
  let current = start;
  const answer = (value) => {
    const previous = current.myVote;
    current = withVote(current, value);
    const outcome = previous === value ? 'unchanged' : previous === 0 ? 'cast' : value === 0 ? 'retracted' : 'changed';
    return Promise.resolve({ post: current, vote: value, previous, outcome, message: 'ok' });
  };
  return {
    vote: vi.fn((id, value) => answer(value)),
    unvote: vi.fn(() => answer(0)),
  };
}

const score = () => screen.getByLabelText(/^Score /).textContent;
// Waits until the vote has been saved (the group is no longer busy).
const saved = () => waitFor(() => expect(screen.getByRole('group', { name: 'Vote on this post' }).getAttribute('aria-busy')).toBeNull());

describe('vote helpers', () => {
  it('a click casts, changes or retracts (FR-24)', () => {
    expect(nextVote(0, 1)).toBe(1);
    expect(nextVote(0, -1)).toBe(-1);
    expect(nextVote(1, -1)).toBe(-1);
    expect(nextVote(-1, 1)).toBe(1);
    expect(nextVote(1, 1)).toBe(0);
    expect(nextVote(-1, -1)).toBe(0);
  });

  it('withVote moves the counters by one vote and keeps score = upvotes - downvotes', () => {
    const start = post({ upvotes: 4, downvotes: 2, score: 2, myVote: 1 });
    expect(withVote(start, -1)).toMatchObject({ upvotes: 3, downvotes: 3, score: 0, myVote: -1 });
    expect(withVote(start, 0)).toMatchObject({ upvotes: 3, downvotes: 2, score: 1, myVote: 0 });
    expect(withVote(start, 1)).toMatchObject({ upvotes: 4, downvotes: 2, score: 2, myVote: 1 });
    expect(withVote(post(), 1)).toMatchObject({ upvotes: 1, score: 1 });
  });

  it('uses "votes" and "score", never "likes" (NFR-27)', () => {
    expect(voteSummary(post({ upvotes: 1, downvotes: 3 }))).toBe('1 upvote · 3 downvotes');
    expect(voteErrorMessage({ status: 500 })).not.toMatch(/like/i);
    expect(voteErrorMessage({ status: 429, message: 'You can vote up to 30 times per minute. Please try again in 12 seconds.' }))
      .toBe('You can vote up to 30 times per minute. Please try again in 12 seconds.');
    expect(voteErrorMessage({ status: 404 })).toMatch(/deleted/);
  });
});

describe('PostVotes', () => {
  it('shows the score and which arrow is mine', () => {
    render(<PostVotes post={post({ upvotes: 5, downvotes: 2, score: 3, myVote: -1 })} api={fakeApi()} />);
    expect(score()).toBe('3');
    expect(screen.getByLabelText('Upvote').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('Remove downvote').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText(/^Score /).getAttribute('title')).toBe('5 upvotes · 2 downvotes');
  });

  it('US-52 AC1: a first upvote moves the score by one and is sent to the server', async () => {
    const api = fakeApi();
    const onVoted = vi.fn();
    render(<PostVotes post={post()} api={api} onVoted={onVoted} />);

    fireEvent.click(screen.getByLabelText('Upvote'));
    expect(score()).toBe('1'); // shown at once
    await saved();
    expect(onVoted).toHaveBeenCalledTimes(1);
    expect(api.vote).toHaveBeenCalledWith('p1', 1);
    expect(onVoted.mock.calls[0][0]).toMatchObject({ score: 1, upvotes: 1, myVote: 1 });
    expect(screen.getByLabelText('Remove upvote').getAttribute('aria-pressed')).toBe('true');
  });

  it('US-52 AC1: a first downvote moves the score by one', async () => {
    const api = fakeApi();
    render(<PostVotes post={post()} api={api} />);
    fireEvent.click(screen.getByLabelText('Downvote'));
    expect(score()).toBe('-1');
    await saved();
    expect(api.vote).toHaveBeenCalledWith('p1', -1);
    expect(score()).toBe('-1');
    expect(screen.getByLabelText('Remove downvote')).toBeTruthy();
  });

  it('FR-24: switching from up to down changes the vote; clicking the active arrow retracts it', async () => {
    const api = fakeApi(post({ upvotes: 1, score: 1, myVote: 1 }));
    render(<PostVotes post={post({ upvotes: 1, score: 1, myVote: 1 })} api={api} />);

    fireEvent.click(screen.getByLabelText('Downvote'));
    expect(score()).toBe('-1');
    await saved();
    expect(api.vote).toHaveBeenLastCalledWith('p1', -1);
    expect(screen.getByLabelText('Remove downvote').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByLabelText('Remove downvote'));
    expect(score()).toBe('0');
    await saved();
    expect(api.unvote).toHaveBeenCalledWith('p1');
    expect(score()).toBe('0');
    expect(screen.getByLabelText('Downvote').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('Upvote').getAttribute('aria-pressed')).toBe('false');
  });

  it('US-52 AC2: fast double clicks send one vote, not two', async () => {
    let resolve;
    const api = { vote: vi.fn(() => new Promise((done) => { resolve = done; })), unvote: vi.fn() };
    render(<PostVotes post={post()} api={api} />);

    fireEvent.click(screen.getByLabelText('Upvote'));
    fireEvent.click(screen.getByLabelText('Remove upvote'));
    fireEvent.click(screen.getByLabelText('Remove upvote'));
    expect(api.vote).toHaveBeenCalledTimes(1);
    expect(api.unvote).not.toHaveBeenCalled();
    expect(score()).toBe('1');

    await act(async () => resolve({ post: post({ upvotes: 1, score: 1, myVote: 1 }) }));
    expect(score()).toBe('1');
  });

  it('NFR-16: a 429 puts the old score back and shows the server message', async () => {
    const message = 'You can vote up to 30 times per minute. Please try again in 20 seconds.';
    const api = {
      vote: vi.fn(() => Promise.reject(Object.assign(new Error(message), { status: 429 }))),
      unvote: vi.fn(),
    };
    const onVoted = vi.fn();
    render(<PostVotes post={post({ upvotes: 2, score: 2 })} api={api} onVoted={onVoted} />);

    fireEvent.click(screen.getByLabelText('Upvote'));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(score()).toBe('2');
    expect(screen.getByLabelText('Upvote').getAttribute('aria-pressed')).toBe('false');
    expect(onVoted).not.toHaveBeenCalled();
  });

  it('a vote on a deleted post explains why it failed', async () => {
    const api = { vote: vi.fn(() => Promise.reject(Object.assign(new Error('Post not found.'), { status: 404 }))), unvote: vi.fn() };
    render(<PostVotes post={post()} api={api} />);
    fireEvent.click(screen.getByLabelText('Downvote'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/deleted/);
    expect(score()).toBe('0');
  });
});

describe('PostCard with votes', () => {
  it('every card shows the vote buttons, and a vote reaches the list through onUpdated', async () => {
    const api = { ...fakeApi(post({ score: 4, upvotes: 4 })), update: vi.fn(), remove: vi.fn() };
    const onUpdated = vi.fn();
    render(<PostCard post={post({ score: 4, upvotes: 4 })} api={api} onUpdated={onUpdated} onDeleted={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Vote on this post' })).toBeTruthy();
    expect(score()).toBe('4');

    fireEvent.click(screen.getByLabelText('Upvote'));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(onUpdated.mock.calls[0][0]).toMatchObject({ _id: 'p1', score: 5, myVote: 1 });
  });
});
