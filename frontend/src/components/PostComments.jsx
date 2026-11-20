import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { CornerDownRight, Pencil, Reply, Trash2 } from 'lucide-react';
import { assetUrl, postCommentApi } from '../api';
import { Avatar, initialsOf } from './ui';
import ConfirmDialog from './ConfirmDialog';
import { postTimeAgo } from '../posts';
import {
  COMMENT_DELETED_PLACEHOLDER,
  COMMENT_TEXT_MAX,
  COMMENTS_PAGE_SIZE,
  addComment,
  checkCommentText,
  commentErrorMessage,
  commentTextLength,
  removeComment,
  replaceComment,
} from '../comments';
import './PostComments.css';

/*
 * [Sprint 7 · M3] Comments and replies under a feed post (opened from the post card).
 *
 *   - Comment on the post. Reply to a comment (one level deep: replies have no Reply button).
 *   - Edit or delete your own comment or reply. Edited ones show "edited". Deleting asks first.
 *     A deleted comment that still has replies shows "Comment deleted" with its replies under it.
 *   - Every change reports the post's new comment count through onCountChange(count), so the
 *     card's "N comments" button stays right.
 *
 * Props: postId, api (postCommentApi, swapped in tests), onCountChange(count), now (tests).
 * Contract: backend/src/routes/postComments.js.
 */

// A link to the author's profile (/people/:username), like the post card's. Plain text without a username.
// Kept here (not imported from PostCard) so PostCard -> PostComments has no import cycle.
function ProfileLink({ username, className, children, ...rest }) {
  const inRouter = useInRouterContext();
  if (!username) return <span className={className}>{children}</span>;
  const to = `/people/${encodeURIComponent(username)}`;
  return inRouter
    ? <Link to={to} className={className} {...rest}>{children}</Link>
    : <a href={to} className={className} {...rest}>{children}</a>;
}

// The box used for a new comment, a reply and an edit.
function CommentForm({ label, submitLabel, initial = '', busyLabel = 'Saving…', onSubmit, onCancel, autoFocus = false }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const length = commentTextLength(text);
  const over = length > COMMENT_TEXT_MAX;

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const problem = checkCommentText(text);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      const ok = await onSubmit(text);
      if (ok !== false) setText('');
    } catch (failure) {
      setError(commentErrorMessage(failure, 'It could not be saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pc-form" onSubmit={submit} noValidate>
      <textarea
        className="field-input pc-input"
        rows={2}
        value={text}
        placeholder={label}
        aria-label={label}
        aria-invalid={over || undefined}
        disabled={busy}
        autoFocus={autoFocus}
        onChange={(event) => { setText(event.target.value); if (error) setError(''); }}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="pc-form-bar">
        <span className={`char-count ${over ? 'over' : ''}`}>{length}/{COMMENT_TEXT_MAX}</span>
        {onCancel && <button type="button" className="btn secondary small" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button type="submit" className="btn small" disabled={busy}>{busy ? busyLabel : submitLabel}</button>
      </div>
    </form>
  );
}

// One comment or reply. Top-level comments also show their replies and the reply box.
function CommentItem({ comment, isReply = false, now, replyingTo, editingId, onReply, onEdit, onSaveEdit, onAskDelete, onSendReply, children }) {
  const editing = editingId === comment._id;
  const author = comment.author || { name: 'Deleted user', username: '' };

  if (comment.deleted) {
    return (
      <li className="pc-item pc-deleted">
        <p className="pc-deleted-text">{COMMENT_DELETED_PLACEHOLDER}</p>
        {children}
      </li>
    );
  }

  return (
    <li className={`pc-item ${isReply ? 'pc-reply' : ''}`} aria-label={`${isReply ? 'Reply' : 'Comment'} by ${author.name}`}>
      <div className="pc-row">
        <ProfileLink username={author.username} className="pc-photo" tabIndex={-1} aria-hidden={author.username ? true : undefined}>
          <Avatar small initials={initialsOf(author.name)} src={assetUrl(author.avatarUrl)} />
        </ProfileLink>
        <div className="pc-main">
          <div className="pc-meta">
            <ProfileLink username={author.username} className="pc-name"><b>{author.name}</b></ProfileLink>
            <small>
              <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>{postTimeAgo(comment.createdAt, now)}</time>
              {comment.edited && <span className="pc-edited" title={comment.editedAt ? `Edited ${new Date(comment.editedAt).toLocaleString()}` : 'Edited'}> · edited</span>}
            </small>
          </div>

          {editing ? (
            <CommentForm
              label={`Edit your ${isReply ? 'reply' : 'comment'}`}
              submitLabel="Save"
              initial={comment.text}
              autoFocus
              onSubmit={(text) => onSaveEdit(comment, text)}
              onCancel={() => onEdit(null)}
            />
          ) : (
            <p className="pc-text">{comment.text}</p>
          )}

          {!editing && (
            <div className="pc-actions">
              {!isReply && (
                <button type="button" className="pc-link" onClick={() => onReply(replyingTo === comment._id ? null : comment._id)} aria-expanded={replyingTo === comment._id}>
                  <Reply size={13} aria-hidden="true" /> Reply
                </button>
              )}
              {comment.isMine && (
                <>
                  <button type="button" className="pc-link" aria-label={`Edit ${isReply ? 'reply' : 'comment'}`} onClick={() => onEdit(comment._id)}>
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </button>
                  <button type="button" className="pc-link danger" aria-label={`Delete ${isReply ? 'reply' : 'comment'}`} onClick={() => onAskDelete(comment)}>
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {children}
      {!isReply && replyingTo === comment._id && (
        <div className="pc-reply-box">
          <CornerDownRight size={15} aria-hidden="true" className="pc-reply-arrow" />
          <CommentForm
            label={`Reply to ${author.name}`}
            submitLabel="Reply"
            busyLabel="Sending…"
            autoFocus
            onSubmit={(text) => onSendReply(comment, text)}
            onCancel={() => onReply(null)}
          />
        </div>
      )}
    </li>
  );
}

export default function PostComments({ postId, api = postCommentApi, onCountChange, now }) {
  const [comments, setComments] = useState(null);
  const [nextAfter, setNextAfter] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [notice, setNotice] = useState('');
  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // Always the latest onCountChange (the card passes a new one each render, with the latest post in it).
  const countChangeRef = useRef(onCountChange);
  useEffect(() => { countChangeRef.current = onCountChange; });
  const counted = (result) => { if (typeof result?.commentCount === 'number') countChangeRef.current?.(result.commentCount); };

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api.list(postId, { limit: COMMENTS_PAGE_SIZE });
      setComments(result.comments || []);
      setNextAfter(result.nextAfter || null);
      counted(result);
    } catch (failure) {
      setComments((current) => current || []);
      setError(commentErrorMessage(failure, 'Could not load comments. Please try again.'));
    }
  // counted() only reads a ref, so it is left out: a new function each render must not reload the list.
  }, [api, postId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!nextAfter || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.list(postId, { after: nextAfter, limit: COMMENTS_PAGE_SIZE });
      setComments((current) => (result.comments || []).reduce(addComment, current || []));
      setNextAfter(result.nextAfter || null);
    } catch (failure) {
      setError(commentErrorMessage(failure, 'Could not load more comments.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const sendComment = async (text) => {
    const result = await api.create(postId, { text });
    setComments((current) => addComment(current || [], result.comment));
    counted(result);
    setNotice(result.message || 'Your comment was added.');
  };

  const sendReply = async (parent, text) => {
    const result = await api.create(postId, { text, parentId: parent._id });
    setComments((current) => addComment(current || [], result.comment));
    counted(result);
    setReplyingTo(null);
    setNotice(result.message || 'Your reply was added.');
  };

  const saveEdit = async (comment, text) => {
    const result = await api.update(postId, comment._id, { text });
    setComments((current) => replaceComment(current || [], result.comment));
    setEditingId(null);
    setNotice(result.message || 'Your comment was updated.');
  };

  const askDelete = (comment) => { setDeleteError(''); setPendingDelete(comment); };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const result = await api.remove(postId, pendingDelete._id);
      setComments((current) => removeComment(current || [], result));
      counted(result);
      setNotice(result.message || 'Your comment was deleted.');
      setPendingDelete(null);
    } catch (failure) {
      // Already gone: reload so the list matches the server.
      if (failure?.status === 404) { setPendingDelete(null); load(); return; }
      setDeleteError(commentErrorMessage(failure, 'It could not be deleted. Please try again.'));
    } finally {
      setDeleting(false);
    }
  };

  const shared = {
    now,
    replyingTo,
    editingId,
    onReply: (id) => { setReplyingTo(id); setEditingId(null); setNotice(''); },
    onEdit: (id) => { setEditingId(id); setReplyingTo(null); setNotice(''); },
    onSaveEdit: saveEdit,
    onAskDelete: askDelete,
    onSendReply: sendReply,
  };

  const pendingIsReply = Boolean(pendingDelete?.parent);
  const pendingHasReplies = !pendingIsReply && (pendingDelete?.replies || []).length > 0;

  return (
    <section className="pc" aria-label="Comments">
      {error && <p className="form-error" role="alert">{error}</p>}
      {comments === null && <p className="pc-note">Loading comments…</p>}
      {comments !== null && comments.length === 0 && !error && <p className="pc-note">No comments yet. Start the conversation.</p>}

      {comments !== null && comments.length > 0 && (
        <ul className="pc-list">
          {comments.map((comment) => (
            <CommentItem key={comment._id} comment={comment} {...shared}>
              {(comment.replies || []).length > 0 && (
                <ul className="pc-list pc-replies" aria-label={`Replies (${comment.replies.length})`}>
                  {comment.replies.map((reply) => (
                    <CommentItem key={reply._id} comment={reply} isReply {...shared} />
                  ))}
                </ul>
              )}
            </CommentItem>
          ))}
        </ul>
      )}

      {nextAfter && (
        <button type="button" className="btn secondary small pc-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show more comments'}
        </button>
      )}

      {notice && <p className="success-inline pc-notice" role="status">{notice}</p>}

      <CommentForm label="Write a comment" submitLabel="Comment" busyLabel="Sending…" onSubmit={sendComment} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingIsReply ? 'Delete this reply?' : 'Delete this comment?'}
        confirmLabel={pendingIsReply ? 'Delete reply' : 'Delete comment'}
        danger
        busy={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        {pendingHasReplies
          ? 'It will show as "Comment deleted". The replies under it stay. This cannot be undone.'
          : 'It will be removed for everyone. This cannot be undone.'}
      </ConfirmDialog>
    </section>
  );
}
