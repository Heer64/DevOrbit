import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Decision from '../models/Decision.js';
import Message from '../models/Message.js';
import PortfolioStat from '../models/PortfolioStat.js';
import {
  NOT_AVAILABLE_MESSAGE,
  PORTFOLIO_PROJECT_LIMIT,
  PRIVATE_PROJECT_NAME,
  STATS_MAX_AGE_MS,
  isStale,
  ownerSummary,
  projectView,
  readUsername,
  statsUpdatedAt,
  totalsOf,
} from './portfolioRules.js';

// Re-exported so routes and tests can import everything portfolio-related from this file.
export { NOT_AVAILABLE_MESSAGE, PORTFOLIO_PROJECT_LIMIT, PRIVATE_PROJECT_NAME, STATS_MAX_AGE_MS, isStale, readUsername };

/*
 * [Sprint 5 · M5] US-49 Generate my portfolio (FR-21, NFR-12).
 *
 * A portfolio lists the projects a user belongs to that are marked Completed, with the user's
 * role and three contribution numbers per project:
 *   tasksCompleted     tasks in that project assigned to the user and now Done
 *   decisionsRecorded  decisions the user recorded in that project (Decision.createdBy)
 *   messagesPosted     channel messages and thread replies the user posted in that project
 *
 * NFR-12 "at most 24 hours stale": the numbers are saved in PortfolioStat with computedAt and
 * counted again whenever a portfolio is opened and they are 24 hours old or older.
 *
 * Two views:
 *   owner view   (GET /api/portfolio/me)          every Completed project, with its ID for a link.
 *   public view  (GET /api/public/portfolio/:u)   read-only, for anyone with the link. A Private
 *                project is still listed with role, domain, date and numbers, but its name and
 *                description are hidden, because the other members never made them public.
 */

// Counts the three numbers straight from the database.
export async function countContributions(userId, projectId) {
  const [tasksCompleted, decisionsRecorded, messagesPosted] = await Promise.all([
    Task.countDocuments({ project: projectId, assignee: userId, status: 'Done' }),
    Decision.countDocuments({ project: projectId, createdBy: userId }),
    Message.countDocuments({ project: projectId, author: userId }),
  ]);
  return { tasksCompleted, decisionsRecorded, messagesPosted };
}

// Saved numbers for each project, counting again where they are missing or 24 hours old.
export async function statsFor(userId, projectIds, now = new Date()) {
  if (!projectIds.length) return new Map();
  const saved = await PortfolioStat.find({ user: userId, project: { $in: projectIds } }).lean();
  const byProject = new Map(saved.map((stat) => [String(stat.project), stat]));

  await Promise.all(
    projectIds.map(async (projectId) => {
      const key = String(projectId);
      if (!isStale(byProject.get(key), now)) return;
      const counts = await countContributions(userId, projectId);
      const filter = { user: userId, project: projectId };
      const update = { $set: { ...counts, computedAt: now } };
      let fresh;
      try {
        fresh = await PortfolioStat.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
      } catch (error) {
        // Two loads at the same moment both tried to create the row: the other one won, so update it.
        if (error?.code !== 11000) throw error;
        fresh = await PortfolioStat.findOneAndUpdate(filter, update, { new: true }).lean();
      }
      byProject.set(key, fresh);
    })
  );
  return byProject;
}

// Builds the whole portfolio for one user.
export async function buildPortfolio(user, { publicView = false, now = new Date() } = {}) {
  const projects = await Project.find({ 'members.user': user._id, status: 'Completed' })
    .select('name description domain tags visibility completedAt members.user members.role')
    .sort({ completedAt: -1, _id: -1 })
    .limit(PORTFOLIO_PROJECT_LIMIT)
    .lean();
  const stats = await statsFor(user._id, projects.map((project) => project._id), now);
  const items = projects.map((project) => projectView(project, user._id, stats.get(String(project._id)), { publicView }));
  return {
    user: ownerSummary(user),
    projects: items,
    totals: totalsOf(items),
    statsUpdatedAt: statsUpdatedAt(items),
  };
}
