import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { assetUrl, postApi } from '../api';
import { Avatar, initialsOf } from './ui';
import ConfirmDialog from './ConfirmDialog';
import { POST_TEXT_MAX, checkPostText, postErrorMessage, postTextLength, postTimeAgo } from '../posts';

/*
 * [Sprint 5 · M6] One public post, with US-51 Edit or delete my post.
 *   AC1 the author edits the text and saves -> the new text shows, marked "edited"
 *   AC2 the author deletes after confirming -> the post disappears (onDeleted)
 *   AC3 only the author sees Edit/Delete; if someone else tries anyway the server answers 403
 *       and the message is shown here
 *
 * Props: post (API shape, see api.js postApi), api, onUpdated(post), onDeleted(postId), now (tests).
 */
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
        <Avatar initials={initialsOf(author.name)} src={assetUrl(author.avatarUrl)} />
        <div className="post-author">
          <b>{author.name}</b>
          <small>
            {author.username ? `@${author.username} · ` : ''}
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
