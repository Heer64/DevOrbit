import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, ChevronRight, X } from 'lucide-react';
import './LiveAlerts.css';

/*
 * [Sprint 7 · M6] Notification popup: a short card in the top-right corner when a new notification
 * arrives live ('notification:created'). NotificationBell owns the list and passes the new ones here.
 *
 * - Shows who did what (and in which project), labelled like the bell (Mention, Assignment, …).
 * - Selecting it does the same as selecting the notification in the bell: marks it read and opens
 *   the related task, message, post or page (onOpen).
 * - Goes away by itself after `durationMs` (the timer waits while the pointer or keyboard focus is
 *   on it), or with the close button. At most MAX_TOASTS are shown; the oldest goes first.
 * - Rendered into <body> through a portal: the top bar has a backdrop-filter, which would otherwise
 *   trap a position: fixed popup inside it.
 * - The region is aria-live="polite", so screen readers read a new popup without moving focus.
 */
export const MAX_TOASTS = 3;
export const TOAST_DURATION_MS = 6000;

// Adds one notification to the shown popups: never twice, newest last, at most MAX_TOASTS.
export function addToast(toasts, notification, max = MAX_TOASTS) {
  if (!notification?._id || toasts.some((item) => item._id === notification._id)) return toasts;
  return [...toasts, notification].slice(-max);
}

function Toast({ item, kind, onOpen, onDismiss, durationMs }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || !durationMs) return undefined;
    const timer = setTimeout(() => onDismiss(item._id), durationMs);
    return () => clearTimeout(timer);
  }, [paused, durationMs, item._id, onDismiss]);

  const Icon = kind.icon || Bell;
  const where = item.project?.name;

  return (
    <div
      className={`live-toast ${kind.tone || ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <button type="button" className="live-toast-open" onClick={() => onOpen(item)}>
        <span className={`notif-icon ${kind.tone || ''}`}>
          <Icon size={15} />
        </span>
        <span className="live-toast-copy">
          <span className={`notif-kind ${kind.tone || ''}`}>{kind.label}</span>
          <span className="live-toast-text">
            {item.actor?.name && <b>{item.actor.name} </b>}
            {item.summary}
          </span>
          <small>
            {where && <span>{where}</span>}
            <span className="live-toast-cta">
              Open <ChevronRight size={13} aria-hidden="true" />
            </span>
          </small>
        </span>
      </button>
      <button type="button" className="live-toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(item._id)}>
        <X size={14} />
      </button>
      {!paused && durationMs > 0 && <i className="live-toast-timer" style={{ animationDuration: `${durationMs}ms` }} aria-hidden="true" />}
    </div>
  );
}

export default function NotificationToasts({ toasts = [], kinds = {}, onOpen, onDismiss, durationMs = TOAST_DURATION_MS }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <section className="live-toasts" aria-label="New notifications" aria-live="polite">
      {toasts.map((item) => (
        <Toast
          key={item._id}
          item={item}
          kind={kinds[item.type] || { label: item.type || 'Notification', icon: Bell, tone: '' }}
          onOpen={onOpen}
          onDismiss={onDismiss}
          durationMs={durationMs}
        />
      ))}
    </section>,
    document.body
  );
}
