/*
 * [Sprint 5 · M5] US-49 portfolio rules that need no database (tested in test/portfolioRules.test.js).
 * lib/portfolio.js uses them to build the portfolio.
 */

export const STATS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PORTFOLIO_PROJECT_LIMIT = 100;
export const NOT_AVAILABLE_MESSAGE = 'This portfolio is not available.';
export const PRIVATE_PROJECT_NAME = 'Private project';

const USERNAME_PATTERN = /^[a-z0-9._-]{1,30}$/;

// Usernames are stored lowercase (User model). Returns the cleaned name or null.
export function readUsername(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  return USERNAME_PATTERN.test(name) ? name : null;
}

// True when saved numbers must be counted again: missing, 24 hours old or older, or dated in the
// future (a wrong clock must not keep old numbers alive).
export function isStale(stat, now = new Date()) {
  if (!stat?.computedAt) return true;
  const age = now.getTime() - new Date(stat.computedAt).getTime();
  return Number.isNaN(age) || age < 0 || age >= STATS_MAX_AGE_MS;
}

export function roleIn(project, userId) {
  const member = (project.members || []).find((item) => String(item.user?._id || item.user) === String(userId));
  return member?.role || null;
}

export function statsView(stat) {
  return {
    tasksCompleted: stat?.tasksCompleted || 0,
    decisionsRecorded: stat?.decisionsRecorded || 0,
    messagesPosted: stat?.messagesPosted || 0,
    computedAt: stat?.computedAt || null,
  };
}

export function projectView(project, userId, stat, { publicView = false } = {}) {
  const hidden = publicView && project.visibility !== 'Public';
  const base = {
    role: roleIn(project, userId),
    domain: project.domain || '',
    completedAt: project.completedAt || null,
    visibility: project.visibility,
    stats: statsView(stat),
  };
  if (hidden) return { ...base, name: PRIVATE_PROJECT_NAME, description: '', tags: [], isPrivate: true };
  return {
    ...(publicView ? {} : { _id: project._id }),
    ...base,
    name: project.name,
    description: project.description || '',
    tags: project.tags || [],
    isPrivate: project.visibility !== 'Public',
  };
}

export function totalsOf(projects) {
  return projects.reduce(
    (sum, item) => ({
      projects: sum.projects + 1,
      tasksCompleted: sum.tasksCompleted + item.stats.tasksCompleted,
      decisionsRecorded: sum.decisionsRecorded + item.stats.decisionsRecorded,
      messagesPosted: sum.messagesPosted + item.stats.messagesPosted,
    }),
    { projects: 0, tasksCompleted: 0, decisionsRecorded: 0, messagesPosted: 0 }
  );
}

// The oldest computedAt shown, so the page can say "numbers updated …".
export function statsUpdatedAt(projects) {
  const times = projects.map((item) => item.stats.computedAt).filter(Boolean).map((value) => new Date(value).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

export function ownerSummary(user) {
  return {
    name: user.name,
    username: user.username,
    headline: user.headline || '',
    avatarUrl: user.avatarUrl || '',
  };
}

