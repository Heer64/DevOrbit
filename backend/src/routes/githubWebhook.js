import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';

import GithubConnection from '../models/GithubConnection.js';
import GithubFeedKey from '../models/GithubFeedKey.js';
import WebhookDelivery from '../models/WebhookDelivery.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';
import { canEditProject } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';
import { githubConfig } from '../lib/githubOAuth.js';
import { repositoryStatus } from '../lib/githubRepos.js';
import { githubEventsAccepted } from '../lib/githubConnection.js'; // [Sprint 4 · M3] US-33 event gate
import { SUPPORTED_EVENTS, deliveryRepositoryId, mapGithubEvent } from '../lib/githubEvents.js';
import {
  RETRY_DEFAULTS,
  SIGNATURE_HEADER,
  defaultSleep,
  runWithRetry,
  shortError,
  validDeliveryId,
  validEventName,
  verifySignature,
  webhookConfig,
} from '../lib/githubWebhooks.js';

/*
 * [Sprint 4 · M4] US-34 See GitHub events in the feed (FR-12, NFR-11a, NFR-11b).
 * "Given a repository is connected, when a commit is pushed, or an issue or pull request is opened
 *  or updated, then a feed entry showing event type, title, author and a link to GitHub appears
 *  within 60 seconds."
 *
 * POST /api/github/webhook                       (mounted as githubWebhookRoutes, see app.js)
 *   Called by GitHub, not the browser. Mounted BEFORE express.json() and the /api rate limiter,
 *   because the signature is an HMAC of the exact raw body bytes.
 *     1. 503 when GITHUB_WEBHOOK_SECRET / GITHUB_WEBHOOK_URL are not set (nothing is processed).
 *     2. X-Hub-Signature-256 is checked (HMAC-SHA256, constant-time) BEFORE anything else is read.
 *        Missing or wrong -> 401, nothing is stored.
 *     3. 400 for a missing X-GitHub-Event / X-GitHub-Delivery or a body that is not JSON.
 *     4. The delivery is recorded in WebhookDelivery (metadata only). Its delivery ID is unique, so a
 *        repeated delivery answers 200 { duplicate: true } and is not processed again.
 *     5. 'ping' (sent when the hook is created) -> 200, recorded as ignored.
 *     6. Otherwise 202 straight away, then processing runs in the background (GitHub waits 10 s at most):
 *        find every project whose GitHub connection is Active for this repository, map the event
 *        (lib/githubEvents.js) and add each entry with logActivity(), which also pushes it live over
 *        socket.io, so it shows in open feeds within seconds.
 *        Each entry is guarded by GithubFeedKey (unique per project + event), so no duplicates.
 *        Failures are retried 3 times with 1 s / 2 s / 4 s backoff; only the final failure is logged
 *        (delivery ID, event and a short reason; never the payload, the secret or a token).
 *
 * GET /api/projects/:id/github/deliveries        (mounted as githubDeliveriesRoutes)
 *   Owner and Admin. The last 20 deliveries for this project or its connected repository:
 *   { deliveries: [{ deliveryId, event, action, repoFullName, status, attempts, entries, reason,
 *                    lastError, receivedAt, processedAt }] }. No payloads.
 */

// Tests set these (fast retries, fake sleep).
export const webhookOptions = { ...RETRY_DEFAULTS, sleep: defaultSleep };

// Background work still running; tests await it with waitForWebhookWork().
const pending = new Set();
export function waitForWebhookWork() {
  return Promise.allSettled([...pending]);
}

// Projects whose connection to this repository is Active right now (US-32 rule). After a
// disconnect (US-33) the project is no longer here, so new events stop; old entries stay.
// [Sprint 4 · M3] US-33: disconnect is a soft disconnect (the record and its repository stay), so the
// US-33 gate is applied here too. Without it a disconnected project would reach logActivity(), which
// refuses github.* events for it, and the delivery would be retried as a failure instead of ignored.
async function activeProjectsFor(repositoryId) {
  if (!repositoryId) return [];
  const configured = githubConfig().configured;
  const connections = await GithubConnection.find({ 'repository.githubId': repositoryId }).lean();
  return connections
    .filter((connection) => repositoryStatus({ connection, configured, role: 'Owner' }).active)
    .filter((connection) => githubEventsAccepted(connection, repositoryId))
    .map((connection) => connection.project);
}

// Adds one entry to one project's feed. false when it is already there.
async function addFeedEntry(project, entry) {
  let claimed;
  try {
    claimed = await GithubFeedKey.create({ project, key: entry.key });
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
  const saved = await logActivity({
    project,
    actor: null,
    type: entry.type,
    summary: entry.summary,
    targetType: 'github',
    targetLabel: entry.targetLabel,
    meta: entry.meta,
  });
  if (!saved) {
    // logActivity() never throws; release the key so the retry can add the entry.
    await GithubFeedKey.deleteOne({ _id: claimed._id }).catch(() => {});
    throw new Error('Could not save the feed entry.');
  }
  await GithubFeedKey.updateOne({ _id: claimed._id }, { $set: { activity: saved._id } }).catch(() => {});
  return true;
}

async function finish(deliveryId, fields) {
  await WebhookDelivery.updateOne({ deliveryId }, { $set: { ...fields, processedAt: new Date() } }).catch((error) => {
    console.error(`Could not update GitHub webhook delivery ${deliveryId}: ${shortError(error)}`);
  });
}

export async function processDelivery({ deliveryId, event, payload }) {
  if (!SUPPORTED_EVENTS.includes(event)) {
    return finish(deliveryId, { status: 'ignored', reason: `"${event}" events are not shown in the feed.` });
  }
  const entries = mapGithubEvent(event, payload);
  if (entries.length === 0) {
    return finish(deliveryId, { status: 'ignored', reason: 'Nothing in this event is shown in the feed.' });
  }
  const repositoryId = deliveryRepositoryId(payload);

  const result = await runWithRetry(async () => {
    const projects = await activeProjectsFor(repositoryId);
    let added = 0;
    for (const project of projects) {
      for (const entry of entries) {
        if (await addFeedEntry(project, entry)) added += 1;
      }
    }
    return { projects, added };
  }, webhookOptions);

  if (!result.ok) {
    // NFR-11a: the final failure is logged. Delivery ID, event and a short reason only.
    console.error(`GitHub webhook delivery ${deliveryId} (${event}) failed after ${result.attempts} attempts: ${shortError(result.error)}`);
    return finish(deliveryId, { status: 'failed', attempts: result.attempts, lastError: shortError(result.error) });
  }
  const { projects, added } = result.value;
  if (projects.length === 0) {
    return finish(deliveryId, {
      status: 'ignored',
      attempts: result.attempts,
      reason: 'No project has this repository connected and Active.',
    });
  }
  return finish(deliveryId, { status: 'processed', attempts: result.attempts, entries: added, projects });
}

// ---------------------------------------------------------------------------------------------
// POST /api/github/webhook
// ---------------------------------------------------------------------------------------------
export const githubWebhookRoutes = Router();

githubWebhookRoutes.post(
  '/',
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
  }),
  // Raw bytes for every content type, so the HMAC is computed on exactly what GitHub signed.
  express.raw({ type: () => true, limit: '1mb' }),
  async (req, res, next) => {
    try {
      const config = webhookConfig();
      if (!config.configured) {
        return res.status(503).json({ message: 'GitHub webhooks are not configured on this server.' });
      }
      if (!verifySignature(config.secret, req.body, req.get(SIGNATURE_HEADER))) {
        return res.status(401).json({ message: 'Invalid or missing webhook signature.' });
      }

      const event = req.get('x-github-event');
      const deliveryId = req.get('x-github-delivery');
      if (!validEventName(event) || !validDeliveryId(deliveryId)) {
        return res.status(400).json({ message: 'Missing GitHub event or delivery headers.' });
      }

      let payload;
      try {
        payload = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ message: 'Webhook body is not valid JSON. Use content type application/json.' });
      }
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ message: 'Webhook body is not valid JSON. Use content type application/json.' });
      }

      try {
        await WebhookDelivery.create({
          deliveryId,
          event,
          action: typeof payload.action === 'string' ? payload.action.slice(0, 40) : '',
          repositoryId: deliveryRepositoryId(payload),
          repoFullName: typeof payload.repository?.full_name === 'string' ? payload.repository.full_name.slice(0, 200) : '',
          ...(event === 'ping'
            ? { status: 'ignored', reason: 'GitHub ping: the webhook reached DevOrbit.', processedAt: new Date() }
            : {}),
        });
      } catch (error) {
        if (error?.code === 11000) return res.status(200).json({ received: true, duplicate: true });
        throw error;
      }

      if (event === 'ping') return res.status(200).json({ received: true, pong: true });

      res.status(202).json({ received: true });

      // Processed after answering: GitHub only waits 10 seconds for a reply.
      const work = processDelivery({ deliveryId, event, payload })
        .catch((error) => console.error(`GitHub webhook delivery ${deliveryId} (${event}) could not be processed: ${shortError(error)}`))
        .finally(() => pending.delete(work));
      pending.add(work);
      return undefined;
    } catch (error) {
      return next(error);
    }
  }
);

// ---------------------------------------------------------------------------------------------
// GET /api/projects/:id/github/deliveries
// ---------------------------------------------------------------------------------------------
export const githubDeliveriesRoutes = Router({ mergeParams: true });
githubDeliveriesRoutes.use(requireAuth);

githubDeliveriesRoutes.get('/', async (req, res, next) => {
  try {
    const access = await loadProjectForMember(req, res);
    if (!access) return undefined;
    if (!canEditProject(access.role)) {
      return res.status(403).json({ message: 'Only the project Owner and Admins can view webhook deliveries.' });
    }
    const connection = await GithubConnection.findOne({ project: access.project._id }).select('repository').lean();
    const filters = [{ projects: access.project._id }];
    if (connection?.repository?.githubId) filters.push({ repositoryId: connection.repository.githubId });

    const deliveries = await WebhookDelivery.find({ $or: filters })
      .sort({ receivedAt: -1 })
      .limit(20)
      .select('-_id deliveryId event action repoFullName status attempts entries reason lastError receivedAt processedAt')
      .lean();
    res.set('Cache-Control', 'no-store');
    return res.json({ deliveries });
  } catch (error) {
    return next(error);
  }
});
