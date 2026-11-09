import { useCallback, useEffect, useState } from 'react';
import { MessagesSquare, RefreshCw } from 'lucide-react';
import { postApi } from '../api';
import { EmptyPanel, Heading } from '../components/ui';
import PostComposer from '../components/PostComposer';
import PostCard from '../components/PostCard';
import TrendingFeed from '../components/TrendingFeed'; // [Sprint 5 · M8] US-53
import { postErrorMessage } from '../posts';

/*
 * [Sprint 5 · M6] Community feed page at /feed (US-50 create a post, US-51 edit or delete my post).
 * Shows the composer and the public posts, newest first. Sprint 5 M8 changes the order to
 * trending (US-53). [Sprint 5 · M7] Each PostCard has vote buttons (US-52); a vote result comes
 * back through onUpdated, so the list keeps the new score.
 *
 * [Sprint 5 · M8] US-53: two views, "Trending" (default; components/TrendingFeed.jsx, ranked by the
 * server) and "Latest" (M6's newest-first list below, unchanged). The tabs only show when the API
 * has trending (an api without it, as in older tests, gets the Latest list as before).
 *
 * Props: api (postApi, swapped in tests).
 */
export default function FeedPage({ api = postApi }) {
  const [posts, setPosts] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  // [Sprint 5 · M8] US-53
  const hasTrending = typeof api.trending === 'function';
  const [view, setView] = useState(hasTrending ? 'trending' : 'latest');
  const [trendingKey, setTrendingKey] = useState(0);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api.list();
      setPosts(result.posts || []);
      setNextBefore(result.nextBefore || null);
    } catch (failure) {
      setPosts((current) => current || []);
      setError(postErrorMessage(failure, 'Could not load posts. Please try again.'));
    }
  }, [api]);

  // [Sprint 5 · M8] the Latest list loads when it is shown (it is the only view without trending).
  useEffect(() => { if (view === 'latest') load(); }, [load, view]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.list({ before: nextBefore });
      setPosts((current) => {
        const seen = new Set((current || []).map((post) => post._id));
        return [...(current || []), ...(result.posts || []).filter((post) => !seen.has(post._id))];
      });
      setNextBefore(result.nextBefore || null);
    } catch (failure) {
      setError(postErrorMessage(failure, 'Could not load more posts.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const added = (post) => {
    if (post) setPosts((current) => [post, ...(current || []).filter((item) => item._id !== post._id)]);
    setTrendingKey((key) => key + 1); // [Sprint 5 · M8] the new post takes its real place in Trending
  };
  const updated = (post) => { if (post) setPosts((current) => (current || []).map((item) => (item._id === post._id ? post : item))); };
  const deleted = (postId) => setPosts((current) => (current || []).filter((item) => item._id !== postId));

  return (
    <div className="feed-page">
      <Heading eyebrow="COMMUNITY" title="Community feed" subtitle="Share updates with everyone on DevOrbit, outside any single project." />
      <PostComposer api={api} onCreated={added} />

      {/* [Sprint 5 · M8] US-53: Trending / Latest */}
      {hasTrending && (
        <div className="feed-tabs" role="tablist" aria-label="Feed order">
          {[['trending', 'Trending'], ['latest', 'Latest']].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {view === 'trending' && <TrendingFeed api={api} refreshKey={trendingKey} />}

      {view === 'latest' && (
      <section className="feed-list" aria-label="Posts">
        <div className="feed-list-head">
          <h2>Latest posts</h2>
          <button type="button" className="iconbtn" aria-label="Refresh posts" title="Refresh" onClick={load}><RefreshCw size={14} /></button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {posts === null && <p className="team-note">Loading posts…</p>}
        {posts !== null && posts.length === 0 && !error && (
          <EmptyPanel icon={MessagesSquare} title="No posts yet" text="Be the first to share something with the community." />
        )}
        {posts?.map((post) => (
          <PostCard key={post._id} post={post} api={api} onUpdated={updated} onDeleted={deleted} />
        ))}
        {nextBefore && (
          <button type="button" className="btn secondary feed-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load older posts'}
          </button>
        )}
      </section>
      )}
    </div>
  );
}
