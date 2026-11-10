import { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, RefreshCw } from 'lucide-react';
import { postApi } from '../api';
import { EmptyPanel } from './ui';
import PostCard from './PostCard';
import { postErrorMessage } from '../posts';

/*
 * [Sprint 5 · M8] US-53 Browse the trending feed (FR-25, NFR-1a, NFR-15).
 * Public posts in trending order from GET /api/posts/trending (backend/src/routes/trending.js):
 * (upvotes - downvotes) / (ageHours + 2)^1.5, highest first, the newer post on ties. The server
 * recalculates the scores at least every 5 minutes; this list keeps the server's order and never
 * re-sorts itself. Votes (M7's PostVotes inside PostCard) update a card's score straight away; its
 * place in the ranking follows at the next recalculation.
 *
 * Props: api (postApi, swapped in tests), refreshKey (change it to reload, e.g. after posting).
 */

export function rankedAtText(rankedAt) {
  if (!rankedAt) return 'Ranking is being prepared.';
  const date = new Date(rankedAt);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Ranked at ${time} · scores refresh at least every 5 minutes.`;
}

export default function TrendingFeed({ api = postApi, refreshKey = 0 }) {
  const [posts, setPosts] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [rankedAt, setRankedAt] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = request.current + 1;
    request.current = id;
    setLoading(true);
    setError('');
    try {
      const result = await api.trending();
      if (request.current !== id) return;
      setPosts(result.posts || []);
      setNextCursor(result.nextCursor || null);
      setRankedAt(result.rankedAt || null);
    } catch (failure) {
      if (request.current !== id) return;
      setPosts((current) => current || []);
      setError(postErrorMessage(failure, 'Could not load the trending feed. Please try again.'));
    } finally {
      if (request.current === id) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);
  useEffect(
    () => () => {
      request.current += 1;
    },
    []
  );

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.trending({ cursor: nextCursor });
      setPosts((current) => {
        const seen = new Set((current || []).map((post) => post._id));
        return [...(current || []), ...(result.posts || []).filter((post) => !seen.has(post._id))];
      });
      setNextCursor(result.nextCursor || null);
    } catch (failure) {
      setError(postErrorMessage(failure, 'Could not load more posts.'));
    } finally {
      setLoadingMore(false);
    }
  };

  // Keep the server's order: a vote changes the card's numbers, not its place, until the next ranking.
  const updated = (post) => {
    if (post)
      setPosts((current) => (current || []).map((item) => (item._id === post._id ? { ...post, trendingScore: item.trendingScore } : item)));
  };
  const deleted = (postId) => setPosts((current) => (current || []).filter((item) => item._id !== postId));

  return (
    <section className="feed-list" aria-label="Trending posts" aria-busy={loading}>
      <div className="feed-list-head">
        <div>
          <h2>Trending</h2>
          <p className="trending-note">{posts === null ? 'Loading…' : rankedAtText(rankedAt)}</p>
        </div>
        <button type="button" className="iconbtn" aria-label="Refresh trending posts" title="Refresh" onClick={load} disabled={loading}>
          <RefreshCw size={14} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {posts === null && (
        <p className="team-note" role="status">
          Loading trending posts…
        </p>
      )}
      {posts !== null && posts.length === 0 && !error && (
        <EmptyPanel
          icon={Flame}
          title="Nothing trending yet"
          text="Posts rise here as people vote on them. Share something or vote on a post."
        />
      )}
      {posts?.map((post) => (
        <PostCard key={post._id} post={post} api={api} onUpdated={updated} onDeleted={deleted} />
      ))}
      {nextCursor && (
        <button type="button" className="btn secondary feed-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more trending posts'}
        </button>
      )}
    </section>
  );
}
