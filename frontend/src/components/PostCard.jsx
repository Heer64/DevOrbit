import { useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom'; // [Sprint 5 · M8]
import { Pencil, Trash2 } from 'lucide-react';
import { assetUrl, postApi } from '../api';
import { Avatar, initialsOf } from './ui';
import ConfirmDialog from './ConfirmDialog';
import PostVotes from './PostVotes'; // [Sprint 5 · M7] US-52
import { POST_TEXT_MAX, checkPostText, postErrorMessage, postTextLength, postTimeAgo } from '../posts';

/*
 * [Sprint 5 · M6] One public post, with US-51 Edit or delete my post.
 *   AC1 the author edits the text and saves -> the new text shows, marked "edited"
 *   AC2 the author deletes after confirming -> the post disappears (onDeleted)
 *   AC3 only the author sees Edit/Delete; if someone else tries anyway the server answers 403
 *       and the message is shown here
 *
 * [Sprint 5 · M7] US-52: the vote buttons and score (PostVotes) sit at the bottom of every card.
 *
 * [Sprint 5 · M8] US-54: the author's photo, name and @username open their profile
 * (/people/:username), where they can be followed. Plain text for a deleted author.
 *
 * Props: post (API shape, see api.js postApi), api, onUpdated(post) (also called after a vote),
 *        onDeleted(postId), now (tests).
 */

// [Sprint 5 · M8] A link to /people/:username. Uses the router when there is one (the app), and a
// normal link otherwise (components rendered on their own, e.g. in tests). Without a username: text.
export function ProfileLink({ username, className, children, ...rest }) {
  const inRouter = useInRouterContext();
  if (!username) return <span className={className}>{children}</span>;
  const to = `/people/${encodeURIComponent(username)}`;
  return inRouter
    ? <Link to={to} className={className} {...rest}>{children}</Link>
    : <a href={to} className={className} {...rest}>{children}</a>;
}
export default function PostCard({ post, api = postApi, onUpdated, onDeleted, now }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.text);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const author = post.author || { name: 'Deleted user', username: '' };
  const length = postTextLength(draft);
  const over = length > POST_TEXT_MAX;

  const startEdit = () => { setDraft(post.text); setError(''); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setDraft(post.text); setError(''); };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    const problem = checkPostText(draft);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      const result = await api.update(post._id, { text: draft });
      setEditing(false);
      onUpdated?.(result.post);
    } catch (failure) {
      setError(postErrorMessage(failure, 'Your changes could not be saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.remove(post._id);
      setConfirming(false);
      onDeleted?.(post._id);
    } catch (failure) {
      // Already gone: treat it as deleted so it leaves the list too.
      if (failure?.status === 404) { setConfirming(false); onDeleted?.(post._id); return; }
      setDeleteError(postErrorMessage(failure, 'The post could not be deleted. Please try again.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="panel post-card" aria-label={`Post by ${author.name}`}>
      <header className="post-head">
        {/* [Sprint 5 · M8] photo, name and @username open the author's profile. One tab stop: the name. */}
        <ProfileLink username={author.username} className="post-author-photo" tabIndex={-1} aria-hidden={author.username ? true : undefined}>
          <Avatar initials={initialsOf(author.name)} src={assetUrl(author.avatarUrl)} />
        </ProfileLink>
        <div className="post-author">
          <ProfileLink username={author.username} className="post-author-name" title={author.username ? `View ${author.name}'s profile` : undefined}>
            <b>{author.name}</b>
          </ProfileLink>
          <small>
            {author.username && (
              <>
                <ProfileLink username={author.username} className="post-author-handle" tabIndex={-1}>@{author.username}</ProfileLink>
                {' · '}
              </>
            )}
            <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>{postTimeAgo(post.createdAt, now)}</time>
            {post.edited && <span className="post-edited" title={post.editedAt ? `Edited ${new Date(post.editedAt).toLocaleString()}` : 'Edited'}> · edited</span>}
          </small>
        </div>
        {post.isMine && !editing && (
          <div className="post-actions">
            <button type="button" className="iconbtn" aria-label="Edit post" title="Edit" onClick={startEdit}><Pencil size={14} /></button>
            <button type="button" className="iconbtn" aria-label="Delete post" title="Delete" onClick={() => { setDeleteError(''); setConfirming(true); }}><Trash2 size={14} /></button>
          </div>
        )}
      </header>

      {editing ? (
        <form className="post-edit" onSubmit={save} noValidate>
          <textarea
            className="field-input post-text"
            rows={4}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); if (error) setError(''); }}
            aria-label="Edit post text"
            aria-invalid={over || undefined}
            disabled={saving}
            autoFocus
          />
          <div className="post-composer-bar">
            <span className={`char-count ${over ? 'over' : ''}`}>{length}/{POST_TEXT_MAX}</span>
            <button type="button" className="btn secondary small" onClick={cancelEdit} disabled={saving}>Cancel</button>
            <button type="submit" className="btn small" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      ) : (
        <p className="post-body">{post.text}</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {post.imageUrl && (
        <div className="post-image">
          <img src={assetUrl(post.imageUrl)} alt={`Image shared by ${author.name}`} loading="lazy" />
        </div>
      )}

      <footer className="post-foot">
        <PostVotes post={post} api={api} onVoted={onUpdated} />
      </footer>

      <ConfirmDialog
        open={confirming}
        title="Delete this post?"
        confirmLabel="Delete post"
        danger
        busy={deleting}
        error={deleteError}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      >
        It will disappear from every feed and its votes will no longer count. This cannot be undone.
      </ConfirmDialog>
    </article>
  );
}
