import mongoose from 'mongoose';
import GithubConnection from '../models/GithubConnection.js';
import { githubEventsAccepted } from './githubConnection.js';

/*
 * [Sprint 4 · M3] US-33 event gate: "After disconnect, new events stop coming in but old feed
 * entries stay." This file is the interface between US-33 (M3) and the webhook pipeline (US-34, M4).
 *
 * Contract for M4 (the webhook handler is M4's; nothing here receives or verifies webhooks):
 *   1. After verifying X-Hub-Signature-256, find the projects for the delivery's repository:
 *        const projectIds = await projectsAcceptingGithubEvents(payload.repository.id);
 *      An empty list means no project has that repository connected (or it was disconnected):
 *      acknowledge the delivery (2xx) and record nothing.
 *   2. For each project, record the event with logActivity() (lib/activity.js), type
 *      'github.commit' | 'github.issue' | 'github.pull_request', and put the GitHub repository ID in
 *      meta.repositoryId (plus meta.author, the GitHub username, as US-29 already expects).
 *   3. logActivity() calls canRecordGithubEvent() itself for every github.* event, so an event that
 *      arrives (or is retried / reconciled) after a disconnect is dropped even if step 1 was skipped.
 *   4. Disconnect never deletes Activity documents: earlier GitHub entries stay in the feed.
 *   5. OPEN DEPENDENCY ON M4: if US-34 registers a webhook on the repository, removing that hook on
 *      GitHub when the project is disconnected belongs with M4's webhook code (it owns the hook ID
 *      and its storage). Until that exists, GitHub keeps delivering to the endpoint after a
 *      disconnect and this gate drops every delivery, so the feed still receives nothing new.
 *      The disconnect route (routes/github.js) marks the place to call it.
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
