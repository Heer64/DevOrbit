// [Sprint 5 · M8] US-53: the trending feed view and the Trending / Latest tabs on the feed page.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TrendingFeed, { rankedAtText } from './TrendingFeed';
import FeedPage from '../pages/FeedPage';

const make = (id, text, extra = {}) => ({
  _id: id,
  author: { _id: 'u1', name: 'Asha Author', username: 'asha', avatarUrl: '' },
  text,
  imageUrl: null,
  edited: false,
  createdAt: '2026-11-09T04:00:00.000Z',
  upvotes: 0,
  downvotes: 0,
  score: 0,
  myVote: 0,
  isMine: false,
  trendingScore: 0,
  ...extra,
});

const RANKED_AT = '2026-11-09T05:00:00.000Z';
const page1 = {
  posts: [
    make('t1', 'Hot post', { upvotes: 9, score: 9, trendingScore: 3.1 }),
    make('t2', 'Warm post', { upvotes: 2, score: 2, trendingScore: 0.7 }),
  ],
  nextCursor: 'CURSOR1',
  rankedAt: RANKED_AT,
};
const page2 = {
  posts: [make('t3', 'Cold post', { downvotes: 1, score: -1, trendingScore: -0.2 }), make('t2', 'Warm post')],
  nextCursor: null,
  rankedAt: RANKED_AT,
};

function fakeApi(overrides = {}) {
  return {
    trending: vi.fn(({ cursor } = {}) => Promise.resolve(cursor ? page2 : page1)),
    list: vi.fn(() => Promise.resolve({ posts: [make('n1', 'Newest post')], nextBefore: null })),
    create: vi.fn(({ text }) => Promise.resolve({ post: make('p9', text, { isMine: true }), message: 'Your post is published.' })),
    vote: vi.fn((id, value) =>
      Promise.resolve({
        post: make(id, 'Warm post', { upvotes: 3, score: 3, myVote: value }),
        vote: value,
        previous: 0,
        outcome: 'cast',
        message: 'Vote counted.',
      })
    ),
    unvote: vi.fn(),
    update: vi.fn(),
    remove: vi.fn((id) => Promise.resolve({ postId: id })),
    ...overrides,
  };
}

const cardTexts = (region) =>
  within(region)
    .getAllByRole('article')
    .map((card) => card.querySelector('.post-body')?.textContent);

describe('TrendingFeed', () => {
  it("shows the server's trending order and when it was ranked", async () => {
    const api = fakeApi();
    render(<TrendingFeed api={api} />);
    expect(screen.getByRole('status').textContent).toContain('Loading trending posts');
    const region = screen.getByLabelText('Trending posts');
    await screen.findByText('Hot post');
    expect(cardTexts(region)).toEqual(['Hot post', 'Warm post']);
    expect(api.trending).toHaveBeenCalledWith();
    expect(screen.getByText(/scores refresh at least every 5 minutes/)).toBeTruthy();
  });

  it('loads more with the cursor, without repeating a post', async () => {
    const api = fakeApi();
    render(<TrendingFeed api={api} />);
    await screen.findByText('Hot post');
    fireEvent.click(screen.getByRole('button', { name: 'Load more trending posts' }));
    await screen.findByText('Cold post');
    expect(api.trending).toHaveBeenLastCalledWith({ cursor: 'CURSOR1' });
    expect(cardTexts(screen.getByLabelText('Trending posts'))).toEqual(['Hot post', 'Warm post', 'Cold post']);
    expect(screen.queryByRole('button', { name: 'Load more trending posts' })).toBeNull();
  });

  it("a vote updates the card's score but keeps its place until the next ranking", async () => {
    const api = fakeApi();
    render(<TrendingFeed api={api} />);
    await screen.findByText('Warm post');
    const region = screen.getByLabelText('Trending posts');
    const warm = within(region).getAllByRole('article')[1];
    fireEvent.click(within(warm).getByRole('button', { name: /upvote/i }));
    await waitFor(() => expect(api.vote).toHaveBeenCalledWith('t2', 1));
    await waitFor(() => expect(within(within(region).getAllByRole('article')[1]).getByLabelText('Score 3')).toBeTruthy());
    expect(cardTexts(region)).toEqual(['Hot post', 'Warm post']);
  });

  it('empty feed: a friendly message', async () => {
    render(
      <TrendingFeed api={fakeApi({ trending: vi.fn(() => Promise.resolve({ posts: [], nextCursor: null, rankedAt: RANKED_AT })) })} />
    );
    expect(await screen.findByText('Nothing trending yet')).toBeTruthy();
  });

  it('errors are shown, and Refresh tries again', async () => {
    const trending = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Server is down'), { status: 500 }))
      .mockResolvedValueOnce(page1);
    render(<TrendingFeed api={fakeApi({ trending })} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Server is down');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh trending posts' }));
    expect(await screen.findByText('Hot post')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reloads when refreshKey changes (e.g. after posting)', async () => {
    const api = fakeApi();
    const { rerender } = render(<TrendingFeed api={api} refreshKey={0} />);
    await screen.findByText('Hot post');
    rerender(<TrendingFeed api={api} refreshKey={1} />);
    await waitFor(() => expect(api.trending).toHaveBeenCalledTimes(2));
  });

  it('rankedAtText', () => {
    expect(rankedAtText(null)).toBe('Ranking is being prepared.');
    expect(rankedAtText('nope')).toBe('');
    expect(rankedAtText(RANKED_AT)).toMatch(/^Ranked at .+ · scores refresh at least every 5 minutes\.$/);
  });
});

describe('FeedPage with trending (US-53)', () => {
  it("opens on Trending; Latest shows M6's newest-first list", async () => {
    const api = fakeApi();
    render(<FeedPage api={api} />);
    const tabs = screen.getByRole('tablist', { name: 'Feed order' });
    expect(within(tabs).getByRole('tab', { name: 'Trending' }).getAttribute('aria-selected')).toBe('true');
    await screen.findByText('Hot post');
    expect(api.list).not.toHaveBeenCalled();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Latest' }));
    expect(await screen.findByText('Newest post')).toBeTruthy();
    expect(api.list).toHaveBeenCalled();
    expect(screen.queryByLabelText('Trending posts')).toBeNull();
  });

  it('after posting, the trending list reloads so the new post appears in its real place', async () => {
    const api = fakeApi();
    render(<FeedPage api={api} />);
    await screen.findByText('Hot post');
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'Fresh thoughts' } });
    fireEvent.click(screen.getByRole('button', { name: /^post$/i }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    await waitFor(() => expect(api.trending).toHaveBeenCalledTimes(2));
  });

  it('an api without trending keeps the old Latest-only page (no tabs)', async () => {
    const { trending, ...withoutTrending } = fakeApi();
    render(<FeedPage api={withoutTrending} />);
    expect(await screen.findByText('Newest post')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(trending).not.toHaveBeenCalled();
  });
});
