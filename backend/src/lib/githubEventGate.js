import mongoose from 'mongoose';
import GithubConnection from '../models/GithubConnection.js';
import { githubEventsAccepted } from './githubConnection.js';

/*
 * [Sprint 4 · M3] US-33 event gate: "After disconnect, new events stop coming in but old feed
 * entries stay." This file is the interface between US-33 (M3) and the webhook pipeline (US-34, M4).
 *
 * How M4's webhook pipeline (routes/githubWebhook.js, US-34) uses it; nothing here receives or
 * verifies webhooks:
 *   1. activeProjectsFor() keeps M2's Active rule and also applies githubEventsAccepted(), so a
 *      delivery for a disconnected project is recorded as ignored (not retried as a failure).
 *   2. logActivity() (lib/activity.js) calls canRecordGithubEvent() for every github.* event, so an
 *      event can never be added after a disconnect, whatever code path writes it.
 *   3. Disconnect (routes/github.js) calls M4's removeProjectWebhook() before revoking the token, and
 *      re-authorize / reconnect calls M4's setupProjectWebhook() again.
 *   4. Disconnect never deletes Activity documents: earlier GitHub entries stay in the feed.
 *
 * projectsAcceptingGithubEvents() is the same rule as a database lookup, for any other caller.
 *
 * Both functions read the database at the time of the call, so the answer changes the moment a
 * project is disconnected. Neither throws for bad input; they answer "no".
 */

function repositoryIdOf(value) {
  const id = typeof value === 'string' && /^\d{1,16}$/.test(value.trim()) ? Number(value.trim()) : value;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Project IDs (strings) whose GitHub connection currently accepts events from this repository.
export async function projectsAcceptingGithubEvents(githubRepositoryId) {
  const repositoryId = repositoryIdOf(githubRepositoryId);
  if (repositoryId === null) return [];
  const connections = await GithubConnection.find({ 'repository.githubId': repositoryId, status: { $ne: 'disconnected' } })
    .select('project githubUserId status repository')
    .lean();
  return connections
    .filter((connection) => githubEventsAccepted(connection, repositoryId))
    .map((connection) => String(connection.project));
}

/*
 * Whether a github.* event may be written to this project's feed now. When githubRepositoryId is
 * given (meta.repositoryId), it must also be the project's connected repository.
 */
export async function canRecordGithubEvent(projectId, githubRepositoryId = null) {
  if (!mongoose.isValidObjectId(projectId)) return false;
  let repositoryId = null;
  if (githubRepositoryId !== null && githubRepositoryId !== undefined) {
    repositoryId = repositoryIdOf(githubRepositoryId);
    if (repositoryId === null) return false;
  }
  const connection = await GithubConnection.findOne({ project: projectId })
    .select('project githubUserId status repository')
    .lean();
  return githubEventsAccepted(connection, repositoryId);
}
