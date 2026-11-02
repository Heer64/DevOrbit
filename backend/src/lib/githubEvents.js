/*
 * [Sprint 4 · M4] US-34 See GitHub events in the feed (FR-12).
 *
 * Turns one GitHub webhook delivery into the Activity Feed entries it should create.
 * Pure functions: no database, no Express, no network, so it is unit tested without MongoDB
 * (backend/test/githubEvents.test.js).
 *
 *   mapGithubEvent(event, payload) -> [{ type, summary, targetLabel, key, meta }]
 *
 *   event                   GitHub action                             feed type
 *   push                    each new commit (max 20 per push)         github.commit
 *   issues                  opened, edited, closed, reopened          github.issue
 *   pull_request            opened, edited, closed (merged),          github.pull_request
 *                           reopened, synchronize (new commits)
 *
 * Anything else (labels, assignments, branch deletes, tags, ...) maps to [] and is ignored.
 *
 * meta is what the feed shows: { author, title, url, action, repository, sha | number }.
 * `author` is the GitHub username (there is no FORGE user for a GitHub event, so actor is null and
 * the feed falls back to meta.author). `url` is only ever an https://github.com/... link.
 *
 * `key` identifies the event itself (not the delivery), so the same commit / issue update arriving
 * twice, even in two different deliveries, gives one feed entry (see GithubFeedKey).
 */

export const SUPPORTED_EVENTS = ['push', 'issues', 'pull_request'];
export const ISSUE_ACTIONS = ['opened', 'edited', 'closed', 'reopened'];
export const PULL_REQUEST_ACTIONS = ['opened', 'edited', 'closed', 'reopened', 'synchronize'];
export const MAX_COMMITS_PER_PUSH = 20;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Short quoted title for the summary sentence, like lib/activity.js quote().
function quoted(value, max = 80) {
  const clean = text(value, 500).replace(/\s+/g, ' ');
  return `"${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}"`;
}

// Only links to github.com are shown in the browser.
export function safeGithubUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  return /^https:\/\/github\.com\/[^\s"'<>]+$/.test(url) && url.length <= 500 ? url : '';
}

function repositoryName(payload) {
  return text(payload?.repository?.full_name, 200);
}

function senderLogin(payload) {
  return text(payload?.sender?.login, 100);
}

function firstLine(message) {
  return text(String(message || '').split('\n')[0], 300);
}

function branchName(ref) {
  const value = text(ref, 255);
  return value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : '';
}

function mapPush(payload) {
  // Deleting a branch or pushing a tag has no new commits for the feed.
  if (payload?.deleted === true) return [];
  const branch = branchName(payload?.ref);
  if (!branch) return [];
  const commits = Array.isArray(payload?.commits) ? payload.commits : [];
  const repository = repositoryName(payload);

  return commits
    .filter((commit) => commit && typeof commit.id === 'string' && /^[0-9a-f]{7,64}$/i.test(commit.id))
    .slice(0, MAX_COMMITS_PER_PUSH)
    .map((commit) => {
      const sha = commit.id.toLowerCase();
      const title = firstLine(commit.message) || '(no commit message)';
      const author = text(commit.author?.username, 100) || text(commit.author?.name, 100) || senderLogin(payload) || 'Someone';
      return {
        type: 'github.commit',
        summary: `pushed commit ${quoted(title)} to ${branch}`,
        targetLabel: title,
        key: `commit:${sha}`,
        meta: {
          author,
          title,
          url: safeGithubUrl(commit.url),
          action: 'pushed',
          sha,
          shortSha: sha.slice(0, 7),
          branch,
          repository,
        },
      };
    });
}

function mapIssue(payload) {
  const action = text(payload?.action, 40);
  const issue = payload?.issue;
  if (!ISSUE_ACTIONS.includes(action) || !issue || typeof issue !== 'object') return [];
  // GitHub also sends pull requests through some issue APIs; those belong to pull_request events.
  if (issue.pull_request) return [];
  const number = Number.isSafeInteger(issue.number) ? issue.number : null;
  if (number === null) return [];
  const title = text(issue.title, 300) || `Issue #${number}`;
  const author = senderLogin(payload) || text(issue.user?.login, 100) || 'Someone';
  const verb = action === 'edited' ? 'updated' : action;
  return [{
    type: 'github.issue',
    summary: `${verb} issue #${number} ${quoted(title)}`,
    targetLabel: title,
    key: `issue:${number}:${action}:${text(issue.updated_at, 40)}`,
    meta: {
      author,
      title,
      url: safeGithubUrl(issue.html_url),
      action,
      number,
      repository: repositoryName(payload),
    },
  }];
}

function mapPullRequest(payload) {
  const action = text(payload?.action, 40);
  const pr = payload?.pull_request;
  if (!PULL_REQUEST_ACTIONS.includes(action) || !pr || typeof pr !== 'object') return [];
  const number = Number.isSafeInteger(pr.number) ? pr.number : (Number.isSafeInteger(payload?.number) ? payload.number : null);
  if (number === null) return [];
  const title = text(pr.title, 300) || `Pull request #${number}`;
  const author = senderLogin(payload) || text(pr.user?.login, 100) || 'Someone';
  const merged = action === 'closed' && pr.merged === true;
  const shownAction = merged ? 'merged' : action;
  const verbs = {
    opened: 'opened',
    edited: 'updated',
    closed: 'closed',
    merged: 'merged',
    reopened: 'reopened',
    synchronize: 'pushed new commits to',
  };
  const headSha = text(pr.head?.sha, 64);
  return [{
    type: 'github.pull_request',
    summary: `${verbs[shownAction]} pull request #${number} ${quoted(title)}`,
    targetLabel: title,
    // synchronize can repeat with the same updated_at; the head commit tells the pushes apart.
    key: `pr:${number}:${shownAction}:${text(pr.updated_at, 40)}${action === 'synchronize' ? `:${headSha}` : ''}`,
    meta: {
      author,
      title,
      url: safeGithubUrl(pr.html_url),
      action: shownAction,
      number,
      repository: repositoryName(payload),
    },
  }];
}

export function mapGithubEvent(event, payload) {
  if (!payload || typeof payload !== 'object') return [];
  switch (event) {
    case 'push': return mapPush(payload);
    case 'issues': return mapIssue(payload);
    case 'pull_request': return mapPullRequest(payload);
    default: return [];
  }
}

// The GitHub repository ID a delivery is about, or null.
export function deliveryRepositoryId(payload) {
  const id = payload?.repository?.id;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
