import { useState } from 'react';
import { RefreshCw, Webhook } from 'lucide-react'; // RefreshCw: [Sprint 7 · M8] missed events
import { timeAgo } from './activityDisplay';

/*
 * [Sprint 4 · M4] US-34 See GitHub events in the feed.
 * Shown in the GitHub panel under the connected repository (Owner and Admin):
 *   - whether the repository webhook is set up, and why not if it is not
 *   - "Recent deliveries": the last 20 deliveries GitHub sent, for troubleshooting (metadata only)
 * The API decides the status (backend/src/lib/githubWebhookSetup.js); the browser never sees the
 * webhook secret or the hook ID.
 *
 * [Sprint 7 · M8] Missed events: "Check for missed events" (active webhook only) asks the server to read
 * the webhook's delivery log on GitHub and have GitHub send again what never reached DevOrbit, e.g.
 * while the server was asleep (POST /api/projects/:id/github/webhook/recheck). The server also does
 * this by itself every 15 minutes.
 */

export const WEBHOOK_LABELS = {
  active: { tone: 'green', text: 'Webhook active' },
  not_configured: { tone: 'orange', text: 'Webhook not set up' },
  not_admin: { tone: 'orange', text: 'Webhook not set up' },
  failed: { tone: 'orange', text: 'Webhook not set up' },
};

const DELIVERY_STATUS = {
  received: 'Waiting',
  processed: 'Added to feed',
  ignored: 'Ignored',
  failed: 'Failed',
};

function deliveryDetail(delivery) {
  if (delivery.status === 'processed') {
    return delivery.entries === 1 ? '1 new entry' : `${delivery.entries} new entries`;
  }
  if (delivery.status === 'failed') return delivery.lastError || 'Processing failed';
  return delivery.reason || '';
}

export default function GithubWebhookStatus({ projectId, webhook, api }) {
  const [deliveries, setDeliveries] = useState(null);
  const [error, setError] = useState('');
  // [Sprint 7 · M8] missed events
  const [rechecking, setRechecking] = useState(false);
  const [recheck, setRecheck] = useState(null); // { ok, text }

  const label = WEBHOOK_LABELS[webhook?.status] || { tone: 'orange', text: 'Webhook not set up' };
  const message = webhook?.message
    || 'Choose the repository again to set up the webhook that sends commits, issues and pull requests to the Activity feed.';

  const load = () => {
    if (!api?.deliveries) return;
    setError('');
    api.deliveries(projectId)
      .then((data) => setDeliveries(data?.deliveries || []))
      .catch((e) => setError(e.message || 'Could not load webhook deliveries.'));
  };

  // [Sprint 7 · M8] missed events
  const canRecheck = webhook?.status === 'active' && typeof api?.recheckMissedEvents === 'function';
  const checkMissed = async () => {
    setRecheck(null);
    setRechecking(true);
    try {
      const result = await api.recheckMissedEvents(projectId);
      setRecheck({ ok: true, text: result?.message || 'Checked for missed events.' });
      if (result?.redelivered > 0) setDeliveries(null); // reloaded the next time "Recent deliveries" is opened
    } catch (e) {
      setRecheck({ ok: false, text: e.message || 'Could not check for missed events.' });
    } finally {
      setRechecking(false);
    }
  };

  return (
    <div className="github-webhook" aria-label="GitHub webhook">
      <p className="github-webhook-state">
        <Webhook size={12} aria-hidden="true" />
        <span className={`pill ${label.tone}`}>{label.text}</span>
      </p>
      <p className="team-note">{message}</p>

      {/* [Sprint 7 · M8] missed events */}
      {canRecheck && (
        <div className="github-recheck">
          <button type="button" className="link github-recheck-button" onClick={checkMissed} disabled={rechecking}>
            <RefreshCw size={11} aria-hidden="true" /> {rechecking ? 'Checking GitHub…' : 'Check for missed events'}
          </button>
          {recheck && <p className={recheck.ok ? 'success-inline' : 'form-error'} role={recheck.ok ? 'status' : 'alert'}>{recheck.text}</p>}
        </div>
      )}

      {api?.deliveries && (
        <details onToggle={(event) => { if (event.currentTarget.open && deliveries === null) load(); }}>
          <summary>Recent deliveries</summary>
          {error && <div className="form-error" role="alert">{error}</div>}
          {!error && deliveries === null && <p className="team-note">Loading…</p>}
          {deliveries && deliveries.length === 0 && (
            <p className="team-note">No deliveries yet. Push a commit or open an issue on GitHub to test it.</p>
          )}
          {deliveries && deliveries.length > 0 && (
            <ul className="github-deliveries">
              {deliveries.map((delivery) => (
                <li key={delivery.deliveryId}>
                  <b>{delivery.event}{delivery.action ? ` · ${delivery.action}` : ''}</b>
                  <span className={`delivery-status ${delivery.status}`}>{DELIVERY_STATUS[delivery.status] || delivery.status}</span>
                  <small>
                    {deliveryDetail(delivery)}
                    {delivery.receivedAt ? ` · ${timeAgo(delivery.receivedAt)}` : ''}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}
