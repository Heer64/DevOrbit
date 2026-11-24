import { SUPPORTED_EVENTS } from './githubEvents.js';
import { isDisconnected } from './githubConnection.js';
import { repositoryView } from './githubRepos.js';

/*
 * [Sprint 7 · M8] Missed GitHub events: the rules, with no database and no network.
 *
 * Why: Render's free server sleeps after ~15 minutes without visitors and needs 30-60 s to start.
 * GitHub gives up on a webhook delivery after 10 s, so a commit pushed while the API slept never
 * reached the Activity feed. GitHub keeps a log of every delivery it tried, and can send one again.
 *
 * A delivery is "missed" when, in GitHub's log:
 *   - it is a push, issues or pull_request event (what the feed shows; not ping),
 *   - it was sent in the last 24 hours (MISSED_EVENTS_WINDOW_MS),
 *   - none of its attempts got a 2xx answer from us (timeout, 502 while waking up, 503, ...), and
 *   - we have no WebhookDelivery with its ID (X-GitHub-Delivery = the log's "guid").
 * At most MAX_REDELIVERIES_PER_RUN per webhook per run, oldest first so the feed keeps its order.
 * A delivery GitHub already re-sent MAX_REDELIVERY_ATTEMPTS times without success is left alone,
 * so one our server keeps refusing (e.g. a wrong webhook secret) is not asked for every 15 minutes.
 *
 * Unit tested without MongoDB: backend/test/githubSprint7Rules.test.js.
 */

export const MISSED_EVENTS_INTERVAL_MS = 15 * 60_000;
export const MISSED_EVENTS_FIRST_RUN_DELAY_MS = 30_000; // shortly after start-up = right after Render woke up
export const MISSED_EVENTS_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_REDELIVERIES_PER_RUN = 20;
export const MAX_REDELIVERY_ATTEMPTS = 3;
const GUID = /^[A-Za-z0-9-]{1,100}$/; // the same shape POST /api/github/webhook accepts

// One entry of GitHub's delivery log -> { id, guid, deliveredAt (ms), statusCode, event, action, redelivery } or null.
export function toHookDelivery(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isSafeInteger(raw.id) || raw.id <= 0) return null;
  if (typeof raw.guid !== 'string' || !GUID.test(raw.guid)) return null;
  const deliveredAt = Date.parse(raw.delivered_at);
  if (!Number.isFinite(deliveredAt)) return null;
  return {
    id: raw.id,
    guid: raw.guid,
    deliveredAt,
    statusCode: Number.isInteger(raw.status_code) ? raw.status_code : 0,
    event: typeof raw.event === 'string' ? raw.event : '',
    action: typeof raw.action === 'string' ? raw.action.slice(0, 40) : '',
    redelivery: raw.redelivery === true,
  };
}

const answered = (statusCode) => statusCode >= 200 && statusCode < 300;

/*
 * deliveries   GitHub's log (raw or already shaped)
 * receivedIds  delivery IDs we have in WebhookDelivery (Set or array)
 * -> { checked, missed: [{ id, guid, event, action, deliveredAt }], gaveUp }
 *    checked = how many different push/issues/pull_request deliveries of the window were looked at
 *    missed  = what to ask GitHub to send again (the newest attempt of each), oldest first, capped
 *    gaveUp  = missed ones skipped because they were already re-sent MAX_REDELIVERY_ATTEMPTS times
 */
export function missedDeliveries({
  deliveries,
  receivedIds = new Set(),
  now = Date.now(),
  windowMs = MISSED_EVENTS_WINDOW_MS,
  max = MAX_REDELIVERIES_PER_RUN,
} = {}) {
  const received = receivedIds instanceof Set ? receivedIds : new Set(receivedIds || []);
  const byGuid = new Map();
  for (const raw of Array.isArray(deliveries) ? deliveries : []) {
    const delivery = raw && typeof raw.deliveredAt === 'number' ? raw : toHookDelivery(raw);
    if (!delivery || !SUPPORTED_EVENTS.includes(delivery.event)) continue;
    if (delivery.deliveredAt < now - windowMs || delivery.deliveredAt > now + 60_000) continue;
    const group = byGuid.get(delivery.guid) || { attempts: [] };
    group.attempts.push(delivery);
    byGuid.set(delivery.guid, group);
  }

  const missed = [];
  let gaveUp = 0;
  for (const [guid, { attempts }] of byGuid) {
    if (received.has(guid)) continue;
    if (attempts.some((attempt) => answered(attempt.statusCode))) continue;
    if (attempts.filter((attempt) => attempt.redelivery).length >= MAX_REDELIVERY_ATTEMPTS) {
      gaveUp += 1;
      continue;
    }
    const newest = attempts.reduce((a, b) => (b.deliveredAt > a.deliveredAt ? b : a));
    const first = attempts.reduce((a, b) => (b.deliveredAt < a.deliveredAt ? b : a));
    missed.push({ id: newest.id, guid, event: newest.event, action: newest.action, deliveredAt: first.deliveredAt });
  }
  missed.sort((a, b) => a.deliveredAt - b.deliveredAt);
  return { checked: byGuid.size, missed: missed.slice(0, Math.max(0, max)), gaveUp };
}

// The panel's sentence for a manual check. { checked, redelivered }
export function recheckMessage({ redelivered = 0 } = {}) {
  if (redelivered === 0) return 'No missed GitHub events in the last 24 hours.';
  const what = redelivered === 1 ? '1 missed event' : `${redelivered} missed events`;
  return `Asked GitHub to send ${what} again. They appear in the Activity feed within a few seconds.`;
}

// A log line with no token, secret or payload: the repository and counts only.
export function missedEventsLogLine({ fullName, checked, redelivered, gaveUp = 0 }) {
  return `[github] missed events for ${fullName}: checked ${checked}, asked GitHub to resend ${redelivered}${gaveUp ? `, gave up on ${gaveUp}` : ''}`;
}

/*
 * Which webhook to check for a GitHub connection -> { fullName, hookId, repositoryId } or null.
 * Only a connected project with an Active repository (chosen under the current GitHub account) whose
 * webhook is active, has a hook ID and belongs to that repository. Not when GitHub must be re-authorized.
 */
export function missedEventsTarget(connection) {
  if (!connection || isDisconnected(connection) || connection.needsReauthorization) return null;
  const repository = repositoryView(connection);
  const hook = connection.webhook;
  if (!repository || !hook || hook.status !== 'active' || !Number.isSafeInteger(hook.hookId) || hook.hookId <= 0) return null;
  if (hook.repositoryId && hook.repositoryId !== repository.id) return null;
  return { fullName: repository.fullName, hookId: hook.hookId, repositoryId: repository.id };
}
