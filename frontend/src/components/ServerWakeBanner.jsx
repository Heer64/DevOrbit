import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CloudOff, Loader2 } from 'lucide-react';
import { serverWakeApi } from '../api';
import { getServerState, subscribeServerState } from '../serverWake';
import './LiveAlerts.css';

/*
 * [Sprint 7 · M6] Cold-start message (NFR-17). Shown on every page, the login and "Opening your orbit…"
 * screens included, while the free Render server starts after sleeping (state from ../serverWake.js):
 *   waking  -> "Server is waking up…" with the seconds waited so far
 *   failed  -> "The server is not answering" with "Try again" (polls /api/health again)
 * It disappears as soon as the server answers. Rendered into <body> so it sits above every layout.
 * `wake` can be replaced in tests.
 */
export function waitedLabel(seconds) {
  if (seconds < 1) return '';
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function ServerWakeBanner({ wake = serverWakeApi, subscribe = subscribeServerState, getState = getServerState }) {
  const state = useSyncExternalStore(subscribe, getState, getState);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state.waking || state.failed) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.waking, state.failed]);

  if (!state.waking || typeof document === 'undefined') return null;

  const seconds = state.since ? Math.max(0, Math.floor((now - state.since) / 1000)) : 0;

  return createPortal(
    <div className={`wake-banner ${state.failed ? 'failed' : ''}`} role="status" aria-live="polite">
      <span className="wake-icon" aria-hidden="true">
        {state.failed ? <CloudOff size={16} /> : <Loader2 size={16} className="wake-spin" />}
      </span>
      {state.failed ? (
        <span className="wake-copy">
          <b>The server is not answering</b>
          <small>Check your internet connection, then try again.</small>
        </span>
      ) : (
        <span className="wake-copy">
          <b>Server is waking up…</b>
          <small>
            The free server sleeps when nobody uses it. This can take up to a minute.
            {waitedLabel(seconds) && <span className="wake-time"> {waitedLabel(seconds)}</span>}
          </small>
        </span>
      )}
      {state.failed && (
        <button type="button" className="btn small" onClick={() => wake.waitForServer()}>
          Try again
        </button>
      )}
    </div>,
    document.body
  );
}
