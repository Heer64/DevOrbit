import GithubConnection from '../models/GithubConnection.js';
import WebhookDelivery from '../models/WebhookDelivery.js';
import { decryptToken } from './githubCrypto.js';
import { GithubApiError } from './githubRepos.js';
import { listHookDeliveries, redeliverHookDelivery, shortError, webhookConfig } from './githubWebhooks.js';
import {
  MISSED_EVENTS_FIRST_RUN_DELAY_MS,
  MISSED_EVENTS_INTERVAL_MS,
  MISSED_EVENTS_WINDOW_MS,
  missedDeliveries,
  missedEventsLogLine,
  missedEventsTarget,
  toHookDelivery,
} from './githubMissedEventsRules.js';

/*
 * [Sprint 7 · M8] Missed GitHub events: a periodic check with GitHub.
 *
 * Every 15 minutes (and 30 s after the server starts, which on Render's free plan is right after it
 * woke up) each Active webhook's delivery log is read from GitHub. Deliveries we never received are
 * sent again by GitHub (its "Redeliver"), to the normal signed POST /api/github/webhook with the same
 * delivery ID, so routes/githubWebhook.js handles them exactly like the first time: the signature is
 * checked, WebhookDelivery's unique deliveryId and GithubFeedKey keep every feed entry single, and a
 * project disconnected in the meantime still gets nothing (lib/githubEventGate.js).
 * The rules are in lib/githubMissedEventsRules.js.
 *
 * Owner/Admin can also run it for one project: "Check for missed events" in the GitHub panel
 * (POST /api/projects/:id/github/webhook/recheck, routes/githubMissedEvents.js).
 *
 * Logs never contain a token, the webhook secret or a payload: the repository name, counts and a short
 * reason such as "GitHub unauthorized (HTTP 401)".
 */

function log(method, message) {
  if (process.env.NODE_ENV !== 'test') console[method](message);
}

/*
 * One webhook: read GitHub's log, ask GitHub to resend what we missed.
 * -> { checked, redelivered, gaveUp }
 * Throws GithubApiError when the log cannot be read ('unauthorized', 'not_admin', 'rate_limited', 'unavailable').
 */
export async function checkMissedEvents({ connection, accessToken, now = Date.now(), fetchImpl = globalThis.fetch }) {
  const target = missedEventsTarget(connection);
  if (!target) return { checked: 0, redelivered: 0, gaveUp: 0 };
  const log = await listHookDeliveries({
    accessToken,
    fullName: target.fullName,
    hookId: target.hookId,
    since: now - MISSED_EVENTS_WINDOW_MS,
    fetchImpl,
  });
  const deliveries = log.map(toHookDelivery).filter(Boolean);
  const guids = [...new Set(deliveries.map((delivery) => delivery.guid))];
  const stored = guids.length
    ? await WebhookDelivery.find({ deliveryId: { $in: guids } }).select('deliveryId -_id').lean()
    : [];
  const { checked, missed, gaveUp } = missedDeliveries({
    deliveries,
    receivedIds: new Set(stored.map((item) => item.deliveryId)),
    now,
  });

  let redelivered = 0;
  for (const delivery of missed) {
    try {
      await redeliverHookDelivery({ accessToken, fullName: target.fullName, hookId: target.hookId, deliveryId: delivery.id, fetchImpl });
      redelivered += 1;
    } catch (error) {
      // A rejected token or a rate limit stops this webhook's run; the next run tries again.
      if (error instanceof GithubApiError && (error.kind === 'unauthorized' || error.kind === 'rate_limited')) {
        if (redelivered === 0) throw error;
        break;
      }
      log('warn', `[github] could not ask GitHub to resend a delivery for ${target.fullName}: ${shortError(error)}`);
    }
  }
  return { checked, redelivered, gaveUp };
}

let running = false;

/*
 * Every Active webhook, once. A repository connected to two projects shares one webhook, so it is
 * checked once. Never throws. -> { webhooks, checked, redelivered, skipped }
 */
export async function runMissedEventsCheck({ now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const summary = { webhooks: 0, checked: 0, redelivered: 0, skipped: 0 };
  if (running) return { ...summary, busy: true };
  if (!webhookConfig().configured) return { ...summary, notConfigured: true };
  running = true;
  try {
    const connections = await GithubConnection.find({
      status: { $ne: 'disconnected' },
      'webhook.status': 'active',
      'webhook.hookId': { $gt: 0 },
      needsReauthorization: { $ne: true },
    })
      .select('+encryptedToken')
      .lean();

    const seen = new Set();
    for (const connection of connections) {
      const target = missedEventsTarget(connection);
      if (!target) continue;
      const key = `${target.repositoryId}:${target.hookId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let accessToken = null;
      try {
        accessToken = decryptToken(connection.encryptedToken);
      } catch {
        accessToken = null;
      }
      if (!accessToken) {
        summary.skipped += 1;
        log('warn', `[github] missed-events check skipped for ${target.fullName}: the stored authorization cannot be read`);
        continue;
      }
      try {
        const result = await checkMissedEvents({ connection, accessToken, now, fetchImpl });
        summary.webhooks += 1;
        summary.checked += result.checked;
        summary.redelivered += result.redelivered;
        if (result.redelivered || result.gaveUp) log('info', missedEventsLogLine({ fullName: target.fullName, ...result }));
      } catch (error) {
        summary.skipped += 1;
        log('warn', `[github] missed-events check skipped for ${target.fullName}: ${shortError(error)}`);
      }
    }
    return summary;
  } catch (error) {
    log('error', `[github] missed-events check failed: ${error?.name || 'Error'}`);
    return summary;
  } finally {
    running = false;
  }
}

let firstRun = null;
let timer = null;

// Started by server.js (not by the tests). Timers are unref'd so they never keep the process alive.
export function startMissedEventsCheck({
  intervalMs = MISSED_EVENTS_INTERVAL_MS,
  firstRunDelayMs = MISSED_EVENTS_FIRST_RUN_DELAY_MS,
} = {}) {
  if (timer) return;
  const run = () => { runMissedEventsCheck(); };
  firstRun = setTimeout(run, firstRunDelayMs);
  firstRun.unref?.();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
}

export function stopMissedEventsCheck() {
  if (firstRun) clearTimeout(firstRun);
  if (timer) clearInterval(timer);
  firstRun = null;
  timer = null;
}
