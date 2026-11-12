import { Link } from 'react-router-dom';
import { AlertCircle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { assetUrl } from '../api';
import { Avatar, initialsOf } from './ui';
import { timeAgo } from './activityDisplay';
import { activityTime, badgeText, idOf, previewLine } from '../directMessages';

/*
 * [Sprint 6 · M2] US-19 The inbox: my direct conversations, newest activity first, with a one-line
 * preview ("You: …" when I wrote last) and the number of unread messages. Each row opens
 * /messages/:conversationId.
 *
 * Props
 *   conversations   null while loading, else [conversation] from directMessageApi.inbox()
 *   activeId        the open conversation (highlighted)
 *   error, onRetry  a failed load and how to try again
 */
export default function DmInbox({ conversations, activeId = '', error = '', onRetry }) {
  return (
    <nav className="dm-inbox" aria-label="Conversations">
      <div className="dm-inbox-head">
        <h2>Messages</h2>
        <p>Private one-to-one conversations, separate from project channels.</p>
      </div>

      {error && (
        <div className="dm-state error" role="alert">
          <AlertCircle size={18} />
          <p>{error}</p>
          {onRetry && (
            <button type="button" className="btn secondary" onClick={onRetry}>
              <RefreshCw size={13} /> Try again
            </button>
          )}
        </div>
      )}

      {!error && conversations === null && (
        <div className="dm-state" aria-busy="true">
          <Loader2 size={18} className="spin" />
          <p>Loading conversations…</p>
        </div>
      )}

      {!error && conversations?.length === 0 && (
        <div className="dm-empty">
          <Inbox size={20} />
          <p>No conversations yet.</p>
          <p className="tiny-note">
            Open someone&rsquo;s profile and choose <b>Message</b>. <Link to="/discover">Find people</Link>
          </p>
        </div>
      )}

      {conversations?.length > 0 && (
        <ul className="dm-list">
          {conversations.map((conversation) => {
            const id = idOf(conversation);
            const other = conversation.otherUser || {};
            const unread = conversation.unreadCount || 0;
            const active = id === activeId;
            const at = activityTime(conversation);
            return (
              <li key={id}>
                <Link
                  to={`/messages/${encodeURIComponent(id)}`}
                  className={`dm-row ${active ? 'active' : ''} ${unread > 0 ? 'unread' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Avatar initials={initialsOf(other.name)} src={assetUrl(other.avatarUrl)} small />
                  <span className="dm-row-text">
                    <span className="dm-row-top">
                      <b>{other.name || 'Deleted user'}</b>
                      {at > 0 && <time dateTime={new Date(at).toISOString()}>{timeAgo(at)}</time>}
                    </span>
                    <small>{previewLine(conversation)}</small>
                  </span>
                  {unread > 0 && (
                    <span className="dm-row-badge">
                      <span aria-hidden="true">{badgeText(unread)}</span>
                      <span className="dm-sr-only">{unread} unread</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
