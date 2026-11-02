import { useState } from 'react';
import { Webhook } from 'lucide-react';
import { timeAgo } from './activityDisplay';

/*
 * [Sprint 4 · M4] US-34 See GitHub events in the feed.
 * Shown in the GitHub panel under the connected repository (Owner and Admin):
 *   - whether the repository webhook is set up, and why not if it is not
 *   - "Recent deliveries": the last 20 deliveries GitHub sent, for troubleshooting (metadata only)
 * The API decides the status (backend/src/lib/githubWebhookSetup.js); the browser never sees the
 * webhook secret or the hook ID.
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

  return (
    <div className="github-webhook" aria-label="GitHub webhook">
      <p className="github-webhook-state">
        <Webhook size={12} aria-hidden="true" />
        <span className={`pill ${label.tone}`}>{label.text}</span>
      </p>
      <p className="team-note">{message}</p>

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
