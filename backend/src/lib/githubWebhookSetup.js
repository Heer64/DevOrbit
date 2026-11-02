import GithubConnection from '../models/GithubConnection.js';
import {
  WEBHOOK_MESSAGES,
  createRepositoryWebhook,
  defaultSleep,
  deleteRepositoryWebhook,
  shortError,
  webhookConfig,
} from './githubWebhooks.js';

/*
 * [Sprint 4 · M4] US-34: adding and removing a project's repository webhook.
 *
 * setupProjectWebhook()   called by M2's PUT /api/projects/:id/github/repository after the Owner
 *                         chooses a repository. Never throws: choosing the repository always succeeds,
 *                         and the webhook outcome is saved on GithubConnection.webhook for the panel.
 * removeProjectWebhook()  for M3 (US-33 disconnect): call it BEFORE deleting the GithubConnection,
 *                         with the decrypted token. Removes the hook on GitHub unless another project
 *                         still uses the same repository. Never throws.
 *
 * Even without removeProjectWebhook(), a disconnected project gets no new feed entries: the webhook
 * endpoint only adds entries for projects whose connection is still Active (routes/githubWebhook.js).
 */

function logWarning(message) {
  if (process.env.NODE_ENV !== 'test') console.warn(message);
}

function outcome(status, extra = {}) {
  return { status, message: WEBHOOK_MESSAGES[status] || '', ...extra, updatedAt: new Date() };
}

// Whether another project's connection still uses this repository (the hook is shared then).
async function repositoryUsedElsewhere(connectionId, repositoryId) {
  if (!repositoryId) return false;
  return Boolean(await GithubConnection.exists({ _id: { $ne: connectionId }, 'repository.githubId': repositoryId }));
}

export async function removeProjectWebhook({ connection, accessToken, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const hook = connection?.webhook;
  const repository = connection?.repository;
  if (!hook?.hookId || !repository?.fullName) return { removed: false, reason: 'no_webhook' };
  // The stored hook may belong to the repository chosen before the current one.
  const hookRepositoryId = hook.repositoryId || repository.githubId;
  if (hookRepositoryId !== repository.githubId) return { removed: false, reason: 'other_repository' };
  try {
    if (await repositoryUsedElsewhere(connection._id, hookRepositoryId)) return { removed: false, reason: 'shared' };
    await deleteRepositoryWebhook({ accessToken, fullName: repository.fullName, hookId: hook.hookId, fetchImpl, sleep });
    return { removed: true };
  } catch (error) {
    logWarning(`Could not remove the GitHub webhook: ${shortError(error)}`);
    return { removed: false, reason: 'error', error: shortError(error) };
  }
}

export async function setupProjectWebhook({
  connection,
  accessToken,
  previousRepository = null,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
}) {
  const repository = connection?.repository;
  if (!connection?._id || !repository?.githubId) return null;

  // The repository changed: take our hook off the old one (unless another project still uses it).
  const previousHook = connection.webhook;
  if (previousRepository && previousRepository.githubId !== repository.githubId && previousHook?.hookId) {
    await removeProjectWebhook({
      connection: { _id: connection._id, webhook: previousHook, repository: previousRepository },
      accessToken,
      fetchImpl,
      sleep,
    });
  }

  let webhook;
  if (!webhookConfig().configured) {
    webhook = outcome('not_configured', { repositoryId: repository.githubId });
  } else if (!repository.admin) {
    webhook = outcome('not_admin', { repositoryId: repository.githubId });
  } else {
    try {
      const { hookId } = await createRepositoryWebhook({ accessToken, fullName: repository.fullName, fetchImpl, sleep });
      webhook = outcome('active', { hookId, repositoryId: repository.githubId });
    } catch (error) {
      logWarning(`Could not set up the GitHub webhook: ${shortError(error)}`);
      if (error?.kind === 'not_admin') webhook = outcome('not_admin', { repositoryId: repository.githubId });
      else if (error?.kind === 'not_configured') webhook = outcome('not_configured', { repositoryId: repository.githubId });
      else {
        const messageKey = error?.kind === 'rate_limited' ? 'rate_limited' : error?.kind === 'unauthorized' ? 'reauthorize' : 'failed';
        webhook = { ...outcome('failed', { repositoryId: repository.githubId }), message: WEBHOOK_MESSAGES[messageKey] };
      }
    }
  }

  try {
    await GithubConnection.updateOne({ _id: connection._id }, { $set: { webhook } });
  } catch (error) {
    logWarning(`Could not save the GitHub webhook status: ${shortError(error)}`);
  }
  return webhook;
}
