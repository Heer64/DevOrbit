import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Bell, Clock3, UserCheck } from 'lucide-react';
import { notificationApi } from '../api';
import { timeAgo } from './activityDisplay';

/*
 * [Sprint 3 · M7 Part 2] The notification bell in the top bar (US-30, FR-33, NFR-6).
 *
 * - Shows the unread count. New notifications arrive live ('notification:created'), and marking
 *   one read in another tab updates this one too ('notification:read').
 * - Opening the bell lists the newest notifications, labelled Mention, Assignment or Deadline.
 * - Selecting one marks it read and opens the related task or message (its in-app link).
 *
 * Contract: backend/src/routes/notifications.js. `api` can be replaced in tests.
 */
export const NOTIFICATION_KINDS = {
  mention: { label: 'Mention', icon: AtSign, tone: 'purple' },
  assignment: { label: 'Assignment', icon: UserCheck, tone: 'blue' },
  deadline: { label: 'Deadline', icon: Clock3, tone: 'orange' },
};

const PAGE_SIZE = 20;

// Adds notifications that are not in the list yet, newest first.
export function mergeNotifications(list, incoming) {
  const seen = new Set(list.map((item) => item._id));
  const added = incoming.filter((item) => item?._id && !seen.has(item._id));
  return [...list, ...added].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function badgeText(count) {
  if (!count || count < 1) return '';
  return count > 9 ? '9+' : String(count);
}

// Only in-app paths are followed (the server already refuses anything else).
const isInAppLink = (link) => typeof link === 'string' && link.startsWith('/') && !link.startsWith('//');

export default function NotificationBell({ api = notificationApi }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = await api.list({ limit: PAGE_SIZE });
      setItems(result.notifications || []);
      setNextBefore(result.nextBefore || null);
      setUnreadCount(result.unreadCount || 0);
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load notifications.');
      setItems((old) => old || []);
    }
  }, [api]);

  // First load, and again when projects change (leaving a project hides its notifications).
  useEffect(() => {
    load();
    const reload = () => load();
    window.addEventListener('devorbit:projects-updated', reload);
    return () => window.removeEventListener('devorbit:projects-updated', reload);
  }, [load]);

  // Live updates (NFR-6: a new notification shows within seconds).
  useEffect(() => {
    const stopCreated = api.onCreated?.((payload) => {
      if (!payload?.notification) return;
      setItems((old) => mergeNotifications(old || [], [payload.notification]));
      if (typeof payload.unreadCount === 'number') setUnreadCount(payload.unreadCount);
    });
    const stopRead = api.onRead?.((payload) => {
      if (!payload?.notificationId) return;
      setItems((old) => (old || []).map((item) => (item._id === payload.notificationId ? { ...item, read: true } : item)));
      if (typeof payload.unreadCount === 'number') setUnreadCount(payload.unreadCount);
    });
    return () => { stopCreated?.(); stopRead?.(); };
  }, [api]);

  // Close on Escape or a click outside.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onPointer = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onPointer); };
  }, [open]);

  const toggle = () => {
    setOpen((value) => !value);
    if (!open && error) load();
  };

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.list({ limit: PAGE_SIZE, before: nextBefore });
      setItems((old) => mergeNotifications(old || [], result.notifications || []));
      setNextBefore(result.nextBefore || null);
      if (typeof result.unreadCount === 'number') setUnreadCount(result.unreadCount);
    } catch (e) {
      setError(e.message || 'Could not load older notifications.');
    } finally {
      setLoadingMore(false);
    }
  };

  // US-30: "when I select it, then I am taken to the related message or task and it is marked as read".
  const openNotification = async (item) => {
    setOpen(false);
    if (!item.read) {
      setItems((old) => (old || []).map((n) => (n._id === item._id ? { ...n, read: true } : n)));
      setUnreadCount((count) => Math.max(0, count - 1));
      api.markRead(item._id)
        .then((result) => { if (typeof result?.unreadCount === 'number') setUnreadCount(result.unreadCount); })
        .catch(() => load()); // put the real state back if it failed
    }
    if (isInAppLink(item.link)) navigate(item.link);
  };

  const badge = badgeText(unreadCount);

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="iconbtn bell"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        title="Notifications"
        onClick={toggle}
      >
        <Bell size={17} />
        {badge && <span className="notif-badge">{badge}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="region" aria-label="Notifications list">
          <div className="notif-head">
            <b>Notifications</b>
            <small>{unreadCount ? `${unreadCount} unread` : 'All caught up'}</small>
          </div>

          {items === null && <p className="notif-empty">Loading…</p>}
          {error && <div className="form-error" role="alert">{error} <button type="button" className="link" onClick={load}>Try again</button></div>}
          {items && items.length === 0 && !error && <p className="notif-empty">No notifications yet. Mentions, assignments and deadlines will show up here.</p>}

          {items && items.length > 0 && (
            <ul className="notif-list">
              {items.map((item) => {
                const kind = NOTIFICATION_KINDS[item.type] || { label: item.type, icon: Bell, tone: '' };
                const Icon = kind.icon;
                return (
                  <li key={item._id}>
                    <button type="button" className={`notif-item ${item.read ? '' : 'unread'}`} onClick={() => openNotification(item)}>
                      <span className={`notif-icon ${kind.tone}`}><Icon size={14} /></span>
                      <span className="notif-copy">
                        <span className="notif-text">
                          {item.actor?.name && <b>{item.actor.name} </b>}
                          {item.summary}
                        </span>
                        <small>
                          <span className={`notif-kind ${kind.tone}`}>{kind.label}</span>
                          {item.project?.name && <span>{item.project.name}</span>}
                          <span>{timeAgo(item.createdAt)}</span>
                        </small>
                      </span>
                      {!item.read && <i className="notif-dot" aria-label="Unread" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {nextBefore && (
            <button type="button" className="btn secondary small notif-more" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Loading…' : 'Show older'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
