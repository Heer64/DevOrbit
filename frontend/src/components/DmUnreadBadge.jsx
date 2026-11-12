import { useEffect, useState } from 'react';
import { directMessageApi } from '../api';
import { DM_UNREAD_EVENT, badgeText, unreadLabel } from '../directMessages';

/*
 * [Sprint 6 · M2] US-19: unread direct messages, shown next to "Messages" in the sidebar.
 * Starts from GET /api/direct-messages/unread-count, then follows the live events: a new message
 * ('dm:message') and reading in any of my tabs ('dm:read') both carry the new total, so the badge
 * changes within a second without reloading. Shows nothing at 0.
 */
export default function DmUnreadBadge({ api = directMessageApi }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const take = (payload) => {
      const total = Number(payload?.unreadTotal);
      if (active && Number.isFinite(total)) setCount(total);
    };
    api
      .unreadCount()
      .then(take)
      .catch(() => {}); // the badge is a bonus; the Messages page still lists everything
    const stops = [api.onMessage?.(take), api.onRead?.(take)];
    const onWindow = (event) => take(event.detail);
    window.addEventListener(DM_UNREAD_EVENT, onWindow);
    return () => {
      active = false;
      stops.forEach((stop) => stop?.());
      window.removeEventListener(DM_UNREAD_EVENT, onWindow);
    };
  }, [api]);

  const text = badgeText(count);
  if (!text) return null;
  // The number is for the eye; screen readers read the sentence (the link then says "Messages, 2 unread …").
  return (
    <span className="dm-badge" title={unreadLabel(count)} data-testid="dm-unread-badge">
      <span aria-hidden="true">{text}</span>
      <span className="dm-sr-only">{unreadLabel(count)}</span>
    </span>
  );
}
