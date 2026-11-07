import { useCallback, useEffect, useState } from 'react';
import { MessagesSquare, RefreshCw } from 'lucide-react';
import { postApi } from '../api';
import { EmptyPanel, Heading } from '../components/ui';
import PostComposer from '../components/PostComposer';
import PostCard from '../components/PostCard';
import { postErrorMessage } from '../posts';

/*
 * [Sprint 5 · M6] Community feed page at /feed (US-50 create a post, US-51 edit or delete my post).
 * Shows the composer and the public posts, newest first. Sprint 5 M8 changes the order to
 * trending (US-53) and M7 adds voting (US-52) to each PostCard.
 *
 * Props: api (postApi, swapped in tests).
 */
export default function FeedPage({ api = postApi }) {
  const [posts, setPosts] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

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

  useEffect(() => { load(); }, [load]);

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

  const added = (post) => { if (post) setPosts((current) => [post, ...(current || []).filter((item) => item._id !== post._id)]); };
  const updated = (post) => { if (post) setPosts((current) => (current || []).map((item) => (item._id === post._id ? post : item))); };
  const deleted = (postId) => setPosts((current) => (current || []).filter((item) => item._id !== postId));

  return (
    <div className="feed-page">
      <Heading eyebrow="COMMUNITY" title="Community feed" subtitle="Share updates with everyone on DevOrbit, outside any single project." />
      <PostComposer api={api} onCreated={added} />

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
    </div>
  );
}
