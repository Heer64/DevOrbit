import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Flag, ImageIcon, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { assetUrl, moderationApi } from '../api';
import { useAuth } from '../context/AuthContext';
import { EmptyPanel, Heading } from '../components/ui';
import ConfirmDialog from '../components/ConfirmDialog';
import { canModerate } from '../platformRoles';

/*
 * [Sprint 6 · M7] US-56 Moderate reported posts. The moderator queue at /moderation.
 *
 * Each reported post is shown with its reasons and report count (AC1). The moderator chooses ONE action (AC2):
 *   Remove  deletes the post (asks first: it cannot be undone)
 *   Warn    sends the author an in-app "Moderation warning"; the post stays
 *   Dismiss closes the reports; nothing changes on the post
 * Each action marks the post's reports resolved, and the card leaves the queue.
 * Anyone who is not a Content Moderator / Platform Admin sees "Content Moderators only"; the API answers 403 (AC3).
 * Never shows who reported a post: the API does not send it.
 */

export const MODERATORS_ONLY_MESSAGE = 'Only a Content Moderator can open the moderator queue.';
export const ALREADY_HANDLED_MESSAGE = 'Another moderator already handled this post. The queue was refreshed.';

const ACTION_WORDS = {
  remove: { verb: 'Remove', done: 'Removed' },
  warn: { verb: 'Warn', done: 'Warned' },
  dismiss: { verb: 'Dismiss', done: 'Dismissed' },
};

export const formatWhen = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ModeratorsOnly() {
  return (
    <div className="admin-page">
      <Heading eyebrow="PLATFORM" title="Moderator queue" />
      <EmptyPanel icon={ShieldAlert} title="Content Moderators only" text={MODERATORS_ONLY_MESSAGE} />
    </div>
  );
}

function ReportCard({ item, busy, onAction }) {
  const { post } = item;
  const author = post.author;
  return (
    <li className="admin-user moderation-item" data-testid="report-card" style={{ display: 'block' }} aria-label={`Reported post by ${author?.name || 'a former user'}`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div className="admin-user-who" style={{ minWidth: 0 }}>
          <div>
            <b>{author?.name || 'A former user'}</b>
            <small>
              {author?.username ? `@${author.username} · ` : ''}Posted {formatWhen(post.createdAt)}{post.edited ? ' · edited' : ''}
              {item.ownPost ? ' · your own post' : ''}
            </small>
          </div>
        </div>
        <span className="admin-badge" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
          <Flag size={11} style={{ marginRight: 4 }} /> {plural(item.reportCount, 'report')}
        </span>
      </div>

      <p style={{ margin: '10px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{post.text}</p>
      {post.hasImage && (
        <p className="muted-note" style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '0 0 8px' }}>
          <ImageIcon size={12} /> Has image
          {post.imageUrl && <img src={assetUrl(post.imageUrl)} alt={`Image in the post by ${author?.name || 'a former user'}`} style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 8, marginLeft: 8 }} />}
        </p>
      )}

      <div className="admin-user-state" aria-label="Reasons">
        {item.reasons.map((reason) => (
          <span key={reason.reason} className="admin-badge">{reason.label} × {reason.count}</span>
        ))}
      </div>
      {item.notes?.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, color: 'var(--muted)' }} aria-label="What reporters wrote">
          {item.notes.map((note, index) => (
            <li key={`${note.reportedAt}-${index}`}>“{note.details}”</li>
          ))}
        </ul>
      )}
      <small className="muted-note" style={{ display: 'block', marginTop: 8 }}>
        First reported {formatWhen(item.firstReportedAt)}
        {item.lastReportedAt && item.lastReportedAt !== item.firstReportedAt ? ` · last ${formatWhen(item.lastReportedAt)}` : ''}
      </small>

      <div className="admin-user-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn secondary small admin-danger" disabled={busy} onClick={() => onAction(item, 'remove')} aria-label={`Remove post by ${author?.name || 'a former user'}`}>
          <Trash2 size={13} /> Remove
        </button>
        <button type="button" className="btn secondary small" disabled={busy} onClick={() => onAction(item, 'warn')} aria-label={`Warn ${author?.name || 'the author'}`}>
          <AlertTriangle size={13} /> Warn
        </button>
        <button type="button" className="btn secondary small" disabled={busy} onClick={() => onAction(item, 'dismiss')} aria-label={`Dismiss reports on post by ${author?.name || 'a former user'}`}>
          <CheckCircle2 size={13} /> Dismiss
        </button>
      </div>
    </li>
  );
}

function RecentDecisions({ actions }) {
  if (!actions?.length) return null;
  return (
    <section className="panel admin-panel" aria-labelledby="moderation-log-title">
      <div className="panel-head"><div><h2 id="moderation-log-title">Recent decisions</h2><p>The moderation log, newest first.</p></div></div>
      <ul className="admin-users" aria-label="Recent decisions">
        {actions.map((entry) => (
          <li key={entry._id} className="admin-user" style={{ display: 'block' }}>
            <b style={{ fontSize: 11 }}>{ACTION_WORDS[entry.action]?.done || entry.action}</b>
            <small className="muted-note">
              {' '}· “{entry.postExcerpt || 'post'}” by {entry.postAuthor?.name || 'a former user'} · {plural(entry.reportCount, 'report')}
              {' '}· by {entry.moderator?.name || 'a former moderator'} · {formatWhen(entry.createdAt)}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ModerationQueue({ api }) {
  const [reports, setReports] = useState(null);
  const [actions, setActions] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState({}); // { [postId]: true } while an action is on its way
  const [notice, setNotice] = useState(null); // { kind: 'success' | 'error', text }
  const [confirming, setConfirming] = useState(null); // the item waiting for "Remove post"
  const [confirmError, setConfirmError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const result = await api.queue();
      setReports(result.reports || []);
    } catch (error) {
      if (error.status === 403) setForbidden(true);
      else setLoadError(error.message || 'Could not load the moderator queue.');
      setReports((old) => old || []);
    }
    try {
      const log = await api.actions();
      setActions(log.actions || []);
    } catch {
      // the log is a convenience; the queue still works without it
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const run = async (item, action) => {
    const postId = item.post._id;
    setBusy((old) => ({ ...old, [postId]: true }));
    setNotice(null);
    try {
      const result = await api[action](postId);
      setReports((old) => (old || []).filter((entry) => entry.post._id !== postId));
      if (result?.moderationAction) setActions((old) => [result.moderationAction, ...old].slice(0, 20));
      setNotice({ kind: 'success', text: result?.message || `${ACTION_WORDS[action].done}.` });
      return true;
    } catch (error) {
      if (error.status === 409 || error.status === 404) {
        setNotice({ kind: 'error', text: error.status === 409 ? ALREADY_HANDLED_MESSAGE : `${error.message} The queue was refreshed.` });
        await load();
        return true;
      }
      if (error.status === 403) { setForbidden(true); return true; }
      setNotice({ kind: 'error', text: error.message || 'That did not work. Please try again.' });
      return false;
    } finally {
      setBusy((old) => { const next = { ...old }; delete next[postId]; return next; });
    }
  };

  const onAction = (item, action) => {
    if (action === 'remove') { setConfirmError(''); setConfirming(item); return; }
    run(item, action);
  };

  const confirmRemove = async () => {
    const item = confirming;
    if (!item) return;
    const ok = await run(item, 'remove');
    if (ok) setConfirming(null);
    else setConfirmError('The post was not removed. Please try again.');
  };

  if (forbidden) return <ModeratorsOnly />;

  const total = reports ? reports.reduce((sum, item) => sum + item.reportCount, 0) : 0;

  return (
    <div className="admin-page">
      <Heading
        eyebrow="PLATFORM"
        title="Moderator queue"
        subtitle="Review reported public posts. Remove deletes the post, Warn sends its author an in-app warning, Dismiss closes the reports. Each choice resolves the reports."
      />

      {reports && (
        <div className="admin-summary" aria-label="Queue summary">
          <span><Flag size={14} /> <b>{reports.length}</b> reported {reports.length === 1 ? 'post' : 'posts'}</span>
          <span><ShieldCheck size={14} /> <b>{total}</b> open {total === 1 ? 'report' : 'reports'}</span>
        </div>
      )}

      <section className="panel admin-panel" aria-labelledby="moderation-queue-title">
        <div className="panel-head">
          <div>
            <h2 id="moderation-queue-title">Reported posts</h2>
            <p>{reports ? 'The post that has waited longest is first.' : 'Loading the queue…'}</p>
          </div>
          <button type="button" className="btn secondary small" onClick={load} aria-label="Refresh queue"><RefreshCw size={13} /> Refresh</button>
        </div>

        {notice?.kind === 'success' && <p className="success-inline admin-notice" role="status">{notice.text}</p>}
        {notice?.kind === 'error' && <div className="form-error admin-notice" role="alert">{notice.text}</div>}
        {loadError && (
          <div className="form-error admin-notice" role="alert">
            {loadError}{' '}<button type="button" className="link" onClick={load}>Try again</button>
          </div>
        )}

        {reports === null && <p className="muted-note">Loading the queue…</p>}
        {reports && reports.length === 0 && !loadError && (
          <EmptyPanel icon={CheckCircle2} title="Nothing to review" text="There are no open reports right now." />
        )}
        {reports && reports.length > 0 && (
          <ul className="admin-users" aria-label="Reported posts">
            {reports.map((item) => (
              <ReportCard key={item.post._id} item={item} busy={Boolean(busy[item.post._id])} onAction={onAction} />
            ))}
          </ul>
        )}
      </section>

      <RecentDecisions actions={actions} />

      <ConfirmDialog
        open={Boolean(confirming)}
        title="Remove this post?"
        confirmLabel="Remove post"
        danger
        busy={Boolean(confirming && busy[confirming.post._id])}
        error={confirmError}
        onConfirm={confirmRemove}
        onCancel={() => { setConfirming(null); setConfirmError(''); }}
      >
        The post by {confirming?.post.author?.name || 'a former user'} will be deleted for everyone, with its image and votes.
        This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}

export default function ModerationPage({ api = moderationApi }) {
  const { user } = useAuth() || {};
  // The link is only shown to moderators; this check is for typed URLs. The server checks again (403).
  if (!canModerate(user)) return <ModeratorsOnly />;
  return <ModerationQueue api={api} />;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M7] What this file does
 * The moderator queue page: each reported post with its reasons and report count, the Remove (with
 * confirmation) / Warn / Dismiss actions, "already handled" and "moderators only" states, and the recent log.
 * ---------------------------------------------------------------------------
 */
