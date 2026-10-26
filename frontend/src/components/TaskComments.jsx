import { useEffect, useMemo, useState } from 'react';
import { Loader2, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { assetUrl } from '../api';
import { Avatar, AVATAR_TONES, initialsOf } from './ui';
import { timeAgo } from './activityDisplay';
import MentionTextarea from './MentionTextarea';
import MentionText from './MentionText';

export const COMMENT_MAX = 2000; // same limit as the API
const idOf = (value) => String(value?._id || value?.id || value || '');

// Adds or replaces comments by id and keeps them oldest-first (a live event can arrive before the POST answer).
export function mergeComments(list, incoming) {
  const byId = new Map((list || []).map((comment) => [idOf(comment), comment]));
  for (const comment of incoming) if (comment) byId.set(idOf(comment), comment);
  return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || idOf(a).localeCompare(idOf(b)));
}

// Kept here too so existing imports keep working.
export { MentionText };

/**
 * [Sprint 3 · US-20] Comments under a task: author, time and @mentions.
 * Shown inside the task window (TasksPanel) for saved tasks.
 *
 * Props
 *   projectId, taskId
 *   api            taskApi: needs comments() and addComment(); onComment() for live comments is optional
 *   canComment     Owner / Admin / Contributor. Viewers read only.
 *   members        [{ userId, name, username, avatarUrl }] for @ suggestions
 *   currentUserId  not suggested to yourself
 *
 * It is not a <form>: it sits inside the task edit form, so its button is type="button"
 * and Enter is handled in MentionTextarea.
 */
export default function TaskComments({ projectId, taskId, api, canComment = false, members = [], currentUserId = '' }) {
  const [comments, setComments] = useState(null);
  const [nextAfter, setNextAfter] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    let active = true;
    setComments(null); setLoadError(''); setNextAfter(null);
    api.comments(projectId, taskId)
      .then((result) => { if (active) { setComments(result.comments || []); setNextAfter(result.nextAfter || null); } })
      .catch((error) => { if (active) setLoadError(error.message || 'Could not load comments.'); });
    return () => { active = false; };
  }, [api, projectId, taskId, reloadKey]);

  // Live comments from teammates on this task.
  useEffect(() => {
    if (!api.onComment) return undefined;
    return api.onComment(projectId, (payload) => {
      if (String(payload?.taskId) !== String(taskId) || !payload.comment) return;
      setComments((old) => (old ? mergeComments(old, [payload.comment]) : old));
    });
  }, [api, projectId, taskId]);

  const authors = useMemo(() => [...new Set((comments || []).map((comment) => idOf(comment.author)))], [comments]);

  const loadMore = async () => {
    if (!nextAfter || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.comments(projectId, taskId, { after: nextAfter });
      setComments((old) => mergeComments(old, result.comments || []));
      setNextAfter(result.nextAfter || null);
    } catch (error) {
      setSendError(error.message || 'Could not load more comments.');
    } finally {
      setLoadingMore(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !canComment) return;
    setSending(true); setSendError('');
    try {
      const result = await api.addComment(projectId, taskId, body);
      setComments((old) => mergeComments(old, [result.comment]));
      setDraft('');
    } catch (error) {
      setSendError(error.message || 'Could not post the comment.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="task-comments" aria-label="Comments">
      <h3><MessageCircle size={14} /> Comments{comments ? <span className="task-comments-count">{comments.length}{nextAfter ? '+' : ''}</span> : null}</h3>

      {loadError && (
        <div className="form-error task-comments-error" role="alert">
          {loadError}
          <button type="button" className="link" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={11} /> Try again</button>
        </div>
      )}
      {!loadError && comments === null && <p className="task-comments-state" aria-busy="true"><Loader2 size={14} className="spin" /> Loading comments…</p>}
      {comments && comments.length === 0 && <p className="task-comments-state">No comments yet.{canComment ? ' Start the discussion, and use @ to bring someone in.' : ''}</p>}

      {comments && comments.length > 0 && (
        <ol className="task-comment-list">
          {comments.map((comment) => {
            const author = comment.author || {};
            return (
              <li key={idOf(comment)} className="task-comment">
                <Avatar initials={initialsOf(author.name || 'Former member')} src={assetUrl(author.avatarUrl)} tone={AVATAR_TONES[Math.max(authors.indexOf(idOf(author)), 0) % 4]} small />
                <div>
                  <div className="task-comment-head">
                    <b>{author.name || 'Former member'}</b>
                    <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>{timeAgo(comment.createdAt)}</time>
                  </div>
                  <p><MentionText body={comment.body} mentions={comment.mentions} /></p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {nextAfter && <button type="button" className="link" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more comments'}</button>}

      {canComment ? (
        <div className="task-comment-composer">
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            members={members}
            currentUserId={currentUserId}
            label="Add a comment"
            placeholder="Write a comment… use @ to mention a teammate"
            maxLength={COMMENT_MAX}
            disabled={sending}
          />
          <button type="button" className="btn" onClick={send} disabled={sending || !draft.trim()} aria-label="Post comment">
            {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          </button>
        </div>
      ) : (
        comments && <p className="task-readonly">You can read comments but not add them.</p>
      )}
      {sendError && <p className="form-error" role="alert">{sendError}</p>}
    </section>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · US-20] What this file does
 * The "Comments" section of the task window: the task's comments (author,
 * relative time with the exact time on hover, highlighted @mentions), live
 * comments from teammates, and a comment box with @member suggestions.
 * ---------------------------------------------------------------------------
 */
